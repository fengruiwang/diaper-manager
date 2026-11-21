'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const stableSha = 'cc908a037ecb754f3aa47bba7f94c87bff70e6b1';
const entry = 'preview/v1.3.0/formal/index.html';
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');
const stable = file => execFileSync('git', ['show', stableSha + ':' + file], {
  cwd: root, encoding: 'utf8',
});
const preview = read(entry);
const stableHtml = stable('index.html');
const markup = html => html.split('<script>')[0];
const inlineScripts = html => Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
const externalScripts = html => Array.from(html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g), match => match[1]);

test('V1.3.0 local preview has its own title and robots directive', () => {
  assert.match(markup(preview), /<title>小宝管家 V1\.3\.0 本地预览<\/title>/);
  assert.match(markup(preview), /<meta name="robots" content="noindex,nofollow" \/>/);
});

test('V1.3.0 local preview retains the five stable tabs and their business panels', () => {
  const tabs = ['overview', 'compare', 'history', 'growth', 'settings'];
  const tags = markup(preview);
  assert.deepEqual(Array.from(tags.matchAll(/<button class="tab(?: active)?" data-tab="([^"]+)"/g), m => m[1]), tabs);
  assert.deepEqual(Array.from(tags.matchAll(/<section class="panel(?: active)?" id="([^"]+)"/g), m => m[1]), tabs);
  for (const id of [
    'formalGate', 'formalOtp', 'formalConfirmOtp', 'kpiGrid', 'qBrand', 'saveQuote',
    'buyNow', 'historyList', 'saveStocks', 'growthChart', 'growthHistory', 'saveWeight',
    'saveProfile', 'savePlans', 'formalGetCloudLatest',
  ]) {
    assert.ok(tags.includes('id="' + id + '"'), 'Missing DOM ID ' + id);
  }
  const businessMarkup = html => markup(html).slice(markup(html).indexOf('<nav class="tabs"'));
  assert.equal(businessMarkup(preview), businessMarkup(stableHtml));
});

test('V1.3.0 controllers resolve from the nested preview URL to the stable root files', () => {
  const pageUrl = new URL('/' + entry.replace(/index\.html$/, ''), 'http://localhost:8000');
  const files = ['m1-controller.js', 'formal-controller.js'];
  const references = externalScripts(preview);
  assert.deepEqual(references, files.map(file => '../../../' + file));
  for (const [index, file] of files.entries()) {
    const url = new URL(references[index], pageUrl);
    assert.equal(url.href, new URL('/' + file, pageUrl).href);
    assert.equal(read(url.pathname.slice(1)), stable(file));
  }
});

test('V1.3.0 local preview excludes old preview resources, S140 fixtures and PWA entry points', () => {
  assert.doesNotMatch(preview, /preview\/v1\.2\.0|\bS140\b|\bnavigator\.serviceWorker(?:\?\.)?\.register/);
  assert.doesNotMatch(markup(preview), /rel="(?:manifest|icon|apple-touch-icon)"|id="(?:installPwa|pwaLaunch|pwaUpdateNotice)"/);
});

test('V1.3.0 local preview keeps the stable embedded business scripts and production root intact', () => {
  const scripts = inlineScripts(stableHtml);
  assert.ok(scripts.length > 0);
  assert.deepEqual(inlineScripts(preview), scripts);
  for (const file of ['index.html', 'pwa.js', 'sw.js', 'manifest.webmanifest', 'version.json']) {
    assert.equal(read(file), stable(file), file);
  }
});
