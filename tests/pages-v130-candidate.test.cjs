'use strict';

const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const candidatePath = 'release-candidate/pages-v1.3.0-rc1';
const output = path.join(root, candidatePath);
const builder = 'scripts/build-pages-v130-candidate.cjs';
const stableSha = 'cc908a037ecb754f3aa47bba7f94c87bff70e6b1';
const featureSha = '734e8730cf8f263fd210cd8917c898db98b1d88b';
const stableFiles = [
  '.nojekyll', 'm1-controller.js', 'growth.js', 'pwa.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png', 'icons/icon.svg',
];
const previewFiles = [
  ['outbox-contract.js', 'sync/outbox-contract.js'],
  ['idb-outbox.js', 'sync/idb-outbox.js'],
  ['maternal-health-client.js', 'sync/maternal-health-client.js'],
  ['maternal-health-operations.js', 'sync/maternal-health-operations.js'],
  ['maternal-weight.js', 'preview/v1.2.0/maternal-weight.js'],
  ['maternal-constipation.js', 'preview/v1.3.0/maternal-constipation.js'],
  ['formal-controller.js', 'preview/v1.3.0/formal-controller.js'],
];
const files = [...stableFiles, ...previewFiles.map(([name]) => name), 'index.html', 'sw.js', 'version.json'].sort();
const bytes = file => fs.readFileSync(path.join(output, file));
const read = file => bytes(file).toString('utf8');
const git = (...args) => execFileSync('git', args, { cwd: root });
const blob = (sha, file) => git('cat-file', 'blob', `${sha}:${file}`);
const html = read('index.html');
const markup = source => source.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
const inline = source => Array.from(source.matchAll(/<script>([\s\S]*?)<\/script>/g), match => match[1]);
const urls = (source, attribute) => Array.from(source.matchAll(
  new RegExp(`<(?:script|link)\\b[^>]*\\b${attribute}="([^"]+)"[^>]*>`, 'g'),
), match => match[1]);
const scripts = urls(html, 'src');
const links = urls(html, 'href');
const preview = blob(featureSha, 'preview/v1.3.0/formal/index.html').toString('utf8');
const stable = blob(stableSha, 'index.html').toString('utf8');

test('the committed package has exactly 20 files with the expected pinned sources', () => {
  const report = execFileSync(process.execPath, [builder, '--check'], { cwd: root, encoding: 'utf8' });
  assert.match(report, /verified 20 files/);
  assert.equal(files.length, 20);
  for (const file of stableFiles) assert.deepEqual(bytes(file), blob(stableSha, file), file);
  for (const [file, source] of previewFiles) assert.deepEqual(bytes(file), blob(featureSha, source), file);
  const { version, channel, source_sha, notes } = JSON.parse(read('version.json'));
  assert.deepEqual({ version, channel, source_sha }, { version: '1.3.0-rc.1', channel: 'candidate', source_sha: featureSha });
  assert.match(notes, /体重.*排便/);
  assert.ok(html.includes(`<meta name="xiaobao-pages-candidate-source" content="${featureSha}" />`));
});

test('an isolated rebuild is reproducible and check rejects drift without writing', t => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'xiaobao-rc1-'));
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
  const target = file => path.join(scratch, candidatePath, file);
  runOK();
  const before = fs.statSync(target('index.html')).mtimeMs;
  runOK('--check');
  assert.equal(fs.statSync(target('index.html')).mtimeMs, before);
  for (const file of files) assert.deepEqual(fs.readFileSync(target(file)), bytes(file), file);
  fs.writeFileSync(target('index.html'), 'synthetic drift');
  let result = run('--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Stale candidate file: index\.html/);
  assert.equal(fs.readFileSync(target('index.html'), 'utf8'), 'synthetic drift');
  runOK();
  const missing = target('m1-controller.js');
  fs.unlinkSync(missing);
  result = run('--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing candidate file: m1-controller\.js/);
  assert.equal(fs.existsSync(missing), false);
  runOK();
  fs.mkdirSync(target('icons/extra-directory'));
  result = run('--check');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unexpected candidate entry: icons\/extra-directory/);
  assert.ok(fs.statSync(target('icons/extra-directory')).isDirectory());
});

test('PWA identity and page controls match the V1.2.0 formal shell', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.deepEqual([manifest.id, manifest.start_url, manifest.scope, manifest.display], ['./', './', './', 'standalone']);
  const pwaRegions = /<link rel="(?:manifest|icon|apple-touch-icon)"[^>]*>|<meta name="apple-mobile-web-app-[^>]*>|<div class="pwa-launch"[\s\S]*?<\/div>|<div class="pwa-notice" id="pwaUpdateNotice" hidden>[\s\S]*?<\/div>|\/\* PWA install\/update layer[^\n]*\n[\s\S]*?@media print\{\.pwa-launch[^\n]*/g;
  const regions = markup(html).match(pwaRegions);
  assert.equal(regions.length, 9);
  assert.deepEqual(regions.sort(), markup(stable).match(pwaRegions).sort());
  assert.match(markup(html), /<button [^>]*id="installPwa"/);
  assert.match(markup(html), /<button [^>]*id="pwaUpdateNow"/);
  assert.doesNotMatch(markup(html), /noindex|nofollow/);
});

test('all six panels and inline logic match the reviewed preview with correct deferred dependencies', () => {
  const page = markup(html);
  const tabs = ['overview', 'compare', 'history', 'growth', 'settings', 'maternal-health'];
  assert.deepEqual(Array.from(page.matchAll(/<button class="tab(?: active)?"[^>]* data-tab="([^"]+)"/g), match => match[1]), tabs);
  assert.deepEqual(Array.from(page.matchAll(/<section class="panel(?: active)?" id="([^"]+)"/g), match => match[1]), tabs);
  const business = source => source.split('<script>')[0].split('  <nav class="tabs"')[1];
  assert.equal(business(html), business(preview));
  assert.deepEqual(inline(html), inline(preview));
  for (const script of inline(html)) new vm.Script(script);
  const ids = Array.from(page.matchAll(/\bid="([^"]+)"/g), match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [
    'maternalProfileJin', 'maternalWeightForm', 'maternalWeightPregnancy',
    'maternalWeightPostpartum', 'maternalWeightChart', 'maternalWeightRows',
    'maternalPullFeedback', 'maternalWeightRefresh', 'maternalWeightRecover',
    'maternalWeightArchive', 'maternalConstipationForm', 'maternalConstipationCount',
    'maternalConstipationDifficulty', 'maternalConstipationBloating',
    'maternalConstipationPain', 'maternalConstipationWater', 'maternalConstipationStreak',
    'maternalConstipationWeekTotal', 'maternalConstipationTrend', 'maternalConstipationHistory',
  ]) assert.ok(ids.includes(id), id);
  assert.match(page, /<button id="maternalWeightRefresh"[^>]*type="button"/);
  assert.match(page, /最近 30 天排便趋势/);
  const bristol = page.match(/<select id="maternalConstipationStoolType"[^>]*>(.*?)<\/select>/)[1];
  assert.deepEqual(Array.from(bristol.matchAll(/value="(\d)"/g), match => match[1]), [...'1234567']);
  const ordered = ['m1-controller.js', ...previewFiles.map(([name]) => name), 'pwa.js'];
  assert.deepEqual(scripts, ordered.map(name => `./${name}?v=1.3.0`));
  assert.deepEqual(html.match(/<script\b[^>]*\bsrc="[^"]+"[^>]*>/g),
    scripts.map(src => `<script src="${src}" defer>`));
  assert.doesNotMatch(html, /(?:src|href)="\.\.\/|preview\/v1\.[23]\.0/);
});

test('candidate controllers keep business gates and the shared family SQL 028 contract', () => {
  const window = { document: { readyState: 'loading', addEventListener() {} } };
  const sandbox = vm.createContext({ window, globalThis: window });
  for (const script of scripts.slice(0, -1)) {
    const file = script.slice(2).split('?')[0];
    vm.runInContext(read(file), sandbox, { filename: file });
  }
  for (const name of ['XBM1PreviewModule', 'XBOutboxContract', 'XBDurableOutbox', 'XBMaternalHealthClient',
    'XBMaternalHealthOperations', 'XBMaternalWeight', 'XBMaternalConstipation', 'XBFormalAppModule']) {
    assert.ok(window[name], name);
  }
  const gateNames = ['FORMAL_WRITE_ENABLED', 'FORMAL_DOCUMENT_WRITE_ENABLED', 'FORMAL_PURCHASE_ENABLED'];
  const stableController = blob(stableSha, 'formal-controller.js').toString('utf8');
  for (const name of gateNames) {
    assert.equal(window.XBFormalAppModule[name], true);
    assert.ok(stableController.includes(`const ${name}=true;`), name);
  }
  const formal = read('formal-controller.js');
  assert.match(formal, /XBMaternalWeight\.mount\(\{[\s\S]*?clientFactory:root\.XBMaternalHealthClient,operationsFactory:root\.XBMaternalHealthOperations,\s*cloudWritesEnabled:true,refreshBabyDates,constipationFactory:root\.XBMaternalConstipation\?\.mount/);
  assert.match(formal, /maternalPullFeedback[\s\S]*?addEventListener\('touchstart'[\s\S]*?addEventListener\('touchend'/);
  const weight = read('maternal-weight.js');
  assert.match(weight, /const constipation=constipationFactory\?\.\(\{[\s\S]*?getBody:\(\)=>scope&&current\(scope\)\?snapshot\?\.body:null,[\s\S]*?update\(snapshot\.body\)[\s\S]*?saveDocument\(started,nextBody/);
  assert.match(weight, /'maternalWeightRefresh'[\s\S]*?refreshButton\.addEventListener\('click',refreshCloudRecords\)/);
  const sql = blob(featureSha, 'cloudbase/sql/028_xb_maternal_health_DRAFT_DO_NOT_DEPLOY.sql').toString('utf8');
  const rpcNames = [...read('maternal-health-client.js').matchAll(/\brpc\([^,]+,'([^']+)'/g)].map(match => match[1]);
  assert.deepEqual(rpcNames, ['xb_read_maternal_health', 'xb_put_maternal_health', 'xb_check_maternal_health_request']);
  for (const name of rpcNames) {
    assert.match(sql, new RegExp(`CREATE FUNCTION public\\.${name}\\(\\s*p_family_id uuid`));
  }
  assert.match(sql, /CREATE TABLE public\.xb_maternal_health_documents\s*\(\s*family_id uuid PRIMARY KEY/i);
});

test('Service Worker precaches the app shell and only handles allowed GET requests', async () => {
  const origin = 'https://candidate.invalid';
  const scope = origin + '/diaper-manager/';
  const listeners = new Map();
  const deleted = [];
  const opened = [];
  let claimed = 0;
  let skipped = 0;
  let precache;
  const worker = read('sw.js');
  const stableWorker = blob(stableSha, 'sw.js').toString('utf8');
  // Scope, install/activation, and request handling stay byte-identical.
  const lifecycle = source => source.slice(source.indexOf('const SHELL_URLS'));
  assert.equal(lifecycle(worker), lifecycle(stableWorker));
  vm.runInNewContext(worker, {
    Request, URL,
    self: {
      registration: { scope }, location: { origin },
      addEventListener: (name, handler) => listeners.set(name, handler),
      clients: { claim: () => { claimed++; } },
      skipWaiting: () => { skipped++; },
    },
    caches: {
      open: async name => {
        opened.push(name);
        return {
          addAll: requests => { precache = Array.from(requests, req => req.url); },
          match: async key => key,
        };
      },
      keys: async () => ['xiaobao-shell-v1.2.0', 'xiaobao-shell-v1.3.0', 'unrelated-business-cache'],
      delete: async key => { deleted.push(key); },
    },
  });
  const dispatch = async name => {
    let completion;
    listeners.get(name)({ waitUntil: promise => { completion = promise; } });
    await completion;
  };
  await dispatch('install');
  assert.deepEqual(precache.sort(), files.filter(name => !['.nojekyll', 'sw.js', 'version.json'].includes(name))
    .map(name => scope + name).sort());
  assert.equal(skipped, 0);
  listeners.get('message')({ data: { type: 'OTHER' } });
  assert.equal(skipped, 0);
  listeners.get('message')({ data: { type: 'SKIP_WAITING' } });
  assert.equal(skipped, 1);
  await dispatch('activate');
  assert.deepEqual(deleted, ['xiaobao-shell-v1.2.0']);
  assert.equal(claimed, 1);
  function fetchRequest(url, method = 'GET', mode = 'cors') {
    let response;
    listeners.get('fetch')({ request: { url, method, mode }, respondWith: promise => { response = promise; } });
    return response;
  }
  assert.equal(await fetchRequest(scope, 'GET', 'navigate'), scope + 'index.html');
  assert.equal(await fetchRequest(scope + 'maternal-weight.js?v=1.3.0'), scope + 'maternal-weight.js');
  for (const url of [scope + 'version.json?fresh', scope + 'api/health', origin + '/other/index.html',
    'https://cloudbase.invalid/rpc/xb_read_maternal_health']) assert.equal(fetchRequest(url), undefined, url);
  assert.equal(fetchRequest(scope + 'api/health', 'GET', 'navigate'), undefined);
  assert.equal(fetchRequest(scope + 'index.html', 'POST'), undefined);
  assert.deepEqual([...new Set(opened)], ['xiaobao-shell-v1.3.0']);
  for (const source of [read('pwa.js'), worker]) {
    assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\s*(?:\.|\[)|\b(?:deleteDatabase|signOut)\s*\(/);
  }
});

test('existing PWA client confirms the waiting update and reloads on controllerchange', async () => {
  const workerListeners = new Map();
  const buttonListeners = new Map();
  const notice = { hidden: true };
  const messages = [];
  let confirmed = false;
  let reloaded = 0;
  const elements = {
    pwaLaunch: {}, pwaInstallTip: {}, pwaUpdateNotice: notice,
    pwaUpdateNow: { addEventListener: (type, fn) => buttonListeners.set(type, fn) },
  };
  const registration = {
    waiting: { postMessage: message => messages.push(message.type) },
    addEventListener() {},
  };
  const navigator = {
    serviceWorker: {
      controller: {},
      addEventListener: (type, fn) => workerListeners.set(type, fn),
      register: async (url, options) => {
        assert.equal(url, './sw.js');
        assert.equal(options.scope, './');
        return registration;
      },
    },
  };
  const window = {
    navigator, isSecureContext: true, matchMedia: () => ({ matches: true }),
    addEventListener() {},
    confirm: () => confirmed,
    location: { reload: () => { reloaded++; } },
  };
  vm.runInNewContext(read('pwa.js'), {
    window, navigator, document: { getElementById: id => elements[id], addEventListener() {} },
    fetch: async () => {}, setInterval() {},
  });
  await Promise.resolve();
  assert.equal(elements.pwaLaunch.hidden, true);
  assert.equal(notice.hidden, false);
  assert.deepEqual(messages, []);
  buttonListeners.get('click')();
  assert.deepEqual(messages, []);
  workerListeners.get('controllerchange')();
  assert.equal(reloaded, 0);
  confirmed = true;
  buttonListeners.get('click')();
  assert.deepEqual(messages, ['SKIP_WAITING']);
  assert.equal(elements.pwaUpdateNow.disabled, true);
  workerListeners.get('controllerchange')();
  assert.equal(reloaded, 1);
});

test('GitHub Pages-style subpath serves every nonempty file and URL reference over HTTP 200', async t => {
  const prefix = '/diaper-manager/';
  const allowed = new Set(files);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const name = pathname.slice(prefix.length) || 'index.html';
    if (!pathname.startsWith(prefix) || !allowed.has(name)) {
      res.writeHead(404).end();
      return;
    }
    res.end(bytes(name));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  const icons = JSON.parse(read('manifest.webmanifest')).icons.map(icon => icon.src);
  const references = new Set(['./', ...files.filter(file => bytes(file).length > 0), ...scripts, ...links, ...icons]);
  await Promise.all([...references].map(async reference => {
    const url = new URL(reference, base);
    assert.ok(url.href.startsWith(base), reference);
    const response = await fetch(url);
    assert.equal(response.status, 200, url.href);
    const name = url.pathname.slice(prefix.length) || 'index.html';
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes(name), name);
  }));
});
