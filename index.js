const { Engine }      = require('./src/engine');
const { TtyPlatform } = require('./platforms/tty');

new Engine(new TtyPlatform()).start();
