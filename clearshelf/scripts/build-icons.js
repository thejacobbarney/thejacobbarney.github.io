// Renders icons/src/*.svg to the PNG sizes Chrome needs. Dev-only; the PNGs are committed.
// Usage: node scripts/build-icons.js
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..', 'icons');
const jobs = [
  { src: 'src/icon.svg', prefix: 'icon' },
  { src: 'src/icon-off.svg', prefix: 'icon-off' },
];
const sizes = [16, 32, 48, 128];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const job of jobs) {
    const svg = fs.readFileSync(path.join(root, job.src), 'utf8');
    for (const size of sizes) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
      await page.screenshot({ path: path.join(root, `${job.prefix}-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    }
  }
  await browser.close();
  console.log('icons written to', root);
})();
