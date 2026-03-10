const { Input }    = require('./input');
const { Renderer } = require('./renderer');

class TtyPlatform {
  constructor() {
    this._input    = new Input();
    this._renderer = new Renderer();
  }

  // Called by engine; `onInput(event)` is called for every user action
  init(onInput) {
    const events = [
      'quit', 'restart',
      'left', 'right', 'up', 'down',
      'swap', 'raise',
      'pick1', 'pick2', 'pick3',
      'pause',
    ];
    for (const e of events) this._input.on(e, () => onInput(e));
    this._input.start();

    process.stdout.on('resize', () => { this._renderer._firstRender = true; });
    process.on('SIGINT',  () => onInput('quit'));
    process.on('SIGTERM', () => onInput('quit'));
  }

  render(game, now) {
    this._renderer.render(game, now);
  }

  // Called by engine when a new game starts
  reset() {
    this._renderer._firstRender = true;
  }

  // Called by engine on quit
  destroy() {
    this._input.stop();
    this._renderer.cleanup();
    process.stdout.write('\x1b[2J\x1b[H');
    process.exit(0);
  }
}

module.exports = { TtyPlatform };
