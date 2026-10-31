// Builds clearshelf-<version>.zip containing only what Chrome needs (no tests, docs or tooling).
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const out = path.join(root, `clearshelf-${version}.zip`);
if (fs.existsSync(out)) fs.rmSync(out);
execFileSync('zip', ['-r', '-q', out, 'manifest.json', 'src', 'icons/icon-16.png', 'icons/icon-32.png', 'icons/icon-48.png', 'icons/icon-128.png', 'icons/icon-off-16.png', 'icons/icon-off-32.png', 'icons/icon-off-48.png', 'icons/icon-off-128.png'], { cwd: root });
console.log('wrote', out);
