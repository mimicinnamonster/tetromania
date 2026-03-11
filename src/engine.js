const { Game } = require('./game');

const FPS        = 30;
const FRAME_TIME = Math.floor(1000 / FPS);

const INPUT_HANDLERS = {
  left:  g => g.moveLeft(),
  right: g => g.moveRight(),
  up:    g => g.moveUp(),
  down:  g => g.moveDown(),
  swap:  g => g.swap(),
  raise: g => g.raise(),
  pick1: g => g.pick(0),
  pick2: g => g.pick(1),
  pick3: g => g.pick(2),
  pause: g => g.togglePause(),
};

class Engine {
  constructor(platform) {
    this._platform = platform;
    this._game     = null;
    this._loop     = null;
    this._lastTime = 0;
  }

  start() {
    this._newGame();
    this._platform.init(event => this._handleInput(event));
    this._lastTime = Date.now();
    this._loop = setInterval(() => this._tick(), FRAME_TIME);
  }

  stop() {
    clearInterval(this._loop);
    this._loop = null;
    this._platform.destroy();
  }

  _newGame() {
    this._game = new Game();
    if (this._platform.reset) this._platform.reset();
  }

  _tick() {
    const now = Date.now();
    this._game.tick(now - this._lastTime);
    this._lastTime = now;
    this._platform.render(this._game, now);
  }

  _handleInput(event) {
    if (event === 'quit')    { this.stop(); return; }
    if (event === 'restart') { this._newGame(); return; }
    if (event.startsWith('moveto:')) {
      const [r, c] = event.slice(7).split(',').map(Number);
      if (isFinite(r) && isFinite(c)) {
        const g = this._game;
        if (g.state === 'playing' || g.state === 'falling' || g.state === 'clearing') {
          g.cursorRow = Math.max(0, Math.min(ROWS - 1, r));
          g.cursorCol = Math.max(0, Math.min(COLS - 2, c));
        }
      }
      return;
    }
    INPUT_HANDLERS[event]?.(this._game);
  }
}

module.exports = { Engine };
