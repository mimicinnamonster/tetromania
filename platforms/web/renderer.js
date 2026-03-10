'use strict';

// ROWS, COLS, ABILITIES, MILESTONES are injected by the build (concatenated from src/).

class WebRenderer {
  constructor() {
    this._cells      = [];
    this._built      = false;
    this._overlayState = null; // tracks last state used to build the overlay
  }

  _build() {
    const gridEl = document.getElementById('wta-grid');
    gridEl.innerHTML = '';
    this._cells = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const div = document.createElement('div');
        div.className = 'wta-cell';
        gridEl.appendChild(div);
        this._cells.push(div);
      }
    }
    this._built = true;
  }

  render(game, now) {
    if (!this._built) this._build();

    const gridEl     = document.getElementById('wta-grid');
    const overlayEl  = document.getElementById('wta-overlay');
    const scoreEl    = document.getElementById('wta-score');
    const levelEl    = document.getElementById('wta-level');
    const levelSubEl = document.getElementById('wta-level-sub');
    const pendingEl  = document.getElementById('wta-pending');
    const comboEl    = document.getElementById('wta-combo');
    const comboBarEl = document.getElementById('wta-combo-bar');
    const abilEl     = document.getElementById('wta-abilities');

    // Build display: grid + falling block overlay
    const display  = game.grid.map(row => [...row]);
    const falling  = Array.from({length: ROWS}, () => new Array(COLS).fill(false));
    for (const b of game.fallingBlocks) {
      const r = Math.min(ROWS-1, Math.round(b.row));
      if (r >= 0 && display[r][b.col] === 0) {
        display[r][b.col] = b.color;
        falling[r][b.col] = true;
      }
    }

    // Cursor — only shown during active play states
    const showCursor = game.state !== 'picking' && game.state !== 'gameOver';
    const cr = game.cursorRow, cc = game.cursorCol;
    const wide = showCursor && game.wideswapReady && cc <= COLS-3;

    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const div   = this._cells[r * COLS + c];
        const color = display[r][c];
        const key   = `${r},${c}`;

        div.dataset.color = color || '';

        let cls = 'wta-cell';
        if (falling[r][c]) cls += ' falling';
        if (game.clearing.has(key)) cls += ' clearing';
        if (showCursor && r === cr) {
          if (wide) {
            if (c === cc)     cls += ' cursor-left';
            else if (c === cc+1) cls += ' cursor-mid';
            else if (c === cc+2) cls += ' cursor-right';
          } else {
            if (c === cc)     cls += ' cursor-left';
            else if (c === cc+1) cls += ' cursor-right';
          }
        }

        div.className = cls;
      }
    }

    gridEl.classList.toggle('overclock', game.overclockMult > 1);

    // Rainbow border during combo freeze
    if (game.comboStop > 0) {
      const period = Math.max(75, 600 / Math.pow(2, game.comboLevel - 1));
      gridEl.style.setProperty('--rainbow-period', (period * 6 / 1000).toFixed(3) + 's');
      gridEl.classList.add('combo');
    } else {
      gridEl.classList.remove('combo');
    }

    // Score / level
    scoreEl.textContent = game.score;
    pendingEl.textContent = game.pendingScore > 0 ? `+${game.pendingScore}` : '';
    levelEl.textContent = game.level;
    const next = MILESTONES[game._nextMilestone];
    levelSubEl.textContent = next ? `next ability: ${next}` : 'max milestones';

    // Combo bar
    if (game.comboStop > 0) {
      comboEl.textContent = `\u00d7${game.comboCount}`;
      const pct = Math.min(100, (game.comboStop / game.freezeCap) * 100);
      comboBarEl.style.width = pct + '%';
      comboBarEl.style.background = game.comboCount >= 4 ? '#f84' : '#5af';
    } else {
      comboEl.textContent = '\u2014';
      comboBarEl.style.width = '0%';
    }

    // Abilities
    const entries = [...game.abilities.levels.entries()];
    if (entries.length === 0) {
      abilEl.innerHTML = '<span class="wta-dim">none yet</span>';
    } else {
      abilEl.innerHTML = entries.map(([id, lvl]) => {
        const ab = ABILITIES.find(a => a.id === id);
        return `<div class="wta-chip"><span>${ab.name}</span><span class="wta-alevel">Lv${lvl}</span></div>`;
      }).join('');
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
          <div class="wta-dim">press R to restart</div>`;
      } else if (game.state === 'paused') {
        overlayEl.classList.remove('hidden');
        overlayEl.innerHTML = `<h2>Paused</h2><div class="wta-dim">press P to resume</div>`;
      } else if (game.state === 'picking') {
        overlayEl.classList.remove('hidden');
        const opts = game.pickOptions.map((ab, i) => {
          const nextLvl = game.abilities.level(ab.id) + 1;
          const owned   = game.abilities.level(ab.id) > 0;
          return `<div class="wta-pick" data-choice="${i}">
            <span class="wta-pick-key">[${i+1}]</span>
            <span class="wta-pick-name">${ab.name}</span>
            ${owned ? `<div class="wta-pick-lvl">Upgrade \u2192 Level ${nextLvl}</div>` : ''}
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
  }

  reset() {
    this._overlayState = null;
  }
}

module.exports = { WebRenderer };
