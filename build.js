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
  web: {
    out:      'dist/web.html',
    template: 'platforms/web/template.html',
    files: [
      'src/grid.js',
      'src/abilities.js',
      'src/abilityManager.js',
      'src/game.js',
      'platforms/web/input.js',
      'platforms/web/renderer.js',
      'platforms/web/index.js',
      'src/engine.js',
    ],
  },
};

const args   = process.argv.slice(2);
const debug  = args.includes('--debug');
const target = args.find(a => !a.startsWith('--')) || 'tty';
const build  = BUILDS[target];

if (!build) {
  console.error(`Unknown target: "${target}". Available: ${Object.keys(BUILDS).join(', ')}`);
  process.exit(1);
}

// Strip local require/module.exports from a source file
function stripModuleGlue(src) {
  src = src.replace(/^(?:const|let|var)\s+.*require\(['"][./][^'"]*['"]\).*\n/gm, '');
  src = src.replace(/^module\.exports\s*=.*\n/gm, '');
  return src.trim();
}

const parts = ["'use strict';", `const DEBUG = ${debug};`, ''];

for (const file of build.files) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
  parts.push(`// ── ${file} ─────────────────────────────────────`);
  parts.push(stripModuleGlue(src));
  parts.push('');
}

const script = parts.join('\n');

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });

if (build.template) {
  const template = fs.readFileSync(path.join(__dirname, build.template), 'utf8');
  const html = template.replace('{{SCRIPT}}', script);
  fs.writeFileSync(path.join(__dirname, build.out), html);
} else {
  const out = path.join(__dirname, build.out);
  fs.writeFileSync(out, `#!/usr/bin/env node\n${script}`);
  fs.chmodSync(out, 0o755);
}

const kb = (fs.statSync(path.join(__dirname, build.out)).size / 1024).toFixed(1);
console.log(`built ${target}  →  ${build.out}  (${kb} kB)`);
