#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');

const BUILDS = {
  tty: {
    out: 'dist/ttytetrisattack.js',
    files: [
      'src/grid.js',
      'src/abilities.js',
      'src/abilityManager.js',
      'src/game.js',
      'platforms/tty/input.js',
      'platforms/tty/renderer.js',
      'platforms/tty/index.js',
      'src/engine.js',
      'index.js',
    ],
  },
};

const target = process.argv[2] || 'tty';
const build  = BUILDS[target];

if (!build) {
  console.error(`Unknown target: "${target}". Available: ${Object.keys(BUILDS).join(', ')}`);
  process.exit(1);
}

const parts = ['#!/usr/bin/env node', "'use strict';", ''];

for (const file of build.files) {
  let src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  // Strip local require() lines and module.exports lines
  src = src.replace(/^(?:const|let|var)\s+.*require\(['"][./][^'"]*['"]\).*\n/gm, '');
  src = src.replace(/^module\.exports\s*=.*\n/gm, '');
  parts.push(`// ── ${file} ─────────────────────────────────────`);
  parts.push(src.trim());
  parts.push('');
}

const out = path.join(__dirname, build.out);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, parts.join('\n'));
fs.chmodSync(out, 0o755);

const kb = (fs.statSync(out).size / 1024).toFixed(1);
console.log(`built ${target}  →  ${build.out}  (${kb} kB)`);
