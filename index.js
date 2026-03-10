const { Game }     = require('./src/game');
const { Renderer } = require('./src/renderer');
const { Input }    = require('./src/input');

const FPS        = 30;
const FRAME_TIME = Math.floor(1000 / FPS);

let game = new Game();
const renderer = new Renderer();
const input    = new Input();

function quit() {
  clearInterval(loop);
  input.stop();
  renderer.cleanup();
  process.stdout.write('\x1b[2J\x1b[H');
  process.exit(0);
}

input
  .on('quit',    quit)
  .on('restart', () => { game = new Game(); renderer._firstRender = true; })
  .on('left',    () => game.moveLeft())
  .on('right',   () => game.moveRight())
  .on('up',      () => game.moveUp())
  .on('down',    () => game.moveDown())
  .on('swap',    () => game.swap())
  .on('raise',   () => game.raise())
  .on('pick1',   () => game.pick(0))
  .on('pick2',   () => game.pick(1))
  .on('pick3',   () => game.pick(2))
  .on('pause',   () => game.togglePause());

input.start();

let lastTime = Date.now();

const loop = setInterval(() => {
  const now = Date.now();
  const dt  = now - lastTime;
  lastTime  = now;

  game.tick(dt);
  renderer.render(game, now);
}, FRAME_TIME);

// Force a full redraw when the terminal is resized
process.stdout.on('resize', () => {
  renderer._firstRender = true;
});

process.on('SIGINT',  quit);
process.on('SIGTERM', quit);
