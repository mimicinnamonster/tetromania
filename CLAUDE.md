# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build Notes

The bundler concatenates all source files into a single `'use strict'` script. Injected globals (e.g. `const DEBUG = ...`) are prepended at the top. Never use `var X = fallback` in source files to guard against missing globals — it will throw in strict mode if the bundler already declared `const X`. Use `typeof X !== 'undefined' && X` instead.

## Running the Game

```bash
node index.js          # TTY (terminal)
node build.js web      # build dist/web.html
open dist/web.html     # browser
```

No dependencies — pure Node.js built-ins only.

## Architecture

```
src/game.js           Game class: state machine + tick logic
src/grid.js           Pure grid functions: createGrid, generateRow, applyGravity, findMatches
src/engine.js         Engine class: game loop (30 fps), wires platform → game → renderer
src/abilities.js      ABILITIES array: all ability definitions (id, name, maxLevel, describe, apply)
src/abilityManager.js AbilityManager class: tracks levels/cooldowns/counters, routes events

platforms/tty/        TTY platform (terminal)
  index.js            TtyPlatform class
  renderer.js         ANSI/Unicode terminal output, diff renders only changed lines
  input.js            Raw-mode stdin, key-repeat logic, maps sequences → named events

platforms/web/        Web platform (browser)
  index.js            WebPlatform class
  renderer.js         DOM renderer: CSS grid cells, smooth falling overlays, block animations
  input.js            Keyboard event handler
  template.html       HTML/CSS shell; {{SCRIPT}} replaced by build

index.js              TTY entry point (node index.js)
build.js              Bundler: concatenates src + platform files → dist/
dist/ttytetrisattack.js  Built TTY bundle (executable)
dist/web.html         Built single-file web app
```

## Build

```bash
node build.js          # builds TTY (default)
node build.js tty      # builds TTY → dist/ttytetrisattack.js
node build.js web      # builds web → dist/web.html
npm run build          # alias for tty
npm run build:web      # alias for web
```

The bundler strips `require()`/`module.exports` lines and injects all source files as one script, either as a Node.js executable or injected into `template.html` via `{{SCRIPT}}`.

## Constants (quick reference)

| Constant | File | Value |
|----------|------|-------|
| `ROWS` / `COLS` | grid.js | 12 / 6 |
| `NUM_COLORS` | grid.js | 6 |
| `CLEAR_DURATION` | game.js | 500 ms |
| `BASE_RISE_MS` | game.js | 4000 ms |
| `MIN_RISE_MS` | game.js | 500 ms |
| `FALL_SPEED` | game.js | 18 rows/s |
| `COMBO_STOP_BASE` | game.js | 1500 ms |
| `COMBO_STOP_CHAIN` | game.js | 800 ms |
| FPS | engine.js | 30 |

## Game States

`'playing'` → `'clearing'` → `'falling'` → back to `'playing'`
Interruptions: `'paused'`, `'picking'` (ability select), `'gameOver'`

- **playing** — normal gameplay; swap triggers a 100ms `_gravityDelay`, then `_startGravity(0)`; swap during falling sets `_pendingGravity` flag to re-run gravity after the chain ends
- **falling** — animated gravity; `fallingBlocks[]` entries track `{color, col, row, targetRow}`; on all landed calls `_checkMatches(chainCount)`
- **clearing** — matched cells flash for `CLEAR_DURATION` ms, then `_resolveClearing` zeroes them and starts gravity for chain
- **picking** — ability select screen; shown only after the full chain resolves (deferred via `_pendingPick` flag); after each pick, milestones are rechecked immediately to handle multiple picks from one chain
- **gameOver** — row 0 has blocks at rise time; R restarts

Rise is blocked during `clearing`, while `fallingBlocks.length > 0`, while `_gravityDelay > 0`, or while `comboStop > 0`.

## Grid Convention

- `grid[0]` = top row, `grid[ROWS-1]` = bottom
- Cell value `0` = empty, `1–6` = block color
- `clearing` is `Set<"r,c">` of cells in flash animation
- Cursor `(cursorRow, cursorCol)` selects pair `[col, col+1]`

## Scoring

```
pendingScore += clearing.size × 10 × 2^chainCount × comboCount × level × overclockMult
  (pendingScore flushed into score when chain fully ends — no more matches)
comboStop = min(freezeCap, max(comboStop, (COMBO_STOP_BASE × comboCount + chainCount × COMBO_STOP_CHAIN) × level))
riseInterval = max(MIN_RISE_MS, BASE_RISE_MS - (level-1)×350 - floor(score/500)×80) × frenzyMult
```

- `game.pendingScore` accumulates during clearing/falling; flushed to `game.score` at chain end
- Milestones are checked after the flush; `_pendingPick` defers the pick screen until then
- After each pick, milestones are rechecked immediately (handles multiple milestones from one chain)

## Swap Gravity Delay

After a swap, `_gravityDelay = 100` ms is set instead of immediately calling `_startGravity`. This gives a brief visual pause so the swapped block is clearly visible at its new position before falling — matching the classic Panel de Pon feel.

## Abilities System

**Adding a new ability:** add an entry to `ABILITIES` in `src/abilities.js`:
- Required: `id`, `name`, `maxLevel`, `describe(lvl)` → string
- `onPick(game, lvl)` — fires once when picked (passive upgrades to game state)
- `onEvent: '<event>'` + `apply(game, lvl, ...args)` — fires on event
- Counter/cooldown logic: add a `_handle*()` method in `AbilityManager` and call it from `emit()`

**Events** (emitted via `game.abilities.emit(event, ...args)`):
- `rowAdded` — after `_rise()` adds a new bottom row
- `swapMade` — after any swap
- `beforeClear` — before flash starts (can add to `game.clearing`)
- `afterClear` — after blocks are removed, before gravity
- `chainFired(chainCount)` — on chain ≥ 1
- `comboEnded` — when `comboStop` timer hits 0

**Ability state on Game:**
- `game.abilities.level(id)` → current level (0 if not owned)
- `game.freezeCap` — max combo freeze ms (Anchor raises this)
- `game.overclockMult` / `game.overclockTimer` — Overclock score multiplier

## All Abilities (src/abilities.js)

| ID | Name | Max Lv | Trigger | Effect |
|----|------|--------|---------|--------|
| `anchor` | Anchor | 3 | onPick | Raises `freezeCap` by 2s per level (4→6→8→10s) |
| `frenzy` | Frenzy | 3 | passive | While combo frozen: rise 25/50/100% slower |
| `glacial` | Glacial | 3 | rowAdded | +0.3/0.5/0.8s combo freeze per new row |
| `painter` | Painter | 3 | rowAdded | Injects matching pairs/triplets into new rows |
| `rainmaker` | Rainmaker | 3 | rowAdded (counter) | Every 5/3/2 rows: replaces top row with one color |
| `echo` | Echo | 3 | beforeClear | On manual swap: 15/30/50% chance adjacent blocks join a clear |
| `transmute` | Transmute | 3 | blockLanded | Landing blocks recolor block below (33/66/100% chance) |
| `bomb` | Bomb | 3 | beforeClear | On manual swap: blast 2×2/3×3/4×4 area at cursor position |
| `ripple` | Ripple | 3 | beforeClear | 30/60/100% chance same-color neighbors join a clear |
| `lShape` | L-Shape | 3 | beforeClear | L-triominoes (lv1: touching match, lv2: matching color, lv3: any) clear |
| `square` | Square | 3 | beforeClear | 2×2 same-color squares (lv1: touching, lv2: matching color, lv3: any) clear |
| `diagonal` | Diagonal | 3 | beforeClear | Diagonal 3-runs (lv1: touching, lv2: matching color, lv3: any) clear |
| `equalSign` | Equal Sign | 3 | beforeClear | Two parallel H or V lines of 3+ (lv1: touching, lv2: matching color, lv3: any) clear |
| `zShape` | Z-Shape | 3 | beforeClear | Z/S-tetrominoes all 4 rotations (lv1: touching, lv2: matching color, lv3: any) clear |
| `magnetism` | Magnetism | 3 | swapMade | Same-color swap: pull matching blocks toward cursor in 2D (±2/±4/all range) |
| `aftershock` | Aftershock | 3 | chainFired | On x2+ chain: destroys 1/2/3 random blocks |
| `overclock` | Overclock | 3 | chainFired | On x3+ chain: score ×2/3/4 for 8s |
| `panicShield` | Panic Shield | 3 | tick | Stack >80%: auto-removes top row (30/20/10s cd) |
| `colorblind` | Colorblind | 3 | comboEnded | Unifies 1/2/3 sparsest column(s) to majority color |

## TTY Renderer Notes

- `blockW = cellHeight × 2` (cells wider than tall for visual square appearance)
- `cellHeight = max(1, floor((termRows - 2) / ROWS))` — scales to terminal height
- Diff render: only writes lines that changed (cached in `this._cache`)
- `_firstRender = true` forces full clear + redraw (set on resize or restart)
- Colors `FG[1..6]`: bright red, green, blue, yellow, magenta, cyan
- Rainbow border (`RAINBOW[]`) animates when `comboStop > 0`; speed scales with `comboLevel`
- Pending score shown as yellow `+N` below score line during chain

## Web Renderer Notes

- CSS grid of `.wta-cell` divs with `border-radius: 20%` and inset highlight box-shadow
- Cell size: `calc((100vh - 39px) / 12)` — accounts for 3px padding×2 + 3px gap×11
- Cursor: single absolutely-positioned `#wta-cursor` div using `getBoundingClientRect()` for exact placement; `border-radius: calc((100vh-39px)/12*0.2)` matches block rounding
- Rainbow border: `#wta-grid.combo` + `@keyframes wta-rainbow` on `outline-color` + glow; `--rainbow-period` CSS var controls speed
- Overclock glow: `#wta-grid.overclock` orange box-shadow
- Pending score shown as `+N` in amber below score value
- Clearing animation: `wta-flash` keyframes on `.wta-cell.clearing`
- Ability pick cards: rounded cards with key badge, name, upgrade level; hover scales slightly
- Game over: gradient text score, frosted glass overlay (`backdrop-filter: blur`)
- Theme: deep purple `#1a1428` background, `#241e38` panels, system-ui font

### Web Animations

Falling blocks use absolutely-positioned overlay divs (`.wta-falling-overlay`) that track `b.row` at sub-row precision — smooth continuous motion at any frame rate. Grid cells under falling blocks show empty.

Per-cell animation classes (tracked in `_animCls[]`, cleared via `animationend`):
- `landing` — squish (scaleY 0.65→1.08→1) when a falling block lands; skipped if cell is clearing
- `swap-from-right` / `swap-from-left` — slide-in when adjacent cells exchange values (detected by comparing `_prevGrid` to current grid)
- `appearing` — scale up from flat when a new bottom row arrives (rise detected by checking grid shifted up by 1 row)

Animation restart pattern: set base className (no anim class) → single `void _cells[0].offsetWidth` reflow → add animation classes. This allows clean restarts without per-cell reflows.

Rise detection: `game.grid[r] === prevGrid[r+1]` element-by-element for r=0..ROWS-2, plus bottom row changed. Only `_rise()` shifts all rows simultaneously, so no false positives.

Landing detection: block in `_prevFalling` absent from current `fallingBlocks`, with `targetRow >= 0` (blocks removed by `_rise()` have `targetRow < 0` and must not trigger landing).

## Key Bindings

Repeatable (hold to repeat): `←↑→↓`, `wasd`, `x` (raise)
One-shot: `z`/`Space` (swap), `p` (pause), `r` (restart), `1`/`2`/`3` (pick), `q`/`Ctrl-C`/`Esc` (quit)
