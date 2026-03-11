#!/usr/bin/env node
'use strict';
const DEBUG = false;

// ── src/grid.js ─────────────────────────────────────
const ROWS = 12;
const COLS = 6;
const NUM_COLORS = 6;

function createGrid() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

// Generate a new row that won't immediately create a match
function generateRow(grid) {
  const row = [];
  for (let c = 0; c < COLS; c++) {
    let color, attempts = 0;
    do {
      color = Math.floor(Math.random() * NUM_COLORS) + 1;
      attempts++;
    } while (
      attempts < 20 && (
        // Prevent horizontal match in the new row
        (c >= 2 && row[c - 1] === color && row[c - 2] === color) ||
        // Prevent vertical match with existing bottom rows
        (grid[ROWS - 1]?.[c] === color && grid[ROWS - 2]?.[c] === color)
      )
    );
    row.push(color);
  }
  return row;
}

// Drop all blocks straight down to fill gaps (column by column)
function applyGravity(grid) {
  for (let c = 0; c < COLS; c++) {
    const blocks = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      if (grid[r][c] !== 0) blocks.push(grid[r][c]);
    }
    for (let r = ROWS - 1; r >= 0; r--) {
      grid[r][c] = blocks[ROWS - 1 - r] ?? 0;
    }
  }
}

// Return a Set of "r,c" keys for all cells that are part of a match (3+)
function findMatches(grid) {
  const matched = new Set();

  // Horizontal
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS - 2; c++) {
      const color = grid[r][c];
      if (!color) continue;
      if (grid[r][c + 1] === color && grid[r][c + 2] === color) {
        let end = c + 2;
        while (end + 1 < COLS && grid[r][end + 1] === color) end++;
        for (let i = c; i <= end; i++) matched.add(`${r},${i}`);
        c = end;
      }
    }
  }

  // Vertical
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS - 2; r++) {
      const color = grid[r][c];
      if (!color) continue;
      if (grid[r + 1][c] === color && grid[r + 2][c] === color) {
        let end = r + 2;
        while (end + 1 < ROWS && grid[end + 1]?.[c] === color) end++;
        for (let i = r; i <= end; i++) matched.add(`${i},${c}`);
        r = end;
      }
    }
  }

  return matched;
}

// ── src/abilities.js ─────────────────────────────────────
function rnd(n) { return Math.floor(Math.random() * n); }

// Returns the set of colors currently in game.clearing (grid values are intact during beforeClear)
function clearingColors(game) {
  const colors = new Set();
  for (const k of game.clearing) {
    const [r, c] = k.split(',').map(Number);
    if (game.grid[r][c]) colors.add(game.grid[r][c]);
  }
  return colors;
}

// Try to add a shape (array of [r,c]) to clearing, respecting level conditions:
//   lvl 1 — shape color must match a currently-clearing color
//   lvl 2 — shape color must match a currently-clearing color (same, but abilities use it for extended range)
//   lvl 3 — any single-color shape qualifies
function tryAddShape(game, lvl, shape, cc) {
  const color = game.grid[shape[0][0]][shape[0][1]];
  if (!color) return;
  if (!shape.every(([r, c]) => game.grid[r][c] === color)) return;
  if (lvl < 3 && cc.size > 0 && !cc.has(color)) return;
  const keys = shape.map(([r, c]) => `${r},${c}`);
  if (typeof DEBUG !== 'undefined' && DEBUG) console.log('[shape] adding', keys, 'color', color, 'lvl', lvl);
  for (const k of keys) game.clearing.add(k);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ABILITIES = [
  // ── Passive / pickup ──────────────────────────────────────────────────────

  {
    id: 'anchor',
    name: 'Anchor',
    maxLevel: 3,
    describe: (lvl) => `Freeze cap raised to ${4 + lvl * 2}s`,
    onPick: (game) => { game.freezeCap += 2000; },
  },

  {
    id: 'frenzy',
    name: 'Frenzy',
    maxLevel: 3,
    describe: (lvl) => `Freeze active: rise ${[25, 50, 100][lvl - 1]}% slower`,
    // Passive — read by game.riseInterval getter
  },

  // ── Row-added ────────────────────────────────────────────────────────────

  {
    id: 'glacial',
    name: 'Glacial',
    maxLevel: 3,
    describe: (lvl) => `+${['0.3', '0.5', '0.8'][lvl - 1]}s freeze per new row`,
    onEvent: 'rowAdded',
    apply: (game, lvl) => {
      const bonus = [300, 500, 800][lvl - 1];
      if (game.comboStop === 0) { game.comboCount = 0; game.comboLevel = 1; }
      game.comboStop = Math.min(game.freezeCap, game.comboStop + bonus);
    },
  },

  {
    id: 'painter',
    name: 'Painter',
    maxLevel: 3,
    describe: (lvl) => [`1 matching pair in new rows`, `2 matching pairs`, `guaranteed triplet`][lvl - 1],
    onEvent: 'rowAdded',
    apply: (game, lvl) => {
      const row = game.grid[ROWS - 1];
      if (lvl >= 3) {
        const c = rnd(COLS - 2);
        const color = row[c] || rnd(6) + 1;
        row[c] = row[c + 1] = row[c + 2] = color;
      } else {
        for (let p = 0; p < lvl; p++) {
          const c = rnd(COLS - 1);
          if (row[c])     row[c + 1] = row[c];
          else if (row[c + 1]) row[c] = row[c + 1];
        }
      }
    },
  },

  // ── rainmaker is counter-based, handled in AbilityManager ──

  {
    id: 'rainmaker',
    name: 'Rainmaker',
    maxLevel: 3,
    describe: (lvl) => `Every ${[5, 3, 2][lvl - 1]} new rows: top row → one color`,
    // handled in AbilityManager._handleRainmaker()
  },

  // ── Before clear (can add to clearing set) ───────────────────────────────

  {
    id: 'echo',
    name: 'Echo',
    maxLevel: 3,
    describe: (lvl) => `On manual swap: ${[15, 30, 50][lvl - 1]}% chance adjacent blocks join a clear`,
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      if (!game._swapPending) return;
      const chance = [0.15, 0.30, 0.50][lvl - 1];
      const extra = [];
      for (const key of game.clearing) {
        const [r, c] = key.split(',').map(Number);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS &&
              game.grid[nr][nc] && !game.clearing.has(`${nr},${nc}`) &&
              Math.random() < chance) {
            extra.push(`${nr},${nc}`);
          }
        }
      }
      for (const k of extra) game.clearing.add(k);
    },
  },

  // ── After clear ───────────────────────────────────────────────────────────

  {
    id: 'magnetism',
    name: 'Magnetism',
    maxLevel: 3,
    describe: (lvl) => `Same-color swap: pull matching blocks toward cursor in 2D (${['±2','±4','all'][lvl-1]} range)`,
    onEvent: 'swapMade',
    apply: (game, lvl, colorA, colorB) => {
      if (!colorA || colorA !== colorB) return; // only same-color swaps
      const color = colorA;
      const colRadius = lvl === 3 ? 999 : lvl * 2;
      const cc = game.cursorCol;
      const cr = game.cursorRow;
      const colMin = Math.max(0, cc - colRadius);
      const colMax = Math.min(COLS - 1, cc + 1 + colRadius);
      // Pull same-color blocks toward cursor. Each block moves in whichever direction
      // (H or V) brings it closer. Cascades by iterating from far to close so each
      // block can chain-move all the way through other blocks.
      // H pass: left side (iterate left→right so blocks cascade toward cursor col)
      for (let c = colMin; c < cc; c++) {
        for (let r = 0; r < ROWS; r++) {
          if (game.grid[r][c] !== color) continue;
          const dx = cc - c;
          const dy = Math.abs(r - cr);
          if (dx < dy) continue; // V-dominant block — skip here, handled in V pass
          const tmp = game.grid[r][c];
          game.grid[r][c] = game.grid[r][c + 1];
          game.grid[r][c + 1] = tmp;
        }
      }
      // H pass: right side (iterate right→left)
      for (let c = colMax; c > cc + 1; c--) {
        for (let r = 0; r < ROWS; r++) {
          if (game.grid[r][c] !== color) continue;
          const dx = c - (cc + 1);
          const dy = Math.abs(r - cr);
          if (dx < dy) continue;
          const tmp = game.grid[r][c];
          game.grid[r][c] = game.grid[r][c - 1];
          game.grid[r][c - 1] = tmp;
        }
      }
      // V pass: above cursor (iterate top→bottom so blocks cascade toward cursor row)
      for (let r = 0; r < cr; r++) {
        for (let c = colMin; c <= colMax; c++) {
          if (game.grid[r][c] !== color) continue;
          const dx = c < cc ? cc - c : c > cc + 1 ? c - (cc + 1) : 0;
          const dy = cr - r;
          if (dy <= dx) continue; // H-dominant block — already handled above
          const tmp = game.grid[r][c];
          game.grid[r][c] = game.grid[r + 1][c];
          game.grid[r + 1][c] = tmp;
        }
      }
      // V pass: below cursor (iterate bottom→top)
      for (let r = ROWS - 1; r > cr; r--) {
        for (let c = colMin; c <= colMax; c++) {
          if (game.grid[r][c] !== color) continue;
          const dx = c < cc ? cc - c : c > cc + 1 ? c - (cc + 1) : 0;
          const dy = r - cr;
          if (dy <= dx) continue;
          const tmp = game.grid[r][c];
          game.grid[r][c] = game.grid[r - 1][c];
          game.grid[r - 1][c] = tmp;
        }
      }
    },
  },

  // ── Block-landed ──────────────────────────────────────────────────────────

  {
    id: 'transmute',
    name: 'Transmute',
    maxLevel: 3,
    describe: (lvl) => `Landing block's color transmutes the block below it (${[33, 66, 100][lvl - 1]}% chance)`,
    onEvent: 'blockLanded',
    apply: (game, lvl, landed) => {
      const chance = [0.33, 0.66, 1.0][lvl - 1];
      for (const b of landed) {
        if (b.targetRow + 1 < ROWS && game.grid[b.targetRow + 1][b.col] && Math.random() < chance)
          game.grid[b.targetRow + 1][b.col] = b.color;
      }
    },
  },

  // ── Before clear (shape detectors) ───────────────────────────────────────

  {
    id: 'bomb',
    name: 'Bomb',
    maxLevel: 3,
    describe: (lvl) => `On manual swap: blast ${[2, 3, 4][lvl - 1]}×${[2, 3, 4][lvl - 1]} area at cursor`,
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      if (!game._swapPending) return;
      const size = lvl + 1; // 2, 3, 4
      const cr = game.cursorRow, cc = game.cursorCol;
      for (let dr = 0; dr < size; dr++)
        for (let dc = 0; dc < size; dc++) {
          const nr = cr + dr, nc = cc + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS && game.grid[nr][nc])
            game.clearing.add(`${nr},${nc}`);
        }
    },
  },

  {
    id: 'ripple',
    name: 'Ripple',
    maxLevel: 3,
    describe: (lvl) => `${[30, 60, 100][lvl - 1]}% chance same-color neighbors join a clear`,
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      const chance = [0.30, 0.60, 1.0][lvl - 1];
      const cc = clearingColors(game);
      const extra = [];
      for (const key of game.clearing) {
        const [r, c] = key.split(',').map(Number);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS &&
              game.grid[nr][nc] && cc.has(game.grid[nr][nc]) &&
              !game.clearing.has(`${nr},${nc}`) && Math.random() < chance)
            extra.push(`${nr},${nc}`);
        }
      }
      for (const k of extra) game.clearing.add(k);
    },
  },

  {
    id: 'lShape',
    name: 'L-Shape',
    maxLevel: 3,
    describe: (lvl) => [
      'L-triominoes of clearing color also clear',
      'L-triominoes of clearing color also clear',
      'All L-triominoes clear',
    ][lvl - 1],
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      const cc = clearingColors(game);
      // L-triomino: 3 cells in an L shape — all 4 rotations via 2×2 minus one corner
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          const corners = [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]];
          for (let skip = 0; skip < 4; skip++) {
            tryAddShape(game, lvl, corners.filter((_, i) => i !== skip), cc);
          }
        }
      }
    },
  },

  {
    id: 'square',
    name: 'Square',
    maxLevel: 3,
    describe: (lvl) => [
      '2×2 squares of clearing color also clear',
      '2×2 squares of clearing color also clear',
      'All 2×2 squares clear',
    ][lvl - 1],
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      const cc = clearingColors(game);
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          tryAddShape(game, lvl, [[r, c], [r, c + 1], [r + 1, c], [r + 1, c + 1]], cc);
        }
      }
    },
  },

  {
    id: 'diagonal',
    name: 'Diagonal',
    maxLevel: 3,
    describe: (lvl) => [
      'Diagonal 3-runs of clearing color also clear',
      'Diagonal 2-runs of clearing color also clear',
      'All diagonal 2-runs clear',
    ][lvl - 1],
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      const cc = clearingColors(game);
      const minLen = lvl >= 2 ? 2 : 3;
      for (const [dr, dc] of [[1, 1], [1, -1]]) {
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const color = game.grid[r][c];
            if (!color) continue;
            let len = 1;
            while (true) {
              const nr = r + len * dr, nc = c + len * dc;
              if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS || game.grid[nr][nc] !== color) break;
              len++;
            }
            if (len < minLen) continue;
            const shape = Array.from({ length: len }, (_, i) => [r + i * dr, c + i * dc]);
            tryAddShape(game, lvl, shape, cc);
          }
        }
      }
    },
  },

  {
    id: 'equalSign',
    name: 'Equal Sign',
    maxLevel: 3,
    describe: (lvl) => [
      'Parallel lines of 2+ clearing color also clear',
      'Parallel lines of 2+ clearing color also clear',
      'All parallel lines of 2+ clear',
    ][lvl - 1],
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      const cc = clearingColors(game);
      // Horizontal: two parallel rows 1 apart, same columns, same color
      for (let r = 0; r < ROWS - 1; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          const color = game.grid[r][c];
          if (!color) continue;
          let len = 1;
          while (c + len < COLS && game.grid[r][c + len] === color) len++;
          if (len < 2) continue;
          if (!Array.from({ length: len }, (_, i) => game.grid[r + 1][c + i]).every(v => v === color)) continue;
          const shape = [];
          for (let i = 0; i < len; i++) { shape.push([r, c + i]); shape.push([r + 1, c + i]); }
          tryAddShape(game, lvl, shape, cc);
        }
      }
      // Vertical: two parallel columns 1 apart, same rows, same color
      for (let c = 0; c < COLS - 1; c++) {
        for (let r = 0; r < ROWS - 1; r++) {
          const color = game.grid[r][c];
          if (!color) continue;
          let len = 1;
          while (r + len < ROWS && game.grid[r + len][c] === color) len++;
          if (len < 2) continue;
          if (!Array.from({ length: len }, (_, i) => game.grid[r + i][c + 1]).every(v => v === color)) continue;
          const shape = [];
          for (let i = 0; i < len; i++) { shape.push([r + i, c]); shape.push([r + i, c + 1]); }
          tryAddShape(game, lvl, shape, cc);
        }
      }
    },
  },

  {
    id: 'zShape',
    name: 'Z-Shape',
    maxLevel: 3,
    describe: (lvl) => [
      'Z/S-tetrominoes of clearing color also clear',
      'Z/S-tetrominoes of clearing color also clear',
      'All Z/S-tetrominoes clear',
    ][lvl - 1],
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      const cc = clearingColors(game);
      // Z-tetromino: two 2-cell rows offset by 1 col. All 4 variants (Z, S, vertical Z, vertical S).
      const templates = [
        [[0, 0], [0, 1], [1, 1], [1, 2]], // Z horizontal
        [[0, 1], [0, 2], [1, 0], [1, 1]], // S horizontal
        [[0, 1], [1, 0], [1, 1], [2, 0]], // Z vertical
        [[0, 0], [1, 0], [1, 1], [2, 1]], // S vertical
      ];
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          for (const tmpl of templates) {
            const shape = tmpl.map(([dr, dc]) => [r + dr, c + dc]);
            if (shape.some(([sr, sc]) => sr >= ROWS || sc >= COLS || sc < 0)) continue;
            tryAddShape(game, lvl, shape, cc);
          }
        }
      }
    },
  },

  // ── Chain-triggered ───────────────────────────────────────────────────────

  {
    id: 'aftershock',
    name: 'Aftershock',
    maxLevel: 3,
    describe: (lvl) => `On x2+ chain: destroy ${[1, 2, 3][lvl - 1]} random block${lvl > 1 ? 's' : ''}`,
    onEvent: 'chainFired',
    apply: (game, lvl, chainCount) => {
      if (chainCount < 2) return;
      const cells = [];
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++)
          if (game.grid[r][c]) cells.push([r, c]);
      shuffle(cells).slice(0, lvl).forEach(([r, c]) => { game.grid[r][c] = 0; });
      applyGravity(game.grid);
    },
  },

  {
    id: 'overclock',
    name: 'Overclock',
    maxLevel: 3,
    describe: (lvl) => `On x3+ chain: score ×${[2, 3, 4][lvl - 1]} for 8s`,
    onEvent: 'chainFired',
    apply: (game, lvl, chainCount) => {
      if (chainCount < 3) return;
      game.overclockMult  = [2, 3, 4][lvl - 1];
      game.overclockTimer = 8000;
    },
  },

  // ── Panic / stack-height (tick-based, handled in AbilityManager) ──────────

  {
    id: 'panicShield',
    name: 'Panic Shield',
    maxLevel: 3,
    describe: (lvl) => `Stack >80%: auto-remove top row (${[30, 20, 10][lvl - 1]}s cd)`,
    // handled in AbilityManager.tick()
  },

  // ── Combo-ended ───────────────────────────────────────────────────────────

  {
    id: 'colorblind',
    name: 'Colorblind',
    maxLevel: 3,
    describe: (lvl) => `Combo end: unify ${[1, 2, 3][lvl - 1]} sparse column${lvl > 1 ? 's' : ''}`,
    onEvent: 'comboEnded',
    apply: (game, lvl) => {
      const byCoverage = Array.from({ length: COLS }, (_, c) => ({
        c,
        n: game.grid.reduce((s, row) => s + (row[c] ? 1 : 0), 0),
      })).sort((a, b) => a.n - b.n);

      for (let i = 0; i < Math.min(lvl, COLS); i++) {
        const col = byCoverage[i].c;
        const freq = new Array(7).fill(0);
        for (let r = 0; r < ROWS; r++) if (game.grid[r][col]) freq[game.grid[r][col]]++;
        const majority = freq.indexOf(Math.max(...freq.slice(1)));
        if (!majority) continue;
        for (let r = 0; r < ROWS; r++) if (game.grid[r][col]) game.grid[r][col] = majority;
      }
    },
  },
];

// ── src/abilityManager.js ─────────────────────────────────────
class AbilityManager {
  constructor(game) {
    this.game       = game;
    this.levels     = new Map(); // id -> current level (1-based)
    this._cooldowns = new Map(); // id -> ms remaining
    this._counters  = new Map(); // id -> counter value
  }

  level(id) { return this.levels.get(id) || 0; }

  pick(id) {
    const ability  = ABILITIES.find(a => a.id === id);
    const newLevel = this.level(id) + 1;
    this.levels.set(id, newLevel);
    ability.onPick?.(this.game, newLevel);
  }

  emit(event, ...args) {
    // Counter-based abilities handled before generic routing
    if (event === 'rowAdded')  this._handleRainmaker();

    for (const [id, level] of this.levels) {
      const ability = ABILITIES.find(a => a.id === id);
      if (ability?.onEvent === event) {
        ability.apply(this.game, level, ...args);
      }
    }
  }

  tick(dt) {
    // Decay cooldowns
    for (const [id, cd] of this._cooldowns) {
      const next = cd - dt;
      if (next <= 0) this._cooldowns.delete(id);
      else           this._cooldowns.set(id, next);
    }

    // Panic Shield: auto-remove top row when stack is critical
    const panicLvl = this.level('panicShield');
    if (panicLvl > 0 && !this._cooldowns.has('panicShield')) {
      if (this._stackHeight() / ROWS > 0.8) {
        for (let r = 0; r < ROWS; r++) {
          if (this.game.grid[r].some(v => v !== 0)) {
            this.game.grid[r].fill(0);
            break;
          }
        }
        this._cooldowns.set('panicShield', [30000, 20000, 10000][panicLvl - 1]);
      }
    }
  }

  // Return up to n ability options (unowned preferred, never max-level)
  getOptions(n = 3) {
    const available = ABILITIES.filter(a => this.level(a.id) < a.maxLevel);
    if (available.length === 0) return [];
    const unowned = available.filter(a => !this.levels.has(a.id));
    const owned   = available.filter(a =>  this.levels.has(a.id));
    // Weighted pool: prefer unowned
    const pool = shuffle([...unowned, ...unowned, ...owned]); // unowned 2× weight
    const seen = new Set();
    const result = [];
    for (const a of pool) {
      if (!seen.has(a.id)) { seen.add(a.id); result.push(a); }
      if (result.length >= n) break;
    }
    return result;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _stackHeight() {
    for (let r = 0; r < ROWS; r++)
      if (this.game.grid[r].some(v => v !== 0)) return ROWS - r;
    return 0;
  }

  _handleRainmaker() {
    const lvl = this.level('rainmaker');
    if (!lvl) return;
    const threshold = [5, 3, 2][lvl - 1];
    const count = (this._counters.get('rainmaker') || 0) + 1;
    if (count >= threshold) {
      this._counters.set('rainmaker', 0);
      const color = rnd(6) + 1;
      for (let r = 0; r < ROWS; r++) {
        if (this.game.grid[r].some(v => v !== 0)) {
          for (let c = 0; c < COLS; c++)
            if (this.game.grid[r][c]) this.game.grid[r][c] = color;
          break;
        }
      }
    } else {
      this._counters.set('rainmaker', count);
    }
  }

}

// ── src/game.js ─────────────────────────────────────
const CLEAR_DURATION   = 500;
const BASE_RISE_MS     = 4000;
const MIN_RISE_MS      = 500;
const FALL_SPEED       = 18;
const COMBO_STOP_BASE  = 1500;
const COMBO_STOP_CHAIN = 800;

// Level is derived from score: level 1 = 0–499, level 2 = 500–999, level 3 = 1000–1999, ...
// Each level threshold doubles: 500 × 2^(n-2) for n ≥ 2
function scoreToLevel(score) {
  return score < 500 ? 1 : 2 + Math.floor(Math.log2(score / 500));
}

class Game {
  constructor() {
    this.grid      = createGrid();
    this.cursorRow = Math.floor(ROWS * 0.6);
    this.cursorCol = Math.floor(COLS / 2) - 1;

    this.clearing   = new Set();
    this.clearTimer = 0;
    this.chainCount = 0;

    this.fallingBlocks  = [];
    this._fallChain     = 0;
    this._gravityDelay   = 0; // ms remaining before _startGravity fires after a swap
    this._pendingGravity = false; // swap happened during a fall; re-check gravity after

    this.riseTimer  = 0;
    this.comboStop  = 0;
    this.comboLevel = 0;
    this.comboCount = 0;

    // Ability-related state
    this.freezeCap      = 5000;
    this.overclockMult  = 1;
    this.overclockTimer = 0;

    this.score        = 0;
    this.pendingScore = 0; // accumulates during a chain, flushed to score when chain ends
    this.level = 1;
    this.time  = 0;

    this.pickOptions  = []; // array of ability objects shown during 'picking'
    this._pendingPick = false; // level-up reached mid-chain; show pick after chain ends

    // 'playing' | 'falling' | 'clearing' | 'paused' | 'picking' | 'gameOver'
    this.state = 'playing';

    this.abilities = new AbilityManager(this);

    if (typeof DEBUG !== 'undefined' && DEBUG) {
      this.abilities.pick('square');
      this.abilities.pick('square');
      this.abilities.pick('square'); // level 3: any color
    }

    for (let i = 0; i < Math.floor(ROWS / 2); i++) {
      this._addInitialRow();
    }
  }

  get riseInterval() {
    let base = Math.max(MIN_RISE_MS, BASE_RISE_MS - (this.level - 1) * 350);
    if (this.comboStop > 0) {
      const frenzyLvl = this.abilities.level('frenzy');
      if (frenzyLvl > 0) base *= [1.25, 1.5, 2.0][frenzyLvl - 1];
    }
    return base;
  }

  tick(dt) {
    if (this.state === 'gameOver' || this.state === 'paused' || this.state === 'picking') return;

    this.time += dt;

    // Overclock score-multiplier countdown
    if (this.overclockTimer > 0) {
      this.overclockTimer -= dt;
      if (this.overclockTimer <= 0) { this.overclockTimer = 0; this.overclockMult = 1; }
    }

    // Combo freeze countdown
    if (this.comboStop > 0) {
      this.comboStop -= dt;
      if (this.comboStop <= 0) {
        this.comboStop  = 0;
        this.comboCount = 0;
        this.comboLevel = 0;
        this.abilities.emit('comboEnded');
      }
    }

    this.abilities.tick(dt);

    // Rise is blocked while clearing, falling, or combo-frozen
    const riseBlocked = this.state === 'clearing' ||
                        this.fallingBlocks.length > 0 ||
                        this.comboStop > 0;
    if (!riseBlocked) {
      this.riseTimer += dt;
      if (this.riseTimer >= this.riseInterval) {
        this.riseTimer -= this.riseInterval;
        this._rise();
        if (this.state === 'gameOver') return;
      }
    }

    // Gravity delay: brief pause after swap so swapped position is visible before falling
    if (this._gravityDelay > 0) {
      this._gravityDelay -= dt;
      if (this._gravityDelay <= 0) {
        this._gravityDelay = 0;
        this._startGravity(0);
      }
      return;
    }

    // Animated gravity
    if (this.fallingBlocks.length > 0) {
      const rowsPerMs = FALL_SPEED / 1000;
      let anyLanded = false;
      for (const b of this.fallingBlocks) {
        b.row = Math.min(b.targetRow, b.row + rowsPerMs * dt);
        if (b.row >= b.targetRow) {
          this.grid[b.targetRow][b.col] = b.color;
          b.landed = true;
          anyLanded = true;
        }
      }
      if (anyLanded) {
        const justLanded = this.fallingBlocks.filter(b => b.landed);
        this.fallingBlocks = this.fallingBlocks.filter(b => !b.landed);
        this.abilities.emit('blockLanded', justLanded);
        if (this.fallingBlocks.length === 0) this._checkMatches(this._fallChain);
      }
      return;
    }

    if (this.state === 'clearing') {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) this._resolveClearing();
    }
  }

  swap() {
    if (this.state === 'gameOver' || this.state === 'paused' || this.state === 'picking') return false;

    const r = this.cursorRow, c = this.cursorCol;
    if (this.clearing.has(`${r},${c}`) || this.clearing.has(`${r},${c + 1}`)) return false;

    const colorA = this.grid[r][c], colorB = this.grid[r][c + 1];
    const tmp           = this.grid[r][c];
    this.grid[r][c]     = this.grid[r][c + 1];
    this.grid[r][c + 1] = tmp;

    this._swapPending = true;
    this.abilities.emit('swapMade', colorA, colorB);

    if (this.state !== 'clearing' && this.fallingBlocks.length === 0) {
      this._gravityDelay = 100; // show swapped position briefly before falling
    } else if (this.fallingBlocks.length > 0) {
      this._pendingGravity = true; // re-check gravity after current fall resolves
    }
    return true;
  }

  // Called when the player presses 1/2/3 on the pick screen
  pick(choice) {
    if (this.state !== 'picking') return;
    const ability = this.pickOptions[choice];
    if (ability) this.abilities.pick(ability.id);
    this.pickOptions = [];
    this._checkLevelUp();
    if (this._pendingPick) {
      this._pendingPick = false;
      // stay in 'picking' with the new options
    } else {
      this.state = 'playing';
    }
  }

  togglePause() {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }

  moveLeft()  { if (this.cursorCol > 0)        this.cursorCol--; }
  moveRight() { if (this.cursorCol < COLS - 2)  this.cursorCol++; }
  moveUp()    { if (this.cursorRow > 0)         this.cursorRow--; }
  moveDown()  { if (this.cursorRow < ROWS - 1)  this.cursorRow++; }

  raise() {
    if (this.state === 'gameOver' || this.state === 'paused' || this.state === 'picking') return;
    this._rise();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _checkMatches(chainCount) {
    const matches = findMatches(this.grid);
    this.clearing = matches;
    // Always emit beforeClear so shape abilities can trigger independently
    this.abilities.emit('beforeClear');
    this._swapPending = false;
    if (this.clearing.size > 0) {
      this.clearTimer = CLEAR_DURATION;
      this.chainCount = chainCount;
      this.state      = 'clearing';

      // Notify chain-triggered abilities
      if (chainCount > 0) this.abilities.emit('chainFired', chainCount);

      // Combo session counter (manual + chains both count)
      this.comboCount++;
      this.comboLevel = this.comboCount;

      const chainMult = Math.pow(2, chainCount);
      const comboMult = this.comboCount;
      this.pendingScore += Math.floor(this.clearing.size * 10 * chainMult * comboMult * this.level * this.overclockMult);

      const freeze = (COMBO_STOP_BASE * this.comboCount + chainCount * COMBO_STOP_CHAIN) * this.level;
      this.comboStop = Math.min(this.freezeCap, Math.max(this.comboStop, freeze));
    } else {
      // Chain complete — flush pending points into score
      this.score       += this.pendingScore;
      this.pendingScore = 0;
      this.chainCount   = 0;
      this._checkLevelUp(); // sets _pendingPick if level increased
      if (this._pendingPick) {
        this._pendingPick = false;
        this.state = 'picking';
      } else if (this._pendingGravity) {
        this._pendingGravity = false;
        this._startGravity(0);
      } else {
        this.state = 'playing';
      }
    }
  }

  _resolveClearing() {
    for (const key of this.clearing) {
      const [r, c] = key.split(',').map(Number);
      this.grid[r][c] = 0;
    }
    this.clearing = new Set();
    this.abilities.emit('afterClear');
    this._startGravity(this.chainCount + 1);
  }

  _startGravity(chainAfter) {
    this._fallChain = chainAfter;
    const newFalling = [];
    for (let c = 0; c < COLS; c++) {
      const blocks = [];
      for (let r = 0; r < ROWS; r++)
        if (this.grid[r][c]) blocks.push({ color: this.grid[r][c], fromRow: r });
      for (let r = 0; r < ROWS; r++) this.grid[r][c] = 0;
      blocks.forEach((b, i) => {
        const targetRow = ROWS - blocks.length + i;
        if (targetRow !== b.fromRow) newFalling.push({ color: b.color, col: c, row: b.fromRow, targetRow });
        else this.grid[b.fromRow][c] = b.color;
      });
    }
    if (newFalling.length > 0) { this.fallingBlocks = newFalling; this.state = 'falling'; this._pendingGravity = false; }
    else this._checkMatches(chainAfter);
  }

  _rise() {
    if (this.grid[0].some(v => v !== 0)) { this.state = 'gameOver'; return; }
    for (let r = 0; r < ROWS - 1; r++) this.grid[r] = [...this.grid[r + 1]];
    this.grid[ROWS - 1] = generateRow(this.grid);
    if (this.cursorRow > 0) this.cursorRow--;
    for (const b of this.fallingBlocks) { b.row--; b.targetRow--; }
    this.fallingBlocks = this.fallingBlocks.filter(b => b.targetRow >= 0);
    this.abilities.emit('rowAdded');
  }

  _addInitialRow() {
    if (this.grid[0].some(v => v !== 0)) return;
    for (let r = 0; r < ROWS - 1; r++) this.grid[r] = [...this.grid[r + 1]];
    this.grid[ROWS - 1] = generateRow(this.grid);
  }

  _checkLevelUp() {
    const newLevel = scoreToLevel(this.score);
    if (newLevel > this.level) {
      this.level = newLevel;
      const options = this.abilities.getOptions(3);
      if (options.length > 0) {
        this.pickOptions  = options;
        this._pendingPick = true;
      }
    }
  }
}

// ── platforms/tty/input.js ─────────────────────────────────────
const INITIAL_DELAY   =  80; // ms before repeat kicks in after first press
const REPEAT_INTERVAL =  40; // ms between repeated moves while held
const RELEASE_TIMEOUT = 100; // ms of silence = key released

class Input {
  constructor() {
    this._handlers    = {};
    this._heldDir     = null;
    this._delayTimer  = null;
    this._repeatTimer = null;
    this._releaseTimer = null;
  }

  on(event, fn) {
    this._handlers[event] = fn;
    return this;
  }

  start() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', this._onData.bind(this));
  }

  stop() {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    this._stopRepeat();
  }

  _emit(event) {
    this._handlers[event]?.();
  }

  _onData(key) {
    const action = this._keyToRepeatable(key);
    if (action) {
      if (action !== this._heldDir) {
        // New action: fire immediately and start repeat sequence
        this._stopRepeat();
        this._heldDir = action;
        this._emit(action);
        this._delayTimer = setTimeout(() => {
          this._delayTimer  = null;
          this._repeatTimer = setInterval(() => this._emit(action), REPEAT_INTERVAL);
        }, INITIAL_DELAY);
      }
      // Either way, reset the release watchdog
      clearTimeout(this._releaseTimer);
      this._releaseTimer = setTimeout(() => this._stopRepeat(), RELEASE_TIMEOUT);
      return;
    }

    // Non-repeatable key
    this._stopRepeat();
    switch (key) {
      case 'z': case ' ':    this._emit('swap');    break;
      case 'p':              this._emit('pause');   break;
      case 'r':              this._emit('restart'); break;
      case '1':              this._emit('pick1');   break;
      case '2':              this._emit('pick2');   break;
      case '3':              this._emit('pick3');   break;
      case 'q': case '\x03': case '\x1b': this._emit('quit'); break;
    }
  }

  _stopRepeat() {
    clearTimeout(this._delayTimer);
    clearInterval(this._repeatTimer);
    clearTimeout(this._releaseTimer);
    this._delayTimer   = null;
    this._repeatTimer  = null;
    this._releaseTimer = null;
    this._heldDir      = null;
  }

  _keyToRepeatable(key) {
    switch (key) {
      case '\x1b[A': case 'w': return 'up';
      case '\x1b[B': case 's': return 'down';
      case '\x1b[C': case 'd': return 'right';
      case '\x1b[D': case 'a': return 'left';
      case 'x':                return 'raise';
    }
    return null;
  }
}

// ── platforms/tty/renderer.js ─────────────────────────────────────
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

    const stateTag = game.state === 'paused'   ? ` ${BOLD}\x1b[93m[PAUSED]${RST}`
                   : game.state === 'picking'  ? ` ${BOLD}\x1b[92m[PICK ABILITY]${RST}`
                   : game.state === 'clearing' ? ` ${DIM}[CLEARING]${RST}`
                   : game.state === 'falling'  ? ` ${DIM}[FALLING]${RST}`
                   : '';

    const panel = [
      `${BOLD}Tetris Attack TTY${RST}`,
      '',
      `Score  ${String(game.score).padStart(7)}`,
      game.pendingScore > 0 ? `\x1b[93m${BOLD}+${String(game.pendingScore).padStart(6)}${RST}` : '',
      `Level  ${String(game.level).padStart(7)}`,
      `Time   ${mm}:${ss}`,
      `Chain  ${chainStr}`,
      `Combo  ${comboStr}`,
      stateTag,
      overclockStr,
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

// ── platforms/tty/index.js ─────────────────────────────────────
class TtyPlatform {
  constructor() {
    this._input    = new Input();
    this._renderer = new Renderer();
  }

  // Called by engine; `onInput(event)` is called for every user action
  init(onInput) {
    const events = [
      'quit', 'restart',
      'left', 'right', 'up', 'down',
      'swap', 'raise',
      'pick1', 'pick2', 'pick3',
      'pause',
    ];
    for (const e of events) this._input.on(e, () => onInput(e));
    this._input.start();

    process.stdout.on('resize', () => { this._renderer._firstRender = true; });
    process.on('SIGINT',  () => onInput('quit'));
    process.on('SIGTERM', () => onInput('quit'));
  }

  render(game, now) {
    this._renderer.render(game, now);
  }

  // Called by engine when a new game starts
  reset() {
    this._renderer._firstRender = true;
  }

  // Called by engine on quit
  destroy() {
    this._input.stop();
    this._renderer.cleanup();
    process.stdout.write('\x1b[2J\x1b[H');
    process.exit(0);
  }
}

// ── src/engine.js ─────────────────────────────────────
const FPS        = 30;
const FRAME_TIME = Math.floor(1000 / FPS);

const INPUT_HANDLERS = {
  left:  g => g.moveLeft(),
  right: g => g.moveRight(),
  up:    g => g.moveUp(),
  down:  g => g.moveDown(),
  swap:  g => g.swap(),
  raise: g => g.raise(),
  pick1: g => g.pick(0),
  pick2: g => g.pick(1),
  pick3: g => g.pick(2),
  pause: g => g.togglePause(),
};

class Engine {
  constructor(platform) {
    this._platform = platform;
    this._game     = null;
    this._loop     = null;
    this._lastTime = 0;
  }

  start() {
    this._newGame();
    this._platform.init(event => this._handleInput(event));
    this._lastTime = Date.now();
    this._loop = setInterval(() => this._tick(), FRAME_TIME);
  }

  stop() {
    clearInterval(this._loop);
    this._loop = null;
    this._platform.destroy();
  }

  _newGame() {
    this._game = new Game();
    if (this._platform.reset) this._platform.reset();
  }

  _tick() {
    const now = Date.now();
    this._game.tick(now - this._lastTime);
    this._lastTime = now;
    this._platform.render(this._game, now);
  }

  _handleInput(event) {
    if (event === 'quit')    { this.stop(); return; }
    if (event === 'restart') { this._newGame(); return; }
    INPUT_HANDLERS[event]?.(this._game);
  }
}

// ── index.js ─────────────────────────────────────
new Engine(new TtyPlatform()).start();
