'use strict';

// ROWS, COLS, ABILITIES, scoreToLevel are injected by the build (concatenated from src/).

class WebRenderer {
  constructor() {
    this._cells        = [];
    this._previewCells = [];   // COLS absolutely-positioned cells inside #wta-grid for the incoming row
    this._built        = false;
    this._overlayState = null;
    this._fallingPool  = [];   // pool of overlay divs for smooth sub-row falling
    this._prevFalling  = [];   // fallingBlocks snapshot {col, targetRow} from last frame
    this._prevGrid     = null; // grid snapshot from last frame (for swap/rise detection)
    this._layout       = null; // cached {originTop, originLeft, cellH, cellW, gapH, gapW}
    this._animCls      = [];   // per-cell currently-running animation class string
    this._displayScore = 0;    // animated score counter
    this._scoreTo      = 0;    // target score for count-up
    this._scoreStep    = 1;    // points added per frame
  }

  _build() {
    const gridEl = document.getElementById('wta-grid');
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${COLS}, 1fr)`;
    gridEl.style.gridTemplateRows    = '';  // let rows size from cell content (aspect-ratio on mobile)
    gridEl.style.position            = 'relative'; // contain absolutely-positioned preview cells
    this._cells   = [];
    this._animCls = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const div = document.createElement('div');
        div.className = 'wta-cell';
        gridEl.appendChild(div);
        this._cells.push(div);
        this._animCls.push('');
      }
    }
    // Preview cells: absolutely positioned inside #wta-grid, one row below content.
    // They travel with the grid's translateY, sliding into view from below.
    this._previewCells = [];
    for (let c = 0; c < COLS; c++) {
      const div = document.createElement('div');
      div.className = 'wta-cell';
      div.style.position = 'absolute';
      gridEl.appendChild(div);
      this._previewCells.push(div);
    }
    this._built  = true;
    this._layout = null;
  }

  _getLayout(gridEl, wrap) {
    if (this._layout) return this._layout;
    // Origins must be relative to wrap (the positioned ancestor of overlay divs and cursor)
    const wrapRect  = wrap.getBoundingClientRect();
    const gridRect  = gridEl.getBoundingClientRect();
    const r0 = this._cells[0].getBoundingClientRect();
    const r1 = this._cells[COLS].getBoundingClientRect();
    const c1 = this._cells[1].getBoundingClientRect();
    this._layout = {
      originTop:  r0.top  - wrapRect.top,
      originLeft: r0.left - wrapRect.left,
      cellH: r0.height,
      cellW: r0.width,
      gapH:  r1.top  - r0.bottom,
      gapW:  c1.left - r0.right,
    };
    // Position preview cells inside gridEl (absolute, in grid's own coordinate space).
    // r0 relative to grid: cell[0] top/left within gridEl.
    const rowStep = this._layout.cellH + this._layout.gapH;
    const colStep = this._layout.cellW + this._layout.gapW;
    const cellTopInGrid  = r0.top  - gridRect.top;
    const cellLeftInGrid = r0.left - gridRect.left;
    for (let c = 0; c < COLS; c++) {
      const div = this._previewCells[c];
      div.style.top    = (cellTopInGrid  + ROWS * rowStep) + 'px';
      div.style.left   = (cellLeftInGrid + c * colStep) + 'px';
      div.style.width  = this._layout.cellW + 'px';
      div.style.height = this._layout.cellH + 'px';
    }
    return this._layout;
  }

  _borrowFallingDiv(wrap) {
    let div = this._fallingPool.find(d => !d._inUse);
    if (!div) {
      div = document.createElement('div');
      div.className = 'wta-cell wta-falling-overlay';
      wrap.appendChild(div);
      this._fallingPool.push(div);
    }
    div._inUse = true;
    return div;
  }

  render(game, now) {
    if (!this._built) this._build();

    const gridEl     = document.getElementById('wta-grid');
    const wrap       = document.getElementById('wta-grid-wrap');
    const frameEl    = document.getElementById('wta-grid-frame');
    const cursorEl   = document.getElementById('wta-cursor');
    const overlayEl  = document.getElementById('wta-overlay');
    // Desktop elements
    const scoreEl    = document.getElementById('wta-score');
    const levelEl    = document.getElementById('wta-level');
    const levelSubEl = document.getElementById('wta-level-sub');
    const pendingEl  = document.getElementById('wta-pending-d');
    const comboEl    = document.getElementById('wta-combo');
    const comboBarEl  = document.getElementById('wta-combo-bar-d');
    const comboPanelEl= document.getElementById('wta-combo-panel');
    const abilEl      = document.getElementById('wta-abilities');
    // Mobile elements
    const scoreMEl    = document.getElementById('wta-score-m');
    const levelMEl    = document.getElementById('wta-level-m');
    const pendingMEl  = document.getElementById('wta-pending');
    const comboMEl    = document.getElementById('wta-combo-m');
    const comboBarEl2 = document.getElementById('wta-combo-bar');
    const comboBlockMEl = document.getElementById('wta-combo-block-m');
    const abilMEl     = document.getElementById('wta-abilities-m');

    const setText = (els, val) => { for (const el of els) if (el) el.textContent = val; };

    const layout = this._getLayout(gridEl, wrap);
    const riseOffset = (typeof game.riseOffset !== 'undefined') ? game.riseOffset : 0;
    const riseShift  = riseOffset * (layout.cellH + layout.gapH); // px upward shift

    // ── Detect grid rise (all rows shifted up by 1) ──────────────────────────
    let risen = false;
    if (this._prevGrid) {
      let match = true;
      for (let r = 0; r < ROWS - 1 && match; r++)
        for (let c = 0; c < COLS && match; c++)
          if (game.grid[r][c] !== this._prevGrid[r + 1][c]) match = false;
      if (match) {
        for (let c = 0; c < COLS; c++) {
          if (game.grid[ROWS - 1][c] !== this._prevGrid[ROWS - 1][c]) { risen = true; break; }
        }
      }
    }

    // ── Detect swaps (adjacent cells that exchanged values) ──────────────────
    const swapAnim = {}; // "r,c" → 'from-right' | 'from-left'
    if (this._prevGrid && !risen) {
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS - 1; c++) {
          const pA = this._prevGrid[r][c], pB = this._prevGrid[r][c + 1];
          const cA = game.grid[r][c],      cB = game.grid[r][c + 1];
          if (pA !== cA && pB !== cB && pA === cB && pB === cA) {
            swapAnim[`${r},${c}`]     = 'from-right'; // new block came from the right
            swapAnim[`${r},${c + 1}`] = 'from-left';  // new block came from the left
          }
        }
      }
    }

    // ── Detect landings ──────────────────────────────────────────────────────
    // A block "landed" if it was in _prevFalling but is no longer in fallingBlocks.
    // Skip blocks whose targetRow < 0 — those were removed by _rise(), not by landing.
    const nowFallingKeys = new Set(game.fallingBlocks.map(b => `${b.col},${b.targetRow}`));
    const justLanded = new Set(); // "row,col"
    for (const b of this._prevFalling) {
      if (b.targetRow >= 0 && !nowFallingKeys.has(`${b.col},${b.targetRow}`))
        justLanded.add(`${b.targetRow},${b.col}`);
    }

    // ── Falling block overlay divs (smooth sub-row positioning) ──────────────
    for (const d of this._fallingPool) d._inUse = false;
    const fallingCells = new Set(); // "row,col" keys obscured by an overlay div

    for (const b of game.fallingBlocks) {
      if (b.row < 0) continue;
      const div  = this._borrowFallingDiv(wrap);
      div.dataset.color = b.color;
      const top  = layout.originTop  + b.row * (layout.cellH + layout.gapH) - riseShift;
      const left = layout.originLeft + b.col * (layout.cellW + layout.gapW);
      div.style.cssText = `top:${top}px;left:${left}px;width:${layout.cellW}px;height:${layout.cellH}px;display:block`;
      const roundRow = Math.min(ROWS - 1, Math.round(b.row));
      if (roundRow >= 0) fallingCells.add(`${roundRow},${b.col}`);
    }
    for (const d of this._fallingPool) if (!d._inUse) d.style.display = 'none';

    // ── Grid cells ───────────────────────────────────────────────────────────
    // Animation strategy: set base className in the first pass, then after a single
    // forced reflow, add animation classes. This allows CSS animations to restart
    // cleanly. Running animations are maintained by re-including their class each frame
    // (setting the same animation class again does NOT restart the animation).
    const animNeeded = []; // [{idx, cls}] — cells starting a new animation this frame

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const idx = r * COLS + c;
        const div = this._cells[idx];
        const key = `${r},${c}`;
        const color      = fallingCells.has(key) ? 0 : game.grid[r][c];
        const isClearing = game.clearing.has(key);

        div.dataset.color = color || '';

        // Determine if a new animation should start (clearing cells: no anim, their flash wins)
        let newAnim = '';
        if (!isClearing) {
          if (swapAnim[key] && color !== 0)             newAnim = `swap-${swapAnim[key]}`;
          else if (justLanded.has(key) && color !== 0)  newAnim = 'landing';
        }

        // If the cell is clearing, kill any existing animation to avoid CSS conflict
        const existingAnim = isClearing ? '' : this._animCls[idx];
        if (isClearing && this._animCls[idx]) this._animCls[idx] = '';

        if (newAnim) {
          // Set base class now; animation class added after reflow below
          div.className = 'wta-cell' + (isClearing ? ' clearing' : '');
          animNeeded.push({ idx, cls: newAnim });
        } else {
          // Maintain existing running animation (re-adding same class doesn't restart it)
          div.className = 'wta-cell' + (isClearing ? ' clearing' : '') + (existingAnim ? ' ' + existingAnim : '');
        }
      }
    }

    // Single forced reflow, then add all new animation classes
    if (animNeeded.length > 0) {
      void this._cells[0].offsetWidth;
      for (const { idx, cls } of animNeeded) {
        this._cells[idx].classList.add(cls);
        this._animCls[idx] = cls;
        const capturedIdx = idx, capturedCls = cls;
        this._cells[idx].addEventListener('animationend', () => {
          if (this._animCls[capturedIdx] === capturedCls) this._animCls[capturedIdx] = '';
        }, { once: true });
      }
    }

    // ── Preview (incoming) row ───────────────────────────────────────────────
    for (let c = 0; c < COLS; c++) {
      this._previewCells[c].dataset.color = game.grid[ROWS]?.[c] || '';
    }

    // ── Rise animation: translate grid up continuously ───────────────────────
    gridEl.style.transform = riseShift > 0 ? `translateY(-${riseShift.toFixed(2)}px)` : '';

    // ── Cursor ───────────────────────────────────────────────────────────────
    const showCursor = game.state !== 'picking' && game.state !== 'gameOver';
    const cr = game.cursorRow, cc = game.cursorCol;
    if (showCursor) {
      const c0 = cr === ROWS ? this._previewCells[cc]     : this._cells[cr * COLS + cc];
      const c1 = cr === ROWS ? this._previewCells[cc + 1] : this._cells[cr * COLS + cc + 1];
      const wrapRect = wrap.getBoundingClientRect();
      const b0 = c0.getBoundingClientRect();
      const b1 = c1.getBoundingClientRect();
      cursorEl.style.left         = (b0.left - wrapRect.left) + 'px';
      cursorEl.style.top          = (b0.top  - wrapRect.top)  + 'px';
      cursorEl.style.width        = (b1.right - b0.left) + 'px';
      cursorEl.style.height       = b0.height + 'px';
      cursorEl.style.borderRadius = (b0.height * 0.2) + 'px';
      cursorEl.classList.remove('hidden');
    } else {
      cursorEl.classList.add('hidden');
    }

    gridEl.classList.toggle('overclock', game.overclockMult > 1);

    if (game.comboStop > 0 && game.comboLevel > 1) {
      const lvl      = game.comboLevel - 1; // 1 at x2, 2 at x3, etc.
      const periodMs = Math.max(75, 600 / Math.pow(2, lvl - 1)) * 6;
      const border   = Math.min(10, 3 + (lvl - 1) * 1.5);
      const glow     = Math.min(80, 24 + (lvl - 1) * 14);
      const glowText = Math.min(24, 4 + (lvl - 1) * 4);
      const hue      = Math.round((Date.now() % periodMs) / periodMs * 360);
      const col      = `hsl(${hue},100%,65%)`;
      const colA     = `hsla(${hue},100%,65%,0.65)`;
      const root     = document.documentElement;
      root.style.setProperty('--combo-color',    col);
      root.style.setProperty('--combo-color-a',  colA);
      root.style.setProperty('--combo-glow-text', glowText.toFixed(0) + 'px');
      frameEl.style.setProperty('--combo-border', border.toFixed(1) + 'px');
      frameEl.style.setProperty('--combo-glow',   glow.toFixed(0) + 'px');
      frameEl.classList.add('combo');
      for (const el of [comboEl, comboMEl, pendingEl, pendingMEl]) if (el) el.classList.add('wta-combo-rainbow');
    } else {
      frameEl.classList.remove('combo');
      for (const el of [comboEl, comboMEl, pendingEl, pendingMEl]) if (el) el.classList.remove('wta-combo-rainbow');
    }

    // Score / level — integer count-up: compute step per frame so it takes ~1.5s at 30fps
    if (game.score !== this._scoreTo) {
      this._scoreTo    = game.score;
      const delta      = this._scoreTo - this._displayScore;
      const frames     = 45; // ~1.5s at 30fps
      this._scoreStep  = Math.max(1, Math.ceil(delta / frames));
    }
    if (this._displayScore < this._scoreTo) {
      this._displayScore = Math.min(this._scoreTo, this._displayScore + this._scoreStep);
    }
    setText([scoreEl, scoreMEl], this._displayScore);
    const pendingTxt = game.chips > 0 ? `${game.chips} × ${game.mult}` : '';
    setText([pendingEl, pendingMEl], pendingTxt);
    setText([levelEl, levelMEl], game.level);
    const ptsToNext = Math.max(0, game.nextLevelScore - game.score);
    if (levelSubEl) levelSubEl.textContent = `next: ${ptsToNext} pts`;

    // Combo bar
    setText([comboEl, comboMEl], `\u00d7${Math.max(1, game.comboLevel)}`);
    if (game.comboStop > 0) {
      const pct = Math.min(100, (game.comboStop / game.freezeCap) * 100);
      const barColor = game.comboCount >= 4 ? '#f84' : '#5af';
      for (const bar of [comboBarEl, comboBarEl2]) {
        if (!bar) continue;
        bar.style.width = pct + '%';
        bar.style.background = barColor;
      }
    } else {
      for (const bar of [comboBarEl, comboBarEl2]) if (bar) bar.style.width = '0%';
    }

    // Abilities
    const entries = [...game.abilities.levels.entries()];
    if (abilEl) {
      if (entries.length === 0) {
        abilEl.innerHTML = '<span class="wta-dim">none yet</span>';
      } else {
        abilEl.innerHTML = entries.map(([id, lvl]) => {
          const ab = ABILITIES.find(a => a.id === id);
          return `<div class="wta-chip"><span>${ab.name}</span><span class="wta-alevel">Lv${lvl}</span></div>`;
        }).join('');
      }
    }
    if (abilMEl) {
      if (entries.length === 0) {
        abilMEl.innerHTML = '<span class="wta-dim">—</span>';
      } else {
        abilMEl.innerHTML = entries.map(([id, lvl]) => {
          const ab = ABILITIES.find(a => a.id === id);
          return `<span class="wta-chip-sm">${ab.name} <b style="color:#f0c040">${lvl}</b></span>`;
        }).join('');
      }
    }

    // Overlay — only rebuild DOM when state changes to avoid destroying elements mid-click
    const overlayKey = game.state === 'gameOver' ? `gameover:${game.score}` : game.state;
    if (overlayKey !== this._overlayState) {
      this._overlayState = overlayKey;

      if (game.state === 'gameOver') {
        overlayEl.classList.remove('hidden');
        overlayEl.innerHTML = `
          <h2>Game Over</h2>
          <div class="wta-go-score">${game.score}</div>
          <div class="wta-overlay-hint">press R to restart</div>`;
      } else if (game.state === 'paused') {
        overlayEl.classList.remove('hidden');
        overlayEl.innerHTML = `<h2>Paused</h2><div class="wta-overlay-hint">press P to resume</div>`;
      } else if (game.state === 'picking') {
        overlayEl.classList.remove('hidden');
        const opts = game.pickOptions.map((ab, i) => {
          const nextLvl = game.abilities.level(ab.id) + 1;
          const owned   = game.abilities.level(ab.id) > 0;
          return `<div class="wta-pick" data-choice="${i}">
            <div class="wta-pick-header">
              <span class="wta-pick-key">${i + 1}</span>
              <span class="wta-pick-name">${ab.name}</span>
              ${owned ? `<span class="wta-pick-lvl">Lv ${nextLvl}</span>` : ''}
            </div>
            <div class="wta-pick-desc">${ab.describe(nextLvl)}</div>
          </div>`;
        }).join('');
        overlayEl.innerHTML = `<h2>Choose Ability</h2>${opts}`;
        overlayEl.querySelectorAll('.wta-pick').forEach(el => {
          el.addEventListener('mousedown', () => {
            game.pick(parseInt(el.dataset.choice));
          });
        });
      } else {
        overlayEl.classList.add('hidden');
      }
    }

    // ── Save state for next frame ────────────────────────────────────────────
    this._prevGrid    = game.grid.map(row => [...row]);
    this._prevFalling = game.fallingBlocks.map(b => ({ col: b.col, targetRow: b.targetRow }));
  }

  reset() {
    this._overlayState = null;
    this._prevGrid     = null;
    this._prevFalling  = [];
    this._layout       = null;
    for (let i = 0; i < this._animCls.length; i++) this._animCls[i] = '';
  }

  invalidateLayout() {
    this._layout = null;
  }
}

module.exports = { WebRenderer };
