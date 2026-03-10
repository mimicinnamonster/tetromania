# TODO

## Cleanup

- Remove `wideswap` ability (id: `wideswap`) from `src/abilities.js` and `src/abilityManager.js`

## Ability Ideas

- **Transmute** — when a falling block lands on an existing block, the block below changes color to match the one that fell on it
- **Bomb** — on `beforeClear`, all blocks within a square radius around each clearing cell are also added to the clearing set (radius scales with level)
- **Ripple** — on `beforeClear`, each clearing cell has a chance (scales with level) to also clear its immediate neighbors if they share a color with any clearing cell; creates cascade potential from small clears
- **L-Shape** — on `beforeClear`, scan for L-shaped triominoes of the same color (3 cells in an L); any found are added to the clearing set
- **Square** — on `beforeClear`, scan for 2×2 blocks of the same color; any found are added to the clearing set
- **Diagonal** — on `beforeClear`, scan for diagonal runs of 3+ same-color cells (↘ and ↙ directions); any found are added to the clearing set
- **Equal Sign** — on `beforeClear`, scan for two parallel horizontal lines of 3+ same-color cells (same color, same columns, exactly 1 row apart); any found are added to the clearing set
- **T-Shape** — on `beforeClear`, scan for T-shaped pentominoes of the same color (3 in a row + 1 extending perpendicularly from each end or center); any found are added to the clearing set
- **Z-Shape** — on `beforeClear`, scan for Z/S-shaped triominoes of the same color (2 cells in one row offset by 1 col from 2 cells in the adjacent row, forming a zigzag); any found are added to the clearing set
