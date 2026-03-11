const { ROWS, COLS, MIN_MATCH, createGrid, generateRow, findMatches, applyGravity } = require('./grid');
const { AbilityManager } = require('./abilityManager');

const CLEAR_DURATION   = 500;
const BASE_RISE_MS     = 4000;
const MIN_RISE_MS      = 500;
const FALL_SPEED       = 18;
const COMBO_STOP_BASE    = 9000; // ms window for first clear (easy to reach x2)
const COMBO_STOP_DECAY   = 0.60; // each subsequent combo window shrinks more steeply
const COMBO_STOP_MIN     = 750;  // floor
const COMBO_STOP_CHAIN   = 2400;  // bonus ms per chain level
const POINTS_PER_BLOCK = 10;  // chips earned per cleared block
const SCORE_PER_LEVEL  = MIN_MATCH * POINTS_PER_BLOCK; // score for a basic clear = one level threshold

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

    this.score = 0;
    this.chips = 0; // accumulated block points this chain session
    this.mult  = 1; // accumulated multiplier this chain session
    this.level = 1;
    this.time  = 0;

    this.pickOptions  = []; // array of ability objects shown during 'picking'
    this._resumeState = 'playing'; // state to restore after picking

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
    this.grid[ROWS] = generateRow(this.grid);
  }

  get riseOffset() {
    return Math.min(1, this.riseTimer / this.riseInterval);
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
        this._endCombo();
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

    // Swap in the preview (incoming) row
    if (r === ROWS) {
      const tmp = this.grid[ROWS][c];
      this.grid[ROWS][c]     = this.grid[ROWS][c + 1];
      this.grid[ROWS][c + 1] = tmp;
      return true;
    }

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
    this.state = this._resumeState;
    this._resumeState = 'playing';
    this._checkLevelUp(); // may immediately re-enter 'picking' if another threshold crossed
  }

  togglePause() {
    if (this.state === 'playing') this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }

  moveLeft()  { if (this.cursorCol > 0)        this.cursorCol--; }
  moveRight() { if (this.cursorCol < COLS - 2)  this.cursorCol++; }
  moveUp()    { if (this.cursorRow > 0)         this.cursorRow--; }
  moveDown()  { if (this.cursorRow < ROWS)       this.cursorRow++; }

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
      // Level N requires N clears to advance: thresholds at 1, 3, 6, 10, 15...
      this.comboLevel = Math.floor((1 + Math.sqrt(1 + 8 * (this.comboCount - 1))) / 2);

      this.chips += this.clearing.size * POINTS_PER_BLOCK * (1 + chainCount);
      this.mult  += (this.comboCount - 1);
      this._checkLevelUp();

      const freeze = Math.max(COMBO_STOP_MIN, COMBO_STOP_BASE * Math.pow(COMBO_STOP_DECAY, this.comboCount - 1)) + chainCount * COMBO_STOP_CHAIN;
      this.comboStop = Math.min(this.freezeCap, Math.max(this.comboStop, freeze));
    } else {
      // Chain complete — score settles when comboStop expires, not here
      this.chainCount = 0;
      if (this._pendingGravity) {
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
    const H = this.grid.length;
    for (let c = 0; c < COLS; c++) {
      const blocks = [];
      for (let r = 0; r < H; r++)
        if (this.grid[r][c]) blocks.push({ color: this.grid[r][c], fromRow: r });
      for (let r = 0; r < H; r++) this.grid[r][c] = 0;
      blocks.forEach((b, i) => {
        const targetRow = H - blocks.length + i;
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
    this.grid[ROWS - 1] = [...this.grid[ROWS]];
    if (this.cursorRow > 0) this.cursorRow--;
    for (const b of this.fallingBlocks) { b.row--; b.targetRow--; }
    this.fallingBlocks = this.fallingBlocks.filter(b => b.targetRow >= 0);
    this.abilities.emit('rowAdded');
    this.grid[ROWS] = generateRow(this.grid);
  }

  _addInitialRow() {
    if (this.grid[0].some(v => v !== 0)) return;
    for (let r = 0; r < ROWS - 1; r++) this.grid[r] = [...this.grid[r + 1]];
    this.grid[ROWS - 1] = generateRow(this.grid);
  }

  _endCombo() {
    this.comboStop  = 0;
    const finalComboCount = this.comboCount;
    this.comboCount = 0;
    this.comboLevel = 0;
    this.score += Math.floor(this.chips * this.mult * this.overclockMult);
    this.chips  = 0;
    this.mult   = 1;
    this._checkLevelUp();
    this.abilities.emit('comboEnded', finalComboCount);
  }

  _checkLevelUp() {
    const effectiveScore = this.score + Math.floor(this.chips * this.mult * this.overclockMult);
    if (effectiveScore >= SCORE_PER_LEVEL * Math.pow(this.level, 3)) {
      this.level++;
      const options = this.abilities.getOptions(3);
      if (options.length > 0) {
        this.pickOptions  = options;
        this._resumeState = this.state;
        this.state        = 'picking';
      }
    }
  }

  get nextLevelScore() { return SCORE_PER_LEVEL * Math.pow(this.level, 3); }
}

module.exports = { Game, POINTS_PER_BLOCK };
