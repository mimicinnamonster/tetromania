const { ROWS, COLS, createGrid, generateRow, findMatches } = require('./grid');

const CLEAR_DURATION  = 500;   // ms blocks flash before disappearing
const BASE_RISE_MS    = 4000;  // ms between row rises at level 1
const MIN_RISE_MS     = 500;   // fastest rise interval
const LEVEL_UP_MS     = 30000; // ms between level increases
const FALL_SPEED      = 18;    // rows per second for animated gravity
const COMBO_STOP_BASE = 1500;  // ms rise is frozen after a clear
const COMBO_STOP_CHAIN = 800;  // extra ms per chain link

class Game {
  constructor() {
    this.grid = createGrid();
    this.cursorRow = Math.floor(ROWS * 0.6);
    this.cursorCol = Math.floor(COLS / 2) - 1;

    this.clearing   = new Set(); // "r,c" keys of cells currently flashing
    this.clearTimer = 0;
    this.chainCount = 0;         // chain depth for current clearing sequence

    this.fallingBlocks = []; // {color, col, row (float), targetRow}
    this._fallChain    = 0;  // chain to use when falling finishes

    this.riseTimer    = 0;
    this.comboStop    = 0; // ms remaining where rise is frozen due to a combo
    this.comboLevel   = 0; // total matches in current combo session (manual + chains)
    this.comboCount   = 0; // same value, used to detect session reset
    this.score  = 0;
    this.level  = 1;
    this.time   = 0; // total elapsed ms

    // 'playing' | 'falling' | 'clearing' | 'paused' | 'gameOver'
    this.state = 'playing';

    // Pre-fill the bottom half with blocks
    for (let i = 0; i < Math.floor(ROWS / 2); i++) {
      this._addInitialRow();
    }
  }

  get riseInterval() {
    const scorePenalty = Math.floor(this.score / 500) * 80; // -80ms per 500 pts
    return Math.max(MIN_RISE_MS, BASE_RISE_MS - (this.level - 1) * 350 - scorePenalty);
  }

  tick(dt) {
    if (this.state === 'gameOver' || this.state === 'paused') return;

    this.time += dt;
    this.level = Math.floor(this.time / LEVEL_UP_MS) + 1;

    // Rise is frozen while clearing/falling or during combo freeze window
    const riseBlocked = this.state === 'clearing' ||
                        this.fallingBlocks.length > 0 ||
                        this.comboStop > 0;
    if (this.comboStop > 0) {
      this.comboStop -= dt;
      if (this.comboStop <= 0) this.comboCount = 0; // session over
    }
    if (!riseBlocked) {
      this.riseTimer += dt;
      if (this.riseTimer >= this.riseInterval) {
        this.riseTimer -= this.riseInterval;
        this._rise();
        if (this.state === 'gameOver') return;
      }
    }

    // Animate falling blocks (takes priority; clearing waits)
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
        if (this.fallingBlocks.length === 0) {
          this._checkMatches(this._fallChain);
        }
      }
      return;
    }

    // Count down clearing animation
    if (this.state === 'clearing') {
      this.clearTimer -= dt;
      if (this.clearTimer <= 0) {
        this._resolveClearing();
      }
    }
  }

  // Swap the two cells under the cursor, then start animated gravity
  swap() {
    if (this.state === 'gameOver' || this.state === 'paused') return false;

    const r = this.cursorRow;
    const c = this.cursorCol;

    // Can't swap cells that are mid-clear
    if (this.clearing.has(`${r},${c}`) || this.clearing.has(`${r},${c + 1}`)) return false;

    const tmp = this.grid[r][c];
    this.grid[r][c] = this.grid[r][c + 1];
    this.grid[r][c + 1] = tmp;

    // Only trigger gravity+match when not already in a clearing/falling sequence
    if (this.state !== 'clearing' && this.fallingBlocks.length === 0) {
      this._startGravity(0);
    }

    return true;
  }

  togglePause() {
    if (this.state === 'playing')  this.state = 'paused';
    else if (this.state === 'paused') this.state = 'playing';
  }

  moveLeft()  { if (this.cursorCol > 0)        this.cursorCol--; }
  moveRight() { if (this.cursorCol < COLS - 2)  this.cursorCol++; }
  moveUp()    { if (this.cursorRow > 0)         this.cursorRow--; }
  moveDown()  { if (this.cursorRow < ROWS - 1)  this.cursorRow++; }

  raise() {
    if (this.state === 'gameOver' || this.state === 'paused') return;
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

      // Every match (manual or chain) advances the combo session counter
      this.comboCount++;
      this.comboLevel = this.comboCount;

      // Score: base × chain multiplier (chains extra rewarding) × combo session × level
      const chainMult = Math.pow(2, chainCount);       // chains double each link
      const comboMult = this.comboCount;               // fast manual combos add linear bonus
      this.score += matches.size * 10 * chainMult * comboMult * this.level;

      // Freeze: base from combo session depth, chains add extra on top, scales with level
      const freeze = (COMBO_STOP_BASE * this.comboCount + chainCount * COMBO_STOP_CHAIN) * this.level;
      this.comboStop = Math.min(5000, Math.max(this.comboStop, freeze));
    } else {
      this.state      = 'playing';
      this.chainCount = 0;
    }
  }

  _resolveClearing() {
    // Remove flashing cells
    for (const key of this.clearing) {
      const [r, c] = key.split(',').map(Number);
      this.grid[r][c] = 0;
    }
    this.clearing = new Set();

    this._startGravity(this.chainCount + 1);
  }

  // Animate all blocks that need to fall down to their destination
  _startGravity(chainAfter) {
    this._fallChain = chainAfter;
    const newFalling = [];

    for (let c = 0; c < COLS; c++) {
      // Collect all blocks in this column top→bottom
      const blocks = [];
      for (let r = 0; r < ROWS; r++) {
        if (this.grid[r][c] !== 0) blocks.push({ color: this.grid[r][c], fromRow: r });
      }
      // Clear the column
      for (let r = 0; r < ROWS; r++) this.grid[r][c] = 0;
      // Pack blocks to the bottom, animating any that need to move
      blocks.forEach((b, i) => {
        const targetRow = ROWS - blocks.length + i;
        if (targetRow !== b.fromRow) {
          newFalling.push({ color: b.color, col: c, row: b.fromRow, targetRow });
        } else {
          this.grid[b.fromRow][c] = b.color; // already in place
        }
      });
    }

    if (newFalling.length > 0) {
      this.fallingBlocks = newFalling;
      this.state = 'falling';
    } else {
      this._checkMatches(chainAfter);
    }
  }

  _rise() {
    // If any block is already in row 0, the stack has hit the ceiling
    if (this.grid[0].some(v => v !== 0)) {
      this.state = 'gameOver';
      return;
    }

    // Shift every row up by one
    for (let r = 0; r < ROWS - 1; r++) {
      this.grid[r] = [...this.grid[r + 1]];
    }
    this.grid[ROWS - 1] = generateRow(this.grid);

    // Keep cursor from drifting off the top
    if (this.cursorRow > 0) this.cursorRow--;

    // Adjust in-flight falling blocks
    for (const b of this.fallingBlocks) {
      b.row      -= 1;
      b.targetRow -= 1;
    }
    this.fallingBlocks = this.fallingBlocks.filter(b => b.targetRow >= 0);
  }

  _addInitialRow() {
    if (this.grid[0].some(v => v !== 0)) return; // don't push past the top
    for (let r = 0; r < ROWS - 1; r++) {
      this.grid[r] = [...this.grid[r + 1]];
    }
    this.grid[ROWS - 1] = generateRow(this.grid);
  }
}

module.exports = { Game };
