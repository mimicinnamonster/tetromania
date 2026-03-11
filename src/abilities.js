const { ROWS, COLS, applyGravity } = require('./grid');

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
    describe: (lvl) => `On manual swap: ${[15, 25, 35][lvl - 1]}% chance adjacent blocks join a clear`,
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      if (!game._swapPending) return;
      const chance = [0.15, 0.25, 0.35][lvl - 1];
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
    describe: (lvl) => `On manual swap: ${[15, 25, 35][lvl - 1]}% chance to blast 2×2 area at cursor`,
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      if (!game._swapPending) return;
      const chance = [0.15, 0.25, 0.35][lvl - 1];
      if (Math.random() >= chance) return;
      const cr = game.cursorRow, cc = game.cursorCol;
      for (let dr = 0; dr < 2; dr++)
        for (let dc = 0; dc < 2; dc++) {
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
    describe: (lvl) => `${[15, 25, 35][lvl - 1]}% chance same-color neighbors join a clear (cascades)`,
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
      const chance = [0.15, 0.25, 0.35][lvl - 1];
      const cc = clearingColors(game);
      const frontier = [...game.clearing];
      while (frontier.length > 0) {
        const key = frontier.pop();
        const [r, c] = key.split(',').map(Number);
        for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS &&
              game.grid[nr][nc] && cc.has(game.grid[nr][nc]) &&
              !game.clearing.has(`${nr},${nc}`) && Math.random() < chance) {
            game.clearing.add(`${nr},${nc}`);
            frontier.push(`${nr},${nc}`);
          }
        }
      }
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
    describe: (lvl) => `On x2+ combo: destroy ${[1, 2, 3][lvl - 1]} random block${lvl > 1 ? 's' : ''}`,
    onEvent: 'comboEnded',
    apply: (game, lvl, comboCount) => {
      if (comboCount < 2) return;
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

module.exports = { ABILITIES, shuffle, rnd };
