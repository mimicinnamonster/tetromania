const ROWS = 12;
const COLS = typeof _GAME_COLS !== 'undefined' && _GAME_COLS ? _GAME_COLS : 6;
const NUM_COLORS = 6;
const MIN_MATCH = 3;

function createGrid() {
  return Array.from({ length: ROWS + 1 }, () => new Array(COLS).fill(0));
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
  const H = grid.length;
  for (let c = 0; c < COLS; c++) {
    const blocks = [];
    for (let r = H - 1; r >= 0; r--) {
      if (grid[r][c] !== 0) blocks.push(grid[r][c]);
    }
    for (let r = H - 1; r >= 0; r--) {
      grid[r][c] = blocks[H - 1 - r] ?? 0;
    }
  }
}

// Return a Set of "r,c" keys for all cells that are part of a match (3+)
function findMatches(grid) {
  const H = grid.length;
  const matched = new Set();

  // Horizontal
  for (let r = 0; r < H; r++) {
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
    for (let r = 0; r < H - 2; r++) {
      const color = grid[r][c];
      if (!color) continue;
      if (grid[r + 1][c] === color && grid[r + 2][c] === color) {
        let end = r + 2;
        while (end + 1 < H && grid[end + 1]?.[c] === color) end++;
        for (let i = r; i <= end; i++) matched.add(`${i},${c}`);
        r = end;
      }
    }
  }

  return matched;
}

module.exports = { ROWS, COLS, NUM_COLORS, MIN_MATCH, createGrid, generateRow, applyGravity, findMatches };
