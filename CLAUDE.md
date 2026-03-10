# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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
  index.js            WebPlatform-equivalent: TtyPlatform class
  renderer.js         ANSI/Unicode terminal output, diff renders only changed lines
  input.js            Raw-mode stdin, key-repeat logic, maps sequences → named events

platforms/web/        Web platform (browser)
  index.js            WebPlatform class
  renderer.js         DOM renderer: CSS grid cells, combo rainbow border, pending score
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
| `LEVEL_UP_MS` | game.js | 30 000 ms |
| `FALL_SPEED` | game.js | 18 rows/s |
| `COMBO_STOP_BASE` | game.js | 1500 ms |
| `MILESTONES` | game.js | [500, 1500, 3000, 5500, 9000, 14000, 21000, 30000, 42000] |
| FPS | engine.js | 30 |

## Game States

`'playing'` → `'clearing'` → `'falling'` → back to `'playing'`
Interruptions: `'paused'`, `'picking'` (ability select), `'gameOver'`

- **playing** — normal; swap triggers `_startGravity(0)`
- **falling** — animated gravity; `fallingBlocks[]` entries track `{color, col, row, targetRow}`; on all landed calls `_checkMatches(chainCount)`
- **clearing** — matched cells flash for `CLEAR_DURATION` ms, then `_resolveClearing` zeroes them and starts gravity for chain
- **picking** — ability select screen; shown only after the full chain resolves (deferred via `_pendingPick` flag)
- **gameOver** — row 0 has blocks at rise time; R restarts

Rise is blocked during `clearing`, while `fallingBlocks.length > 0`, or while `comboStop > 0`.

## Grid Convention

- `grid[0]` = top row, `grid[ROWS-1]` = bottom
- Cell value `0` = empty, `1–6` = block color
- `clearing` is `Set<"r,c">` of cells in flash animation
- Cursor `(cursorRow, cursorCol)` selects pair `[col, col+1]`; wideswap extends to `[col, col+1, col+2]`

## Scoring

```
pendingScore += clearing.size × 10 × 2^chainCount × comboCount × level × overclockMult
  (pendingScore flushed into score when chain fully ends — no more matches)
comboStop = min(freezeCap, max(comboStop, (COMBO_STOP_BASE × comboCount + chainCount × 800) × level))
riseInterval = max(MIN_RISE_MS, BASE_RISE_MS - (level-1)×350 - floor(score/500)×80) × frenzyMult
```

- `game.pendingScore` accumulates during clearing/falling; flushed to `game.score` at chain end
- Milestones are checked after the flush; `_pendingPick` defers the pick screen until then
- After each pick, milestones are rechecked immediately (handles multiple milestones from one chain)

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
- `game.wideswapReady` — next swap covers 3 cells

## TTY Renderer Notes

- `blockW = cellHeight × 2` (cells wider than tall for visual square appearance)
- `cellHeight = max(1, floor((termRows - 2) / ROWS))` — scales to terminal height
- Diff render: only writes lines that changed (cached in `this._cache`)
- `_firstRender = true` forces full clear + redraw (set on resize or restart)
- Colors `FG[1..6]`: bright red, green, blue, yellow, magenta, cyan
- Rainbow border (`RAINBOW[]`) animates when `comboStop > 0`; speed scales with `comboLevel`

## Web Renderer Notes

- CSS grid of `.wta-cell` divs; `data-color` attribute drives block color via CSS
- Rainbow border: `#wta-grid.combo` + `@keyframes wta-rainbow`; `--rainbow-period` CSS var controls speed
- Overclock glow: `#wta-grid.overclock` box-shadow
- Pending score shown as `+N` below score; cleared when chain ends
- Clearing animation: `wta-flash` keyframes on `.wta-cell.clearing`

## Key Bindings

Repeatable (hold to repeat): `←↑→↓`, `wasd`, `x` (raise)
One-shot: `z`/`Space` (swap), `p` (pause), `r` (restart), `1`/`2`/`3` (pick), `q`/`Ctrl-C`/`Esc` (quit)
