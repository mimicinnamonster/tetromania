#!/usr/bin/env node
'use strict';

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

  // ── rainmaker and wideswap are counter-based, handled in AbilityManager ──

  {
    id: 'rainmaker',
    name: 'Rainmaker',
    maxLevel: 3,
    describe: (lvl) => `Every ${[5, 3, 2][lvl - 1]} new rows: top row → one color`,
    // handled in AbilityManager._handleRainmaker()
  },

  // ── Swap-based ────────────────────────────────────────────────────────────

  {
    id: 'wideswap',
    name: 'Wideswap',
    maxLevel: 3,
    describe: (lvl) => `Every ${[8, 5, 3][lvl - 1]} swaps: next swap covers 3 cells`,
    // handled in AbilityManager._handleWideswap()
  },

  // ── Before clear (can add to clearing set) ───────────────────────────────

  {
    id: 'echo',
    name: 'Echo',
    maxLevel: 3,
    describe: (lvl) => `${[15, 30, 50][lvl - 1]}% chance adjacent blocks join a clear`,
    onEvent: 'beforeClear',
    apply: (game, lvl) => {
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
    describe: (lvl) => [`Pull 2 same-color blocks toward cursor`, `Pull 3 blocks`, `Pull whole column`][lvl - 1],
    onEvent: 'afterClear',
    apply: (game, lvl) => {
      const limit = lvl === 3 ? ROWS : lvl + 1;
      const cr = game.cursorRow, cc = game.cursorCol;
      // Find dominant color in cursor vicinity
      const freq = new Array(7).fill(0);
      for (let c = cc; c <= cc + 1; c++)
        for (let r = Math.max(0, cr - 2); r <= Math.min(ROWS - 1, cr + 2); r++)
          if (game.grid[r][c]) freq[game.grid[r][c]]++;
      const color = freq.indexOf(Math.max(...freq.slice(1)));
      if (!color) return;
      let moved = 0;
      for (let c = 0; c < COLS && moved < limit; c++) {
        for (let r = 0; r < ROWS && moved < limit; r++) {
          if (game.grid[r][c] === color && Math.abs(r - cr) > 1) {
            const dir = cr > r ? 1 : -1;
            const nr = r + dir;
            if (nr >= 0 && nr < ROWS && game.grid[nr][c] === 0) {
              game.grid[nr][c] = color;
              game.grid[r][c] = 0;
              moved++;
            }
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
    if (event === 'swapMade')  this._handleWideswap();

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

  _handleWideswap() {
    const lvl = this.level('wideswap');
    if (!lvl) return;
    const threshold = [8, 5, 3][lvl - 1];
    const count = (this._counters.get('wideswap') || 0) + 1;
    if (count >= threshold) {
      this._counters.set('wideswap', 0);
      this.game.wideswapReady = true;
    } else {
      this._counters.set('wideswap', count);
    }
  }
}

// ── src/game.js ─────────────────────────────────────
const CLEAR_DURATION   = 500;
const BASE_RISE_MS     = 4000;
const MIN_RISE_MS      = 500;
const LEVEL_UP_MS      = 30000;
const FALL_SPEED       = 18;
const COMBO_STOP_BASE  = 1500;
const COMBO_STOP_CHAIN = 800;

// Score thresholds that trigger an ability pick screen
const MILESTONES = [500, 1500, 3000, 5500, 9000, 14000, 21000, 30000, 42000];

class Game {
  constructor() {
    this.grid      = createGrid();
    this.cursorRow = Math.floor(ROWS * 0.6);
    this.cursorCol = Math.floor(COLS / 2) - 1;

    this.clearing   = new Set();
    this.clearTimer = 0;
    this.chainCount = 0;

    this.fallingBlocks = [];
    this._fallChain    = 0;

    this.riseTimer  = 0;
    this.comboStop  = 0;
    this.comboLevel = 0;
    this.comboCount = 0;

    // Ability-related state
    this.freezeCap      = 5000;
    this.overclockMult  = 1;
    this.overclockTimer = 0;
    this.wideswapReady  = false;

    this.score = 0;
    this.level = 1;
    this.time  = 0;

    this._nextMilestone  = 0;
    this.pickOptions     = []; // array of ability objects shown during 'picking'
    this._stateBeforePick = null;

    // 'playing' | 'falling' | 'clearing' | 'paused' | 'picking' | 'gameOver'
    this.state = 'playing';

    this.abilities = new AbilityManager(this);

    for (let i = 0; i < Math.floor(ROWS / 2); i++) {
      this._addInitialRow();
    }
  }

  get riseInterval() {
    const scorePenalty = Math.floor(this.score / 500) * 80;
    let base = Math.max(MIN_RISE_MS, BASE_RISE_MS - (this.level - 1) * 350 - scorePenalty);
    if (this.comboStop > 0) {
      const frenzyLvl = this.abilities.level('frenzy');
      if (frenzyLvl > 0) base *= [1.25, 1.5, 2.0][frenzyLvl - 1];
    }
    return base;
  }

  tick(dt) {
    if (this.state === 'gameOver' || this.state === 'paused' || this.state === 'picking') return;

    this.time += dt;
    this.level = Math.floor(this.time / LEVEL_UP_MS) + 1;

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
        this.fallingBlocks = this.fallingBlocks.filter(b => !b.landed);
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

    if (this.wideswapReady && c <= COLS - 3) {
      // 3-cell rotation: [a, b, c] → [c, a, b]
      const tmp       = this.grid[r][c + 2];
      this.grid[r][c + 2] = this.grid[r][c + 1];
      this.grid[r][c + 1] = this.grid[r][c];
      this.grid[r][c]     = tmp;
      this.wideswapReady  = false;
    } else {
      const tmp           = this.grid[r][c];
      this.grid[r][c]     = this.grid[r][c + 1];
      this.grid[r][c + 1] = tmp;
    }

    this.abilities.emit('swapMade');

    if (this.state !== 'clearing' && this.fallingBlocks.length === 0) {
      this._startGravity(0);
    }
    return true;
  }

  // Called when the player presses 1/2/3 on the pick screen
  pick(choice) {
    if (this.state !== 'picking') return;
    const ability = this.pickOptions[choice];
    if (ability) this.abilities.pick(ability.id);
    this.pickOptions = [];
    // Restore the state we interrupted (could be 'clearing' if milestone fired mid-clear)
    this.state = this._stateBeforePick || 'playing';
    this._stateBeforePick = null;
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
    if (matches.size > 0) {
      this.clearing   = matches;
      this.clearTimer = CLEAR_DURATION;
      this.chainCount = chainCount;
      this.state      = 'clearing';

      // Echo: let adjacent blocks join the clearing set
      this.abilities.emit('beforeClear');

      // Notify chain-triggered abilities
      if (chainCount > 0) this.abilities.emit('chainFired', chainCount);

      // Combo session counter (manual + chains both count)
      this.comboCount++;
      this.comboLevel = this.comboCount;

      const chainMult = Math.pow(2, chainCount);
      const comboMult = this.comboCount;
      this.score += Math.floor(this.clearing.size * 10 * chainMult * comboMult * this.level * this.overclockMult);

      const freeze = (COMBO_STOP_BASE * this.comboCount + chainCount * COMBO_STOP_CHAIN) * this.level;
      this.comboStop = Math.min(this.freezeCap, Math.max(this.comboStop, freeze));

      this._checkMilestone(); // may change state to 'picking'
    } else {
      this.state      = 'playing';
      this.chainCount = 0;
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
    if (newFalling.length > 0) { this.fallingBlocks = newFalling; this.state = 'falling'; }
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

  _checkMilestone() {
    if (this._nextMilestone >= MILESTONES.length) return;
    if (this.score >= MILESTONES[this._nextMilestone]) {
      this._nextMilestone++;
      const options = this.abilities.getOptions(3);
      if (options.length > 0) {
        this.pickOptions       = options;
        this._stateBeforePick  = this.state; // remember 'clearing', 'playing', etc.
        this.state             = 'picking';
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
