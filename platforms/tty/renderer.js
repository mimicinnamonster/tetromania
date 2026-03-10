const { ROWS, COLS } = require('../../src/grid');

const RST  = '\x1b[0m';
const DIM  = '\x1b[2m';
const BOLD = '\x1b[1m';
const WHT  = '\x1b[97m';

const FG = [
  null,
  '\x1b[91m', // 1 bright red
  '\x1b[92m', // 2 bright green
  '\x1b[94m', // 3 bright blue
  '\x1b[93m', // 4 bright yellow
  '\x1b[95m', // 5 bright magenta
  '\x1b[96m', // 6 bright cyan
];

const RAINBOW = ['\x1b[91m', '\x1b[93m', '\x1b[92m', '\x1b[96m', '\x1b[94m', '\x1b[95m'];

// Option key colors for pick screen
const PICK_FG = ['\x1b[92m', '\x1b[93m', '\x1b[96m'];

function cell(color, clearing, cursor, flashOn, blockW, cursorBlink) {
  const block = '█'.repeat(blockW);
  const fade  = '▓'.repeat(blockW);
  const empty = ' '.repeat(blockW);

  if (clearing) {
    return (flashOn ? `${FG[color]}${fade}` : `${WHT}${fade}`) + RST;
  }
  if (color) {
    if (cursor) {
      return cursorBlink
        ? `${WHT}${block}${RST}`
        : `${FG[color]}${'▓'.repeat(blockW)}${RST}`;
    }
    return `${FG[color]}${block}${RST}`;
  }
  return cursor
    ? (cursorBlink ? `${WHT}${'░'.repeat(blockW)}${RST}` : `${WHT}${'▒'.repeat(blockW)}${RST}`)
    : empty;
}

// Wrap text to fit within `width` chars, returning an array of lines
function wrapText(text, width) {
  if (text.length <= width) return [text];
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width) { line = candidate; }
    else { if (line) lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// Build the inner lines for the ability pick screen
function buildPickLines(game, blockW, cellHeight) {
  const W     = COLS * blockW;            // inner visible width
  const total = ROWS * cellHeight;         // total inner lines needed

  const pad    = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
  const center = (s, w) => {
    const l = Math.floor((w - s.length) / 2);
    return ' '.repeat(l) + s + ' '.repeat(w - s.length - l);
  };
  const stars = (lvl, max) => '●'.repeat(lvl) + '○'.repeat(max - lvl);

  const lines = [];

  // Header
  lines.push(center('', W));
  lines.push(`${BOLD}${WHT}${center('✦  ABILITY SELECT  ✦', W)}${RST}`);
  lines.push(`${DIM}${center('press 1, 2 or 3', W)}${RST}`);
  lines.push(center('', W));

  // 3 cards
  for (let i = 0; i < game.pickOptions.length; i++) {
    const ability = game.pickOptions[i];
    const curLvl  = game.abilities.level(ability.id);
    const newLvl  = curLvl + 1;
    const color   = PICK_FG[i];

    // Title line: "[1] Name      ●●○" or "[1] Name      NEW"
    const key      = `[${i + 1}]`;
    const lvlTag   = curLvl > 0 ? `Lv${curLvl}→${newLvl} ${stars(newLvl, ability.maxLevel)}` : `NEW ${stars(1, ability.maxLevel)}`;
    const titleVis = `${key} ${ability.name}  ${lvlTag}`;
    lines.push(`${color}${BOLD}${pad(titleVis, W)}${RST}`);

    // Description — word-wrapped to fit
    const descWidth = W - 4;
    const descLines = wrapText(ability.describe(newLvl), descWidth);
    for (const dl of descLines) {
      lines.push(`${DIM}    ${pad(dl, descWidth)}${RST}`);
    }

    lines.push(center('', W));
  }

  // Pad remaining with empty lines
  while (lines.length < total) lines.push(' '.repeat(W));

  return lines.slice(0, total);
}

class Renderer {
  constructor() {
    this._firstRender = true;
    this._cache       = [];
  }

  init() {
    process.stdout.write('\x1b[?25l');
    process.stdout.write('\x1b[2J\x1b[H');
    this._cache       = [];
    this._firstRender = false;
  }

  cleanup() {
    process.stdout.write('\x1b[?25h');
    process.stdout.write('\x1b[0m');
  }

  render(game, now) {
    if (this._firstRender) this.init();

    const termRows   = process.stdout.rows || 24;
    const cellHeight = Math.max(1, Math.floor((termRows - 2) / ROWS));
    const blockW     = cellHeight * 2;

    const flashOn    = Math.floor(now / 120) % 2 === 0;
    const cursorBlink = Math.floor(now / 500) % 2 === 0;

    // Rainbow border during combo freeze
    let borderColor = '';
    if (game.comboStop > 0) {
      const period = Math.max(75, 600 / Math.pow(2, game.comboLevel - 1));
      borderColor  = RAINBOW[Math.floor(now / period) % RAINBOW.length];
    }
    const B = (s) => borderColor ? `${borderColor}${s}${RST}` : s;

    // Falling-block lookup
    const falling = new Map();
    for (const b of game.fallingBlocks) {
      const r = Math.min(Math.floor(b.row), ROWS - 1);
      if (r >= 0) falling.set(`${r},${b.col}`, b.color);
    }

    // ── Build grid lines (or pick screen) ────────────────────────────────────
    const gridLines = [];
    gridLines.push(`${B('┌')}${B('─'.repeat(COLS * blockW))}${B('┐')}`);

    if (game.state === 'picking') {
      const innerLines = buildPickLines(game, blockW, cellHeight);
      for (const line of innerLines) {
        gridLines.push(`${B('│')}${line}${B('│')}`);
      }
    } else {
      for (let r = 0; r < ROWS; r++) {
        let line = B('│');
        for (let c = 0; c < COLS; c++) {
          const color    = falling.get(`${r},${c}`) ?? game.grid[r][c];
          const clearing = game.clearing.has(`${r},${c}`);
          const cursor   = game.state !== 'gameOver' && game.state !== 'picking' &&
                           r === game.cursorRow &&
                           (c === game.cursorCol || c === game.cursorCol + 1);
          line += cell(color, clearing, cursor, flashOn, blockW, cursorBlink);
        }
        line += B('│');
        for (let h = 0; h < cellHeight; h++) gridLines.push(line);
      }
    }

    gridLines.push(`${B('└')}${B('─'.repeat(COLS * blockW))}${B('┘')}`);

    // ── Side panel ────────────────────────────────────────────────────────────
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

    let overclockStr = '';
    if (game.overclockTimer > 0) {
      const secs = (game.overclockTimer / 1000).toFixed(1);
      overclockStr = `\x1b[93m${BOLD}x${game.overclockMult} OVERCLOCK ${DIM}${secs}s${RST}`;
    }

    const wideStr = game.wideswapReady ? `\x1b[96m${BOLD}WIDESWAP READY${RST}` : '';

    const stateTag = game.state === 'paused'   ? ` ${BOLD}\x1b[93m[PAUSED]${RST}`
                   : game.state === 'picking'  ? ` ${BOLD}\x1b[92m[PICK ABILITY]${RST}`
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
      overclockStr,
      wideStr,
      '',
      `${DIM}Controls${RST}`,
      `${DIM}←→↑↓   Move${RST}`,
      `${DIM}Z/Spc   Swap${RST}`,
      `${DIM}X       Raise${RST}`,
      `${DIM}1/2/3   Pick${RST}`,
      `${DIM}P       Pause${RST}`,
      `${DIM}Q       Quit${RST}`,
      `${DIM}R       Restart${RST}`,
    ];

    // ── Compose screen lines ──────────────────────────────────────────────────
    const screen = gridLines.map((g, i) =>
      panel[i] !== undefined ? g + '  ' + panel[i] : g
    );

    // ── Game over overlay ─────────────────────────────────────────────────────
    if (game.state === 'gameOver') {
      const inner  = COLS * blockW;
      const center = (text) => {
        const l = Math.floor((inner - text.length) / 2);
        return ' '.repeat(l) + text + ' '.repeat(inner - text.length - l);
      };
      const mid = 1 + Math.floor(ROWS / 2) * cellHeight;
      screen[mid]     = `│\x1b[41m${WHT}${BOLD}${center('GAME OVER')}${RST}│`;
      screen[mid + 1] = `│\x1b[41m${WHT}${center(`Score: ${game.score}`)}${RST}│`;
      screen[mid + 2] = `│\x1b[41m${WHT}${center('R: Restart   Q: Quit')}${RST}│`;
    }

    // ── Diff render ───────────────────────────────────────────────────────────
    let out = '';
    for (let i = 0; i < screen.length; i++) {
      if (screen[i] !== this._cache[i]) out += `\x1b[${i + 1};1H${screen[i]}\x1b[K`;
    }
    if (out) {
      out += `\x1b[${screen.length + 2};1H`;
      process.stdout.write(out);
    }
    this._cache = screen;
  }
}

module.exports = { Renderer };
