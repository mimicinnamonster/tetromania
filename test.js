#!/usr/bin/env node
'use strict';

// ─── Harness ──────────────────────────────────────────────────────────────────

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${e.message}`);
    failed++;
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

function ok(val, msg) {
  if (!val) throw new Error(msg || `expected truthy, got ${val}`);
}

// ─── Simulation helpers ───────────────────────────────────────────────────────

const STEP = 33; // simulate at ~30fps

// Advance game time by `ms` milliseconds in STEP-sized ticks
function advance(game, ms) {
  let remaining = ms;
  while (remaining > 0) {
    const dt = Math.min(STEP, remaining);
    game.tick(dt);
    remaining -= dt;
  }
}

// Advance until state changes from current, or until timeout
function advanceUntil(game, predicate, timeoutMs = 5000) {
  let elapsed = 0;
  while (!predicate(game) && elapsed < timeoutMs) {
    game.tick(STEP);
    elapsed += STEP;
  }
  if (elapsed >= timeoutMs) throw new Error(`advanceUntil timed out after ${timeoutMs}ms (state=${game.state})`);
}

// Wait for game to return to 'playing' state (clearing + falling done), auto-picking if needed
function waitForPlaying(game, timeoutMs = 5000) {
  advanceUntil(game, g => {
    if (g.state === 'picking') { g.pick(0); }
    return g.state === 'playing';
  }, timeoutMs);
}

// Wait for combo freeze to expire and score to flush, auto-picking if needed
function waitForComboEnd(game, timeoutMs = 10000) {
  advanceUntil(game, g => {
    if (g.state === 'picking') { g.pick(0); }
    return g.comboStop <= 0 && g.chips === 0;
  }, timeoutMs);
}

// ─── Game factory ─────────────────────────────────────────────────────────────

const { ROWS, COLS, MIN_MATCH, createGrid } = require('./src/grid');
const { Game, POINTS_PER_BLOCK } = require('./src/game');

// Create a game with an empty grid (no initial rows, no rising)
function makeGame() {
  const g = new Game();
  g.grid = createGrid();
  g.riseTimer = -Infinity; // prevent rise during tests
  // Patch riseInterval to a huge value so rise never fires
  Object.defineProperty(g, 'riseInterval', { get: () => 999999999, configurable: true });
  return g;
}

// Place `len` blocks of `color` horizontally at (row, col)
function placeH(game, row, col, color, len = MIN_MATCH) {
  for (let c = col; c < col + len; c++) game.grid[row][c] = color;
}

// Place `len` blocks of `color` vertically at (row, col)
function placeV(game, row, col, color, len = MIN_MATCH) {
  for (let r = row; r < row + len; r++) game.grid[r][col] = color;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\nGrid constants');
test('MIN_MATCH is 3', () => eq(MIN_MATCH, 3));
test('POINTS_PER_BLOCK is 10', () => eq(POINTS_PER_BLOCK, 10));
test('ROWS is 12', () => eq(ROWS, 12));
test('COLS is 6', () => eq(COLS, 6));

console.log('\nBasic clear');
test('3-block clear: chips=30, mult=1', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0);
  eq(g.chips, 30);
  eq(g.mult, 1);
});

test('3-block clear: state becomes picking (level-up fires immediately)', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0);
  // First clear (30 pts) crosses level 1 threshold → immediate level-up
  eq(g.state, 'picking');
  eq(g._resumeState, 'clearing');
});

test('clearing resolves after CLEAR_DURATION', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0);
  advance(g, 500);
  advanceUntil(g, x => { if (x.state === 'picking') x.pick(0); return x.state === 'playing'; });
  eq(g.grid[ROWS - 1][0], 0);
  eq(g.grid[ROWS - 1][1], 0);
  eq(g.grid[ROWS - 1][2], 0);
});

test('single clear flushes to score=30 after combo freeze expires', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0);
  waitForComboEnd(g);
  eq(g.score, 30);
  eq(g.chips, 0);
});

console.log('\nCombo scoring');
test('two sequential clears: mult=2 on second', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0); // comboCount=1, mult stays 1
  placeH(g, ROWS - 1, 0, 2);
  g._checkMatches(0); // comboCount=2, mult += 1 → 2
  eq(g.mult, 2);
});

test('two clears then flush: score = (30+30)*2 = 120', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0);
  placeH(g, ROWS - 1, 0, 2);
  g._checkMatches(0);
  g._endCombo();
  eq(g.score, 120);
});

console.log('\nChain scoring');
test('chain x1: mult += comboCount-1 only; chainCount bonus goes into chips', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0); // comboCount=1, mult += 0 → 1, chips += 30*(1+0)=30
  eq(g.chips, 30);
  placeH(g, ROWS - 1, 0, 2);
  g._checkMatches(1); // comboCount=2, mult += 1 → 2, chips += 30*(1+1)=60
  eq(g.mult, 2);
  eq(g.chips, 90);
});

test('chain flush: score = floor(chips*mult*overclockMult)', () => {
  const g = makeGame();
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0); // chips=30, mult=1
  placeH(g, ROWS - 1, 0, 2);
  g._checkMatches(1); // chips=90, mult=2
  g._endCombo();      // score += floor(90*2*1) = 180
  eq(g.score, 180);
  eq(g.chips, 0);
  eq(g.mult, 1);
});

test('chain flush with overclock: score multiplied by overclockMult', () => {
  const g = makeGame();
  g.overclockMult = 2;
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0); // chips=30, mult=1
  g._endCombo();      // score += floor(30*1*2) = 60
  eq(g.score, 60);
});

console.log('\nPreview row swap');
test('swap in preview row (cursorRow=ROWS) exchanges adjacent cells without gravity', () => {
  const g = makeGame();
  g.cursorRow = ROWS;
  g.cursorCol = 0;
  g.grid[ROWS][0] = 3;
  g.grid[ROWS][1] = 5;
  g.swap();
  eq(g.grid[ROWS][0], 5);
  eq(g.grid[ROWS][1], 3);
  eq(g.state, 'playing');
});

console.log('\nLevel thresholds (SCORE_PER_LEVEL * level^3)');
test('level 1 threshold = 30', () => eq(new Game().nextLevelScore, 30));
test('level 2 threshold = 240', () => { const g = new Game(); g.level = 2; eq(g.nextLevelScore, 240); });
test('level 3 threshold = 810', () => { const g = new Game(); g.level = 3; eq(g.nextLevelScore, 810); });

console.log('\nLevel-up flow');
test('_checkLevelUp increments level and enters picking immediately', () => {
  const g = makeGame();
  g.score = 30;
  g._checkLevelUp();
  eq(g.level, 2); // level incremented immediately
  eq(g.state, 'picking');
});

test('_checkLevelUp triggers mid-combo using chips*mult as effective score', () => {
  const g = makeGame();
  g.chips = 30;
  g.mult  = 1;
  g._checkLevelUp();
  eq(g.level, 2, 'level incremented when chips×mult crosses threshold');
  eq(g.state, 'picking');
});

test('_checkLevelUp does not trigger if effective score below threshold', () => {
  const g = makeGame();
  g.chips = 15;
  g.mult  = 1;
  g._checkLevelUp();
  eq(g.level, 1, 'level unchanged when chips×mult < threshold');
  eq(g.state, 'playing');
});

test('mid-combo level-up: switches to picking immediately, resumeState=clearing', () => {
  const g = makeGame();
  g.chips = 30;
  g.mult  = 1;
  g.state = 'clearing';
  g._checkLevelUp();
  eq(g.state, 'picking');
  eq(g._resumeState, 'clearing');
});

test('pick() resumes prior state and nextLevelScore jumps', () => {
  const g = makeGame();
  g.score = 30;
  g._checkLevelUp(); // level=2, state=picking, resumeState=playing
  g.pick(0);
  eq(g.level, 2);
  eq(g.state, 'playing');
  eq(g.nextLevelScore, 240);
});

test('pick() mid-clear resumes clearing state', () => {
  const g = makeGame();
  g.chips = 30;
  g.mult  = 1;
  g.state = 'clearing';
  g.clearTimer = 200;
  g._checkLevelUp(); // level=2, state=picking, resumeState=clearing
  g.pick(0);
  eq(g.state, 'clearing');
  eq(g.clearTimer, 200); // timer preserved
});

test('ptsToNext increases after pick', () => {
  const g = makeGame();
  g.score = 30;
  g._checkLevelUp(); // level→2
  const ptsBefore = Math.max(0, g.nextLevelScore - g.score); // 240-30=210
  g.pick(0);
  const ptsAfter = Math.max(0, g.nextLevelScore - g.score);
  ok(ptsAfter > 0, `ptsToNext should be positive, got ${ptsAfter}`);
  eq(ptsBefore, 210);
});

console.log('\nReported scenario: "next level 90, one combo 30, next level now 30"');
test('score 150 at level 2 → ptsToNext=90, clear 30, ptsToNext=60', () => {
  const g = makeGame();

  // Get to level 2
  g.score = 30;
  g._checkLevelUp();
  g.state = 'picking';
  g.pickOptions = [{ id: 'anchor' }];
  g.pick(0); // level=2, nextLevelScore=240

  // Set score to 150 so ptsToNext=90
  g.score = 150;
  eq(Math.max(0, g.nextLevelScore - g.score), 90);

  // One basic clear
  placeH(g, ROWS - 1, 0, 1);
  g._checkMatches(0);
  g._endCombo(); // flush: score += 30*1*1 = 30 → score=180

  eq(g.score, 180);
  eq(Math.max(0, g.nextLevelScore - g.score), 60);
});

test('level does not affect score calculation', () => {
  const g = makeGame();
  g.level = 5;
  g.chips = 30;
  g.mult  = 1;
  g._endCombo();
  eq(g.score, 30); // level ignored
});

console.log('\nScoring timing: chips must not accumulate while blocks are still falling');

test('chips=0 mid-fall, chips>0 only after all blocks land', () => {
  const g = makeGame();

  // Place two color-1 blocks at the bottom, with a matching block floating above
  // col 0: row 10 = 1, row 11 = 1
  // col 2: row 11 = 1 (will need to slide after swap to form a match)
  // Simpler: place a block in row 0 (top) above two matching blocks, so it has to fall far
  g.grid[ROWS - 1][0] = 1;
  g.grid[ROWS - 1][1] = 1;
  g.grid[0][2] = 1; // floats at top — will fall to row ROWS-1

  // Start gravity manually (as if a swap had triggered it)
  g._startGravity(0);

  // Immediately: block should be falling, no chips yet
  eq(g.state, 'falling', 'state should be falling');
  eq(g.chips, 0, 'chips must be 0 while blocks are still falling');
  eq(g.score, 0, 'score must be 0 while blocks are still falling');

  // Advance partway through the fall (block starts at row 0, target row ROWS-1 = 11)
  // At FALL_SPEED=18 rows/s, 11 rows takes ~611ms. Advance 200ms — block mid-fall.
  advance(g, 200);
  ok(g.fallingBlocks.length > 0, 'block should still be falling after 200ms');
  eq(g.chips, 0, 'chips must still be 0 mid-fall');
  eq(g.score, 0, 'score must still be 0 mid-fall');

  // Advance until block lands (>611ms total)
  advanceUntil(g, x => x.fallingBlocks.length === 0);

  // Now blocks have landed; _checkMatches was called; if 3-in-a-row formed, chips > 0
  ok(g.chips > 0 || g.state === 'clearing', 'after landing, chips should be assigned or clearing underway');
});

test('score/chips stay 0 throughout full fall when no match forms', () => {
  const g = makeGame();

  // Single block floating at top, no match at bottom
  g.grid[0][0] = 1;
  g.grid[ROWS - 1][1] = 2; // different color blocking bottom

  g._startGravity(0);
  eq(g.chips, 0, 'chips=0 at fall start');

  // Advance until settled
  advanceUntil(g, x => x.state === 'playing');

  eq(g.chips, 0, 'chips=0 after fall with no match');
  eq(g.score, 0, 'score=0 after fall with no match');
});

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
