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
    // Grid tap → move cursor to tapped cell
    const gridEl = document.getElementById('wta-grid');
    if (gridEl) {
      gridEl.addEventListener('touchend', e => {
        e.preventDefault();
        const t = e.changedTouches[0];
        const rect = gridEl.getBoundingClientRect();
        const x = t.clientX - rect.left;
        const y = t.clientY - rect.top;
        const col = Math.floor((x / rect.width)  * COLS);
        const row = Math.floor((y / rect.height) * ROWS);
        const clampedCol = Math.max(0, Math.min(COLS - 2, col));
        const clampedRow = Math.max(0, Math.min(ROWS - 1, row));
        this._onInput(`moveto:${clampedRow},${clampedCol}`);
      }, { passive: false });
    }

    // Touch control buttons
    const btnMap = {
      'wta-btn-left':    'left',
      'wta-btn-right':   'right',
      'wta-btn-up':      'up',
      'wta-btn-down':    'down',
      'wta-btn-swap':    'swap',
      'wta-btn-raise':   'raise',
      'wta-btn-pause':   'pause',
      'wta-btn-restart': 'restart',
    };
    for (const [id, event] of Object.entries(btnMap)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const repeatable = ['left', 'right', 'up', 'down', 'raise'].includes(event);
      let repeatId = null;
      el.addEventListener('touchstart', e => {
        e.preventDefault();
        this._onInput(event);
        if (repeatable) {
          clearInterval(repeatId);
          repeatId = setInterval(() => this._onInput(event), REPEAT_RATE);
        }
      }, { passive: false });
      if (repeatable) {
        el.addEventListener('touchend',    () => { clearInterval(repeatId); repeatId = null; });
        el.addEventListener('touchcancel', () => { clearInterval(repeatId); repeatId = null; });
      }
    }

    // Ability pick card taps in overlay
    document.getElementById('wta-overlay')?.addEventListener('touchend', e => {
      const card = e.target.closest('.wta-pick');
      if (card) {
        e.preventDefault();
        card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      }
    }, { passive: false });
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
