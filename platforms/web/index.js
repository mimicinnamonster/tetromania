'use strict';

const { WebInput }    = require('./input');
const { WebRenderer } = require('./renderer');

class WebPlatform {
  constructor() {
    this._input    = new WebInput();
    this._renderer = new WebRenderer();
  }

  init(onInput) {
    this._input.start(onInput);
  }

  render(game, now) {
    this._renderer.render(game, now);
  }

  reset() {
    this._renderer.reset();
  }

  destroy() {
    this._input.stop();
  }
}

module.exports = { WebPlatform };
