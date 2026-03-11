'use strict';

const REPEAT_DELAY = 180;
const REPEAT_RATE  = 75;

const REPEATABLE = new Set([
  'ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
  'a','d','w','s','x',
]);

const KEY_MAP = {
  ArrowLeft: 'left',  a: 'left',
  ArrowRight:'right', d: 'right',
  ArrowUp:   'up',    w: 'up',
  ArrowDown: 'down',  s: 'down',
  z: 'swap',  ' ': 'swap',
  x: 'raise',
  p: 'pause',
  r: 'restart',
  1: 'pick1', 2: 'pick2', 3: 'pick3',
  q: 'quit',
};

const SWIPE_THRESHOLD = 18; // px — minimum horizontal movement to count as a swap swipe

class WebInput {
  constructor() {
    this._handlers  = new Map();
    this._held      = new Map(); // key -> { since, lastRepeat }
    this._rafId     = null;
    this._onInput   = null;
  }

  on(event, fn) {
    this._handlers.set(event, fn);
  }

  start(onInput) {
    this._onInput = onInput;
    this._boundDown = e => this._onKeyDown(e);
    this._boundUp   = e => this._onKeyUp(e);
    document.addEventListener('keydown', this._boundDown);
    document.addEventListener('keyup',   this._boundUp);
    this._scheduleRepeat();
    this._setupTouch();
  }

  stop() {
    document.removeEventListener('keydown', this._boundDown);
    document.removeEventListener('keyup',   this._boundUp);
    cancelAnimationFrame(this._rafId);
  }

  _setupTouch() {
    const gridEl = document.getElementById('wta-grid');
    if (gridEl) {
      let touchStartX = 0, touchStartY = 0;
      let touchStartCol = 0, touchStartRow = 0;

      gridEl.addEventListener('touchstart', e => {
        e.preventDefault();
        const t = e.touches[0];
        touchStartX = t.clientX;
        touchStartY = t.clientY;
        const rect = gridEl.getBoundingClientRect();
        touchStartCol = Math.floor(((t.clientX - rect.left) / rect.width)  * COLS);
        touchStartRow = Math.floor(((t.clientY - rect.top)  / rect.height) * ROWS);
        touchStartCol = Math.max(0, Math.min(COLS - 1, touchStartCol));
        touchStartRow = Math.max(0, Math.min(ROWS - 1, touchStartRow));
      }, { passive: false });

      gridEl.addEventListener('touchend', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;

        if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
          // Horizontal swipe → place cursor at the pair being swiped, then swap
          let cursorCol;
          if (dx > 0) {
            // Swiping right: the left block of the pair is the touched column
            cursorCol = Math.max(0, Math.min(COLS - 2, touchStartCol));
          } else {
            // Swiping left: the right block of the pair is the touched column
            cursorCol = Math.max(0, Math.min(COLS - 2, touchStartCol - 1));
          }
          this._onInput(`moveto:${touchStartRow},${cursorCol}`);
          this._onInput('swap');
        } else {
          // Tap (no meaningful swipe) → just move cursor
          const cursorCol = Math.max(0, Math.min(COLS - 2, touchStartCol));
          this._onInput(`moveto:${touchStartRow},${cursorCol}`);
        }
      }, { passive: false });
    }

    // Small action buttons (raise / pause / restart)
    const btnMap = {
      'wta-btn-raise':   'raise',
      'wta-btn-pause':   'pause',
      'wta-btn-restart': 'restart',
    };
    for (const [id, event] of Object.entries(btnMap)) {
      const el = document.getElementById(id);
      if (!el) continue;
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        this._onInput(event);
      }, { passive: false });
    }

    // Ability pick card taps in overlay
    document.getElementById('wta-overlay')?.addEventListener('touchend', e => {
      const card = e.target.closest('.wta-pick');
      if (card) {
        e.preventDefault();
        card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    }, { passive: false });

    // Invalidate layout cache on resize / orientation change
    window.addEventListener('resize', () => {
      const renderer = window._wtaRenderer;
      if (renderer) renderer.invalidateLayout();
    });
  }

  _fire(key) {
    const event = KEY_MAP[key];
    if (!event) return;
    this._onInput(event);
  }

  _onKeyDown(e) {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(e.key))
      e.preventDefault();
    if (!this._held.has(e.key)) {
      this._held.set(e.key, { since: performance.now(), lastRepeat: performance.now() });
      this._fire(e.key);
    }
  }

  _onKeyUp(e) {
    this._held.delete(e.key);
  }

  _scheduleRepeat() {
    const tick = (now) => {
      for (const [key, info] of this._held) {
        if (REPEATABLE.has(key) &&
            now - info.since > REPEAT_DELAY &&
            now - info.lastRepeat > REPEAT_RATE) {
          info.lastRepeat = now;
          this._fire(key);
        }
      }
      this._rafId = requestAnimationFrame(tick);
    };
    this._rafId = requestAnimationFrame(tick);
  }
}

module.exports = { WebInput };
