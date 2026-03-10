# TODO

## Ability Ideas

- **Transmute** — when a falling block lands on an existing block, the block below changes color to match the one that fell on it
- **Ripple** — on `beforeClear`, each clearing cell has a chance (scales with level) to also clear its immediate neighbors if they share a color with any clearing cell; creates cascade potential from small clears
- **L-Shape** — on `beforeClear`, scan for L-shaped triominoes of the same color (3 cells in an L); any found are added to the clearing set
- **Square** — on `beforeClear`, scan for 2×2 blocks of the same color; any found are added to the clearing set
- **Diagonal** — on `beforeClear`, scan for diagonal runs of 3+ same-color cells (↘ and ↙ directions); any found are added to the clearing set
