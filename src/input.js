const INITIAL_DELAY   =  80; // ms before repeat kicks in after first press
const REPEAT_INTERVAL =  40; // ms between repeated moves while held
const RELEASE_TIMEOUT = 100; // ms of silence = key released

class Input {
  constructor() {
    this._handlers    = {};
    this._heldDir     = null;
    this._delayTimer  = null;
    this._repeatTimer = null;
    this._releaseTimer = null;
  }

  on(event, fn) {
    this._handlers[event] = fn;
    return this;
  }

  start() {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', this._onData.bind(this));
  }

  stop() {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    this._stopRepeat();
  }

  _emit(event) {
    this._handlers[event]?.();
  }

  _onData(key) {
    const action = this._keyToRepeatable(key);
    if (action) {
      if (action !== this._heldDir) {
        // New action: fire immediately and start repeat sequence
        this._stopRepeat();
        this._heldDir = action;
        this._emit(action);
        this._delayTimer = setTimeout(() => {
          this._delayTimer  = null;
          this._repeatTimer = setInterval(() => this._emit(action), REPEAT_INTERVAL);
        }, INITIAL_DELAY);
      }
      // Either way, reset the release watchdog
      clearTimeout(this._releaseTimer);
      this._releaseTimer = setTimeout(() => this._stopRepeat(), RELEASE_TIMEOUT);
      return;
    }

    // Non-repeatable key
    this._stopRepeat();
    switch (key) {
      case 'z': case ' ':    this._emit('swap');    break;
      case 'p':              this._emit('pause');   break;
      case 'r':              this._emit('restart'); break;
      case 'q': case '\x03': case '\x1b': this._emit('quit'); break;
    }
  }

  _stopRepeat() {
    clearTimeout(this._delayTimer);
    clearInterval(this._repeatTimer);
    clearTimeout(this._releaseTimer);
    this._delayTimer   = null;
    this._repeatTimer  = null;
    this._releaseTimer = null;
    this._heldDir      = null;
  }

  _keyToRepeatable(key) {
    switch (key) {
      case '\x1b[A': case 'w': return 'up';
      case '\x1b[B': case 's': return 'down';
      case '\x1b[C': case 'd': return 'right';
      case '\x1b[D': case 'a': return 'left';
      case 'x':                return 'raise';
    }
    return null;
  }
}

module.exports = { Input };
