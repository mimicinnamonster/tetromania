const { ABILITIES, shuffle, rnd } = require('./abilities');
const { ROWS, COLS } = require('./grid');

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

module.exports = { AbilityManager };
