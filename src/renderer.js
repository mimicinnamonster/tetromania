const { ROWS, COLS } = require('./grid');

const RST  = '\x1b[0m';
const DIM  = '\x1b[2m';
const BOLD = '\x1b[1m';
const WHT  = '\x1b[97m';

// Bright ANSI foreground colors indexed by block color (1–6)
const FG = [
  null,
  '\x1b[91m', // 1 bright red
  '\x1b[92m', // 2 bright green
  '\x1b[94m', // 3 bright blue
  '\x1b[93m', // 4 bright yellow
  '\x1b[95m', // 5 bright magenta
  '\x1b[96m', // 6 bright cyan
];

// Returns the rendered string for one cell, given block char width
function cell(color, clearing, cursor, flashOn, blockW, cursorBlink) {
  const block = '█'.repeat(blockW);
  const fade  = '▓'.repeat(blockW);
  const empty = ' '.repeat(blockW);

  if (clearing) {
    const c = flashOn ? `${FG[color]}${fade}` : `${WHT}${fade}`;
    return `${c}${RST}`;
  }
  if (color) {
    if (cursor) {
      // Both states visible: white solid block ↔ colored shade block
      return cursorBlink
        ? `${WHT}${block}${RST}`
        : `${FG[color]}${'▓'.repeat(blockW)}${RST}`;
    }
    return `${FG[color]}${block}${RST}`;
  }
  // Empty cell — cursor blinks between white patch and empty
  return cursor
    ? (cursorBlink ? `${WHT}${'░'.repeat(blockW)}${RST}` : `${WHT}${'▒'.repeat(blockW)}${RST}`)
    : empty;
}

class Renderer {
  constructor() {
    this._firstRender = true;
    this._cache       = []; // last-written screen lines (content only, no ANSI positioning)
  }

  init() {
    process.stdout.write('\x1b[?25l'); // hide cursor
    process.stdout.write('\x1b[2J\x1b[H'); // clear screen
    this._cache       = [];
    this._firstRender = false;
  }

  cleanup() {
    process.stdout.write('\x1b[?25h'); // show cursor
    process.stdout.write('\x1b[0m');
  }

  render(game, now) {
    if (this._firstRender) this.init();

    const termRows   = process.stdout.rows || 24;
    const cellHeight = Math.max(1, Math.floor((termRows - 2) / ROWS));
    const blockW     = cellHeight * 2;

    const flashOn    = Math.floor(now / 120) % 2 === 0; // clearing animation
    const cursorBlink = Math.floor(now / 500) % 2 === 0; // cursor blink (slower)

    // Rainbow border during combo freeze
    // Speed: level 1 = 600ms/color, each extra level halves it (min ~75ms)
    const RAINBOW = ['\x1b[91m','\x1b[93m','\x1b[92m','\x1b[96m','\x1b[94m','\x1b[95m'];
    let borderColor = '';
    if (game.comboStop > 0) {
      const period = Math.max(75, 600 / Math.pow(2, game.comboLevel - 1));
      const idx    = Math.floor(now / period) % RAINBOW.length;
      borderColor  = RAINBOW[idx];
    }
    const B  = (s) => borderColor ? `${borderColor}${s}${RST}` : s;

    // Falling-block lookup: "r,c" -> color
    const falling = new Map();
    for (const b of game.fallingBlocks) {
      const r = Math.min(Math.floor(b.row), ROWS - 1);
      if (r >= 0) falling.set(`${r},${b.col}`, b.color);
    }

    // ── Build grid lines ──────────────────────────────────────────────────────
    const gridLines = [];
    gridLines.push(`${B('┌')}${B('─'.repeat(COLS * blockW))}${B('┐')}`);

    for (let r = 0; r < ROWS; r++) {
      let line = B('│');
      for (let c = 0; c < COLS; c++) {
        const color    = falling.get(`${r},${c}`) ?? game.grid[r][c];
        const clearing = game.clearing.has(`${r},${c}`);
        const cursor   = game.state !== 'gameOver' &&
                         r === game.cursorRow &&
                         (c === game.cursorCol || c === game.cursorCol + 1);
        line += cell(color, clearing, cursor, flashOn, blockW, cursorBlink);
      }
      line += B('│');
      for (let h = 0; h < cellHeight; h++) gridLines.push(line);
    }

    gridLines.push(`${B('└')}${B('─'.repeat(COLS * blockW))}${B('┘')}`);

    // ── Build side panel ──────────────────────────────────────────────────────
    const elapsed = Math.floor(game.time / 1000);
    const mm      = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss      = String(elapsed % 60).padStart(2, '0');

    let chainStr = '  -';
    if (game.chainCount > 1) chainStr = `\x1b[93m${BOLD} x${game.chainCount}${RST}`;

    let comboStr = '  -';
    if (game.comboStop > 0) {
      const freezeSecs = (game.comboStop / 1000).toFixed(1);
      const idx = (game.comboLevel - 1) % RAINBOW.length;
      comboStr = `${RAINBOW[idx]}${BOLD}x${game.comboLevel} ${DIM}(${freezeSecs}s)${RST}`;
    }

    const stateTag = game.state === 'paused'   ? ` ${BOLD}\x1b[93m[PAUSED]${RST}`
                   : game.state === 'clearing' ? ` ${DIM}[CLEARING]${RST}`
                   : game.state === 'falling'  ? ` ${DIM}[FALLING]${RST}`
                   : '';

    const panel = [
      `${BOLD}Tetris Attack TTY${RST}`,
      '',
      `Score  ${String(game.score).padStart(7)}`,
      `Level  ${String(game.level).padStart(7)}`,
      `Time   ${mm}:${ss}`,
      `Chain  ${chainStr}`,
      `Combo  ${comboStr}`,
      stateTag,
      '',
      `${DIM}Controls${RST}`,
      `${DIM}←→↑↓   Move${RST}`,
      `${DIM}Z/Spc   Swap${RST}`,
      `${DIM}X       Raise${RST}`,
      `${DIM}P       Pause${RST}`,
      `${DIM}Q       Quit${RST}`,
      `${DIM}R       Restart${RST}`,
    ];

    // ── Compose full screen lines (grid + panel side by side) ─────────────────
    const screen = gridLines.map((g, i) =>
      panel[i] !== undefined ? g + '  ' + panel[i] : g
    );

    // ── Game over overlay — inject into screen array ──────────────────────────
    if (game.state === 'gameOver') {
      const inner = COLS * blockW; // inner width, no border chars
      const center = (text) => {
        const l = Math.floor((inner - text.length) / 2);
        const r = inner - text.length - l;
        return ' '.repeat(l) + text + ' '.repeat(r);
      };

      const title  = 'GAME OVER';
      const score  = `Score: ${game.score}`;
      const prompt = 'R: Restart   Q: Quit';

      // Row r starts at screen index 1 + r*cellHeight (0-indexed; index 0 = top border)
      const mid = 1 + Math.floor(ROWS / 2) * cellHeight;
      screen[mid]     = `│\x1b[41m\x1b[97m${BOLD}${center(title)}${RST}│`;
      screen[mid + 1] = `│\x1b[41m\x1b[97m${center(score)}${RST}│`;
      screen[mid + 2] = `│\x1b[41m\x1b[97m${center(prompt)}${RST}│`;
    }

    // ── Diff against cache — only write changed lines ─────────────────────────
    let out = '';
    for (let i = 0; i < screen.length; i++) {
      if (screen[i] !== this._cache[i]) {
        out += `\x1b[${i + 1};1H${screen[i]}\x1b[K`;
      }
    }

    if (out) {
      // Park the terminal cursor below the display
      out += `\x1b[${screen.length + 2};1H`;
      process.stdout.write(out);
    }

    this._cache = screen;
  }
}

module.exports = { Renderer };
