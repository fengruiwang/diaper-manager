'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releaseDir = path.join(root, 'release-candidate');
const output = path.join(releaseDir, 'pages-v1.3.0-final');
const rc1Tree = '0c63dfa682f3df2de07b2315af18b108b8ebeccf:release-candidate/pages-v1.3.0-rc1';
const businessSha = '734e8730cf8f263fd210cd8917c898db98b1d88b';
const git = (...args) => execFileSync('git', args, { cwd: root });

function buildFiles() {
  const names = git('ls-tree', '-r', '--name-only', '-z', rc1Tree).toString('utf8').split('\0').filter(Boolean);
  assert.equal(names.length, 20, 'Expected 20 files in the pinned RC1 package');
  const files = new Map(names.map(name => [name, git('cat-file', 'blob', `${rc1Tree}/${name}`)]));
  const identifiers = [
    ['index.html', '<title>小宝管家 V1.3.0 RC1 · 家庭云端管理</title>', '<title>小宝管家 V1.3.0 · 家庭云端管理</title>'],
    ['formal-controller.js', '/* Standalone V1.2.0 stable full-write release.', '/* Standalone V1.3.0 stable full-write release.'],
    ['pwa.js', '/* V1.2.0 candidate PWA shell.', '/* V1.3.0 stable PWA shell.'],
    ['sw.js', '/* 小宝纸尿裤管家 PWA V1.3.0 RC1', '/* 小宝纸尿裤管家 PWA V1.3.0 stable release'],
  ];
  for (const [name, before, after] of identifiers) {
    const source = files.get(name).toString('utf8');
    const index = source.indexOf(before);
    assert.ok(index !== -1 && index === source.lastIndexOf(before), `Expected one release identifier in ${name}`);
    files.set(name, Buffer.from(source.replace(before, after)));
  }
  const candidate = JSON.parse(files.get('version.json').toString('utf8'));
  assert.equal(candidate.source_sha, businessSha, 'Unexpected RC1 business source SHA');
  files.set('version.json', Buffer.from(JSON.stringify({
    version: '1.3.0',
    channel: 'stable',
    source_sha: businessSha,
    released: '2026-11-23',
    notes: '保留五个宝宝业务页面和 PWA 更新机制。妈妈健康支持家庭双账号共享、孕前档案、孕期及产后体重、排便记录及统计、云端下拉与手动刷新、待确认保存核验及冲突处理。',
  }, null, 2) + '\n'));
  return files;
}

function inspectDirectory(files, check) {
  assert.ok(fs.lstatSync(releaseDir).isDirectory(), 'Expected release-candidate to be a directory');
  const found = new Set();
  for (const directory of ['', 'icons']) {
    const dir = path.join(output, directory);
    const stat = fs.lstatSync(dir, { throwIfNoEntry: false });
    if (!stat && !check) continue;
    assert.ok(stat?.isDirectory(), `Expected directory: ${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!directory && entry.name === 'icons' && entry.isDirectory()) continue;
      const name = path.posix.join(directory, entry.name);
      assert.ok(entry.isFile() && files.has(name), `Unexpected Stable entry: ${name}`);
      found.add(name);
      if (check) {
        assert.ok(fs.readFileSync(path.join(dir, entry.name)).equals(files.get(name)), `Stale Stable file: ${name}`);
      }
    }
  }
  if (check) {
    for (const name of files.keys()) assert.ok(found.has(name), `Missing Stable file: ${name}`);
    assert.equal(found.size, 20);
  }
}

const args = process.argv.slice(2);
assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--check'),
  'Usage: node scripts/build-pages-v130-final.cjs [--check]');
const check = args.length === 1;
const files = buildFiles();
inspectDirectory(files, check);
if (!check) {
  fs.mkdirSync(path.join(output, 'icons'), { recursive: true });
  for (const [name, bytes] of files) fs.writeFileSync(path.join(output, name), bytes);
  inspectDirectory(files, true);
}
console.log(`Pages 1.3.0 stable: ${check ? 'verified' : 'built and verified'} ${files.size} files`);
