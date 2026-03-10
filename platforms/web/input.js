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
  }

  stop() {
    document.removeEventListener('keydown', this._boundDown);
    document.removeEventListener('keyup',   this._boundUp);
    cancelAnimationFrame(this._rafId);
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
