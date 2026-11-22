'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'release-candidate', 'pages-v1.3.0-rc1');
const stableSha = 'cc908a037ecb754f3aa47bba7f94c87bff70e6b1';
const featureSha = '734e8730cf8f263fd210cd8917c898db98b1d88b';
const assetVersion = '1.3.0';
const version = '1.3.0-rc.1';
const previewEntry = 'preview/v1.3.0/formal/index.html';

const stableFiles = [
  '.nojekyll', 'm1-controller.js', 'growth.js', 'pwa.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/icon.svg',
];
const featureFiles = new Map([
  ['outbox-contract.js', 'sync/outbox-contract.js'],
  ['idb-outbox.js', 'sync/idb-outbox.js'],
  ['maternal-health-client.js', 'sync/maternal-health-client.js'],
  ['maternal-health-operations.js', 'sync/maternal-health-operations.js'],
  ['maternal-weight.js', 'preview/v1.2.0/maternal-weight.js'],
  ['maternal-constipation.js', 'preview/v1.3.0/maternal-constipation.js'],
  ['formal-controller.js', 'preview/v1.3.0/formal-controller.js'],
]);

function readBlob(sha, file) {
  return execFileSync('git', ['cat-file', 'blob', `${sha}:${file}`], { cwd: root });
}

function replaceOnce(source, target, replacement) {
  const index = source.indexOf(target);
  assert.ok(index !== -1 && index === source.lastIndexOf(target), `Expected one occurrence: ${target}`);
  return source.slice(0, index) + replacement + source.slice(index + target.length);
}

function extract(source, pattern) {
  const matches = source.match(pattern);
  assert.equal(matches?.length, 1, `Expected one match in the pinned source: ${pattern}`);
  return matches[0];
}

function buildHtml(stable, preview) {
  const links = extract(stable, /^<link rel="manifest"[^\n]*\n<link rel="icon"[^\n]*\n<link rel="apple-touch-icon"[^\n]*/gm);
  const apple = extract(stable, /^(?:<meta name="apple-mobile-web-app-[^\n]*\n){3}/gm);
  const css = extract(stable, /^\/\* PWA install\/update layer[^\n]*\n[\s\S]*?^@media print\{\.pwa-launch[^\n]*/gm);
  const controls = extract(stable, /^  <div class="pwa-launch" id="pwaLaunch">[\s\S]*?id="pwaUpdateNow"[^\n]*\n  <\/div>/gm);
  const nav = '  <nav class="tabs" role="tablist" aria-label="功能导航">';
  let html = replaceOnce(preview, '<meta name="robots" content="noindex,nofollow" />', `${links}\n${apple.trimEnd()}`);
  html = replaceOnce(html, '<title>小宝管家 V1.3.0 本地预览</title>', '<title>小宝管家 V1.3.0 RC1 · 家庭云端管理</title>');
  const oldSource = extract(html, /^<meta name="xiaobao-pages-candidate-source"[^\n]*/gm);
  html = replaceOnce(html, oldSource, `<meta name="xiaobao-pages-candidate-source" content="${featureSha}" />`);
  html = replaceOnce(html, '<style>\n:root', `<style>\n${css}\n:root`);
  html = replaceOnce(html, nav, `${controls}\n\n${nav}`);

  const scripts = new Map([['m1-controller.js', 'm1-controller.js'], ...featureFiles]);
  for (const [file, source] of scripts) {
    const relativePath = path.posix.relative(path.posix.dirname(previewEntry), source);
    const tag = `<script src="./${file}?v=${assetVersion}" defer></script>`;
    // Keep growth inline as in both baselines. It is used by following inline scripts.
    const tags = file === 'formal-controller.js'
      ? `${tag}\n<script src="./pwa.js?v=${assetVersion}" defer></script>`
      : tag;
    html = replaceOnce(html, `<script src="${relativePath}" defer></script>`, tags);
  }
  assert.doesNotMatch(html, /(?:src|href)="\.\.\//);
  return html;
}

function buildWorker(stable) {
  let worker = replaceOnce(stable, 'PWA V1.2.0 stable release', 'PWA V1.3.0 RC1');
  worker = replaceOnce(worker, 'xiaobao-shell-v1.2.0', `xiaobao-shell-v${assetVersion}`);
  const anchor = "  './icons/icon-192.png'";
  const dependencies = [...featureFiles.keys()].filter(file => file !== 'formal-controller.js');
  const rows = [];
  for (let index = 0; index < dependencies.length; index += 2) {
    rows.push('  ' + dependencies.slice(index, index + 2).map(file => `'./${file}'`).join(',') + ',');
  }
  return replaceOnce(worker, anchor, `${rows.join('\n')}\n${anchor}`);
}

function buildFiles() {
  const files = new Map(stableFiles.map(file => [file, readBlob(stableSha, file)]));
  for (const [file, source] of featureFiles) files.set(file, readBlob(featureSha, source));
  files.set('index.html', Buffer.from(buildHtml(
    readBlob(stableSha, 'index.html').toString('utf8'),
    readBlob(featureSha, previewEntry).toString('utf8'),
  )));
  files.set('sw.js', Buffer.from(buildWorker(readBlob(stableSha, 'sw.js').toString('utf8'))));
  files.set('version.json', Buffer.from(JSON.stringify({
    version,
    channel: 'candidate',
    source_sha: featureSha,
    notes: '保留五个宝宝业务页面与 PWA 更新机制。妈妈健康支持家庭双账号共享、孕前档案与孕期产后体重、排便记录与统计、下拉和手动刷新、待确认保存核验及冲突处理。',
  }, null, 2) + '\n'));
  return files;
}

function inspectDirectory(files, check) {
  const parent = fs.lstatSync(path.dirname(output), { throwIfNoEntry: false });
  assert.ok(parent?.isDirectory(), 'Expected release-candidate to be a directory');
  const actual = new Set();
  function inspect(dir, prefix) {
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat && !check) return;
    assert.ok(stat?.isDirectory(), `Expected directory: ${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      const target = path.join(dir, entry.name);
      if (prefix === '' && name === 'icons' && entry.isDirectory()) {
        inspect(target, 'icons/');
      } else {
        assert.ok(entry.isFile() && files.has(name), `Unexpected candidate entry: ${name}`);
        actual.add(name);
        if (check) assert.ok(fs.readFileSync(target).equals(files.get(name)), `Stale candidate file: ${name}`);
      }
    }
  }
  inspect(output, '');
  if (check) {
    for (const name of files.keys()) assert.ok(actual.has(name), `Missing candidate file: ${name}`);
    assert.equal(actual.size, 20);
  }
}

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--check'),
  'Usage: node scripts/build-pages-v130-candidate.cjs [--check]');
const check = args.length === 1;
const files = buildFiles();
inspectDirectory(files, check);
if (!check) {
  fs.mkdirSync(path.join(output, 'icons'), { recursive: true });
  for (const [name, bytes] of files) fs.writeFileSync(path.join(output, name), bytes);
  inspectDirectory(files, true);
}
console.log(`Pages ${version}: ${check ? 'verified' : 'built and verified'} ${files.size} files`);
