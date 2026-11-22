'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const rc1Dir = 'release-candidate/pages-v1.3.0-rc1';
const stableDir = 'release-candidate/pages-v1.3.0-final';
const builder = 'scripts/build-pages-v130-final.cjs';
const rc1Sha = '0c63dfa682f3df2de07b2315af18b108b8ebeccf';
const businessSha = '734e8730cf8f263fd210cd8917c898db98b1d88b';
const git = (...args) => execFileSync('git', args, { cwd: root });
const pinned = name => git('cat-file', 'blob', `${rc1Sha}:${rc1Dir}/${name}`);
const read = name => fs.readFileSync(path.join(root, stableDir, name));
const html = read('index.html').toString('utf8');
const files = [
  '.nojekyll', 'formal-controller.js', 'growth.js', 'idb-outbox.js', 'index.html', 'm1-controller.js',
  'manifest.webmanifest', 'maternal-constipation.js', 'maternal-health-client.js',
  'maternal-health-operations.js', 'maternal-weight.js', 'outbox-contract.js', 'pwa.js', 'sw.js', 'version.json',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/icon.svg',
];
const changes = {
  'index.html': ['<title>小宝管家 V1.3.0 · 家庭云端管理</title>', '<title>小宝管家 V1.3.0 RC1 · 家庭云端管理</title>'],
  'formal-controller.js': ['/* Standalone V1.3.0 stable full-write release.', '/* Standalone V1.2.0 stable full-write release.'],
  'pwa.js': ['/* V1.3.0 stable PWA shell.', '/* V1.2.0 candidate PWA shell.'],
  'sw.js': ['/* 小宝纸尿裤管家 PWA V1.3.0 stable release', '/* 小宝纸尿裤管家 PWA V1.3.0 RC1'],
};

test('Stable contains exactly the 20 RC1 assets with only the approved release labels changed', () => {
  for (const dir of [stableDir, rc1Dir]) {
    const actual = fs.readdirSync(path.join(root, dir), { recursive: true }).map(name => name.replaceAll(path.sep, '/'));
    assert.deepEqual(actual.sort(), [...files, 'icons'].sort(), dir);
  }
  for (const name of files) {
    const original = pinned(name);
    assert.deepEqual(fs.readFileSync(path.join(root, rc1Dir, name)), original, `Modified RC1 file: ${name}`);
    if (name === 'version.json') continue;
    const stable = read(name);
    if (!changes[name]) {
      assert.deepEqual(stable, original, name);
      continue;
    }
    const [label, rc1Label] = changes[name];
    assert.ok(stable.includes(label), name);
    assert.ok(Buffer.from(stable.toString('utf8').replace(label, rc1Label)).equals(original), `Unexpected change: ${name}`);
  }
});

test('the isolated build is repeatable and --check only reads its output', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaobao-v130-final-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  fs.mkdirSync(path.join(scratch, 'scripts'));
  fs.mkdirSync(path.join(scratch, 'release-candidate'));
  fs.copyFileSync(path.join(root, builder), path.join(scratch, builder));
  const env = { ...process.env, GIT_DIR: git('rev-parse', '--absolute-git-dir').toString().trim() };
  const run = (...args) => spawnSync(process.execPath, [builder, ...args], { cwd: scratch, env, encoding: 'utf8' });
  const runOK = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.error?.message ?? result.stderr);
  };
  const target = name => path.join(scratch, stableDir, name);
  const verifyFiles = () => {
    for (const name of files) assert.deepEqual(fs.readFileSync(target(name)), read(name), name);
  };
  runOK();
  verifyFiles();
  runOK();
  verifyFiles();
  const times = () => ['', 'icons', ...files].map(name => fs.statSync(target(name), { bigint: true }).mtimeNs);
  const beforeCheck = times();
  runOK('--check');
  assert.deepEqual(times(), beforeCheck);
  fs.writeFileSync(target('version.json'), 'synthetic drift');
  const stale = run('--check');
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /Stale Stable file: version\.json/);
  assert.equal(fs.readFileSync(target('version.json'), 'utf8'), 'synthetic drift');
  runOK();
  fs.writeFileSync(target('icons/extra.txt'), 'synthetic extra');
  const extra = run('--check');
  assert.equal(extra.status, 1);
  assert.match(extra.stderr, /Unexpected Stable entry: icons\/extra\.txt/);
  assert.equal(fs.readFileSync(target('icons/extra.txt'), 'utf8'), 'synthetic extra');
});

test('Stable preserves the PWA identity, cache key, auth compatibility key and source metadata', () => {
  const { version, channel, source_sha, released, notes } = JSON.parse(read('version.json'));
  assert.deepEqual({ version, channel, source_sha, released }, {
    version: '1.3.0', channel: 'stable', source_sha: businessSha, released: '2026-11-23',
  });
  for (const topic of ['五个宝宝业务页面', 'PWA 更新机制', '家庭双账号共享', '孕前档案', '体重', '排便记录及统计', '刷新', '保存核验']) {
    assert.ok(notes.includes(topic), topic);
  }
  assert.equal(html.match(/<title>([^<]+)<\/title>/)[1], '小宝管家 V1.3.0 · 家庭云端管理');
  assert.ok(html.includes(`<meta name="xiaobao-pages-candidate-source" content="${businessSha}" />`));
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.deepEqual([manifest.id, manifest.start_url, manifest.scope, manifest.display], ['./', './', './', 'standalone']);
  assert.match(read('sw.js').toString('utf8'), /const CACHE_NAME = 'xiaobao-shell-v1\.3\.0';/);
  assert.match(read('formal-controller.js').toString('utf8'), /const OTP_STORAGE_KEY='xiaobao_v120_formal_otp_resend_until';/);
  for (const name of files.filter(file => !file.endsWith('.png'))) {
    assert.doesNotMatch(read(name).toString('utf8'), /\/xb-test\//i, name);
  }
});

test('every asset and HTML, manifest, and Service Worker reference serves HTTP 200 at the root and project subpath', async t => {
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map(match => match[1]);
  assert.equal(scripts.length, 9);
  for (const src of scripts) {
    assert.match(src, /^\.\/[\w-]+\.js\?v=1\.3\.0$/);
    assert.ok(files.includes(src.slice(2).split('?')[0]), src);
  }
  const links = [...html.matchAll(/<link\b[^>]*\bhref="([^"]+)"/g)].map(match => match[1]);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  const shell = read('sw.js').toString('utf8').match(/const SHELL = \[([^\]]+)\];/)[1];
  const cached = [...shell.matchAll(/'([^']+)'/g)].map(match => match[1]);
  const refs = new Set([
    ...files, './', './sw.js', './version.json', ...scripts, ...links,
    manifest.start_url, ...manifest.icons.map(icon => icon.src), ...cached,
  ]);
  const prefixes = ['/', '/diaper-manager/'];
  const allowed = new Set(files);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const prefix = pathname.startsWith(prefixes[1]) ? prefixes[1] : prefixes[0];
    const name = pathname.slice(prefix.length) || 'index.html';
    if (!allowed.has(name)) {
      res.writeHead(404).end();
      return;
    }
    fs.createReadStream(path.join(root, stableDir, name)).pipe(res);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  for (const prefix of prefixes) {
    const base = `http://127.0.0.1:${server.address().port}${prefix}`;
    await Promise.all([...refs].map(async ref => {
      const url = new URL(ref, base);
      assert.ok(url.href.startsWith(base), ref);
      const response = await fetch(url);
      assert.equal(response.status, 200, url.href);
      const name = url.pathname.slice(prefix.length) || 'index.html';
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), read(name), name);
    }));
  }
});
