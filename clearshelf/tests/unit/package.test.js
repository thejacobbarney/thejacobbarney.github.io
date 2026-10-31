'use strict';
// Guards the properties promised in the README: minimal permissions, no network, no remote code,
// no leakage of test ground truth into shipped code, every manifest path exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const shipped = walk(path.join(root, 'src')).filter((f) => /\.(js|html|css)$/.test(f));

test('manifest is MV3 with only the storage permission and no host permissions', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.equal(manifest.externally_connectable, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
});

test('content scripts match only amazon.com over https', () => {
  for (const cs of manifest.content_scripts) {
    for (const m of cs.matches) assert.match(m, /^https:\/\/(www\.)?amazon\.com\/\*$/);
    assert.equal(cs.all_frames, false);
  }
});

test('every file referenced by the manifest exists', () => {
  const refs = [
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    manifest.action.default_popup,
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((c) => [...c.js, ...(c.css || [])]),
  ];
  for (const r of refs) assert.ok(fs.existsSync(path.join(root, r)), r);
  for (const prefix of ['icon', 'icon-off']) for (const s of [16, 32, 48, 128]) assert.ok(fs.existsSync(path.join(root, 'icons', `${prefix}-${s}.png`)));
});

test('shipped code makes no network requests and runs no remote or dynamic code', () => {
  const banned = [
    [/\bfetch\s*\(/, 'fetch('],
    [/XMLHttpRequest/, 'XMLHttpRequest'],
    [/\bWebSocket\b/, 'WebSocket'],
    [/sendBeacon/, 'sendBeacon'],
    [/\beval\s*\(/, 'eval('],
    [/new\s+Function\s*\(/, 'new Function('],
    [/importScripts\s*\(\s*['"]https?:/, 'remote importScripts'],
    [/<script[^>]+src=["']https?:/, 'remote script tag'],
    [/\bgoogle-analytics|gtag\(|segment\.com|mixpanel|sentry/i, 'analytics'],
  ];
  for (const f of shipped) {
    const text = fs.readFileSync(f, 'utf8');
    for (const [re, name] of banned) assert.equal(re.test(text), false, `${path.relative(root, f)} uses ${name}`);
  }
});

test('shipped code never reads the test ground-truth attributes', () => {
  for (const f of shipped) {
    const text = fs.readFileSync(f, 'utf8');
    assert.equal(/data-truth|data-variant/.test(text), false, path.relative(root, f));
  }
});

test('the only external URLs in shipped code are inert selectors/patterns', () => {
  for (const f of shipped) {
    const text = fs.readFileSync(f, 'utf8');
    const urls = text.match(/https?:\/\/[^\s'")`]+/g) || [];
    for (const u of urls) assert.match(u, /^https?:\/\/(www\.w3\.org|developer\.chrome\.com|example)/, `${path.relative(root, f)}: ${u}`);
  }
});

test('manifest version matches CS.VERSION', () => {
  const CS = require('../../src/shared/constants.js');
  assert.equal(CS.VERSION, manifest.version);
});
