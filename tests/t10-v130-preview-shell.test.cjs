'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const formal = require('../preview/v1.3.0/formal-controller.js');
const documentsOverlay = require('../sync/primary-documents-overlay.js');

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

test('V1.3.0 local preview adds maternal health to the five intact stable business panels', () => {
  const tabs = ['overview', 'compare', 'history', 'growth', 'settings', 'maternal-health'];
  const tags = markup(preview);
  assert.deepEqual(Array.from(tags.matchAll(/<button class="tab(?: active)?"[^>]* data-tab="([^"]+)"/g), m => m[1]), tabs);
  assert.deepEqual(Array.from(tags.matchAll(/<section class="panel(?: active)?" id="([^"]+)"/g), m => m[1]), tabs);
  for (const id of [
    'formalGate', 'formalOtp', 'formalConfirmOtp', 'kpiGrid', 'qBrand', 'saveQuote',
    'buyNow', 'historyList', 'saveStocks', 'growthChart', 'growthHistory', 'saveWeight',
    'saveProfile', 'savePlans', 'formalGetCloudLatest',
    'maternalWeightForm', 'maternalWeightChart', 'maternalWeightRows', 'maternalWeightSave',
    'maternalWeightRefresh', 'maternalWeightRecover', 'maternalWeightArchive', 'maternalHealthBack',
  ]) {
    assert.ok(tags.includes('id="' + id + '"'), 'Missing DOM ID ' + id);
  }
  const businessMarkup = html => markup(html).slice(markup(html).indexOf('<nav class="tabs"'));
  const stableBusiness = businessMarkup(preview)
    .replace(/^ .*data-tab="maternal-health".*\n/m, '')
    .replace(/^    <section class="panel" id="maternal-health"[\s\S]*?^    <\/section>\n/m, '');
  assert.equal(stableBusiness, businessMarkup(stableHtml));
  assert.match(tags, /<input type="date" id="dueDate"/);
  assert.match(tags, /<input type="date" id="birthDate"/);
  assert.match(tags, /<strong id="maternalProfileDue">/);
  assert.match(tags, /<strong id="maternalProfileDelivery">/);
  assert.doesNotMatch(tags, /<input[^>]*id="maternalProfile(?:Due|Delivery)"/);
  assert.match(tags, /id="formalOpenMaternalHealth"[^>]* hidden>/);
  assert.match(tags, /\.tabs\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(tags, /:has\([^)]*maternal/);
});

test('V1.3.0 loads existing sync and weight scripts before its write-enabled formal controller', () => {
  const pageUrl = new URL('/' + entry.replace(/index\.html$/, ''), 'http://localhost:8000');
  const files = [
    '/m1-controller.js', '/sync/outbox-contract.js', '/sync/idb-outbox.js',
    '/sync/maternal-health-client.js', '/sync/maternal-health-operations.js',
    '/preview/v1.2.0/maternal-weight.js', '/preview/v1.3.0/formal-controller.js',
  ];
  assert.deepEqual(externalScripts(preview).map(src => new URL(src, pageUrl).pathname), files);
  for (const file of files) {
    assert.doesNotThrow(() => new vm.Script(read(file.slice(1))));
  }
  const controller = read(files.at(-1).slice(1));
  assert.match(controller, /XBMaternalWeight\.mount\(\{[\s\S]*?clientFactory:root\.XBMaternalHealthClient,operationsFactory:root\.XBMaternalHealthOperations,\s*cloudWritesEnabled:true/);
  const browserHost = controller.match(/function uuidFromRandomValues[\s\S]*?(?=function browserStart)/)[0];
  const withUuid = vm.runInNewContext(browserHost + 'maternalBrowserHost');
  const oldChrome = { crypto: { getRandomValues: bytes => bytes.fill(0xab) } };
  assert.equal(withUuid(oldChrome).crypto.randomUUID(), 'abababab-abab-4bab-abab-abababababab');
  assert.equal(formal.FORMAL_WRITE_ENABLED, true);
  assert.equal(formal.FORMAL_DOCUMENT_WRITE_ENABLED, true);
  assert.equal(formal.FORMAL_PURCHASE_ENABLED, true);
});

test('V1.3.0 local preview excludes old preview resources, S140 fixtures and PWA entry points', () => {
  assert.doesNotMatch(preview, /preview\/v1\.2\.0|\bS140\b|\bnavigator\.serviceWorker(?:\?\.)?\.register/);
  assert.doesNotMatch(markup(preview), /rel="(?:manifest|icon|apple-touch-icon)"|id="(?:installPwa|pwaLaunch|pwaUpdateNotice)"/);
});

test('V1.3.0 keeps the original inline logic outside the navigation and maternal event integration', () => {
  const scripts = inlineScripts(stableHtml);
  const current = inlineScripts(preview);
  const withoutIntegration = script => script
    .replace(/const VALID_TABS[\s\S]*?(?=function restoreActiveTab)/, '')
    .replace(/\$\('maternalHealthBack'\)\.addEventListener[\s\S]*?\n\}\);\n/, '')
    .replace(/^ openMaternalHealth:[\s\S]*?(?=^ show:projection)/m, '')
    .replace("||doc.getElementById('maternal-health')?.contains?.(el)", '')
    .replace("||doc.getElementById('maternal-health')?.contains?.(event.target)", '')
    .replace(/   let requestId;\n   try\{requestId=uuid\(kind\);\}[\s\S]*?(?=   const saved=await queue.queue)/,
      '   const requestId=uuid();\n')
    .replace(/      :status==='PROFILE_REQUEST_ID_UNAVAILABLE'[^\n]*\n      :status==='DOCUMENT_LOCAL_QUEUE_UNVERIFIED_KEEP_REQUEST_ID'\n       \?[^\n]*\n/, '')
    .replace('宝宝资料保存结果待核验，原请求编号已保留，请勿重复提交。', '宝宝资料保存结果待核验，请勿重复提交');
  assert.deepEqual(current.map(withoutIntegration), scripts.map(withoutIntegration));
  for (const script of current) assert.doesNotThrow(() => new vm.Script(script));
  for (const file of ['index.html', 'formal-controller.js', 'm1-controller.js', 'pwa.js', 'sw.js', 'manifest.webmanifest', 'version.json']) {
    assert.equal(read(file), stable(file), file);
  }
});

test('V1.3.0 navigation allows the family-only panel and retains baby tabs for the ready state', () => {
  const dataset = { formalState: 'unverified' };
  const tabs = ['overview', 'maternal-health'].map(tab => ({
    dataset: { tab }, classList: { toggle() {} }, setAttribute() {},
  }));
  const panels = tabs.map(tab => ({
    id: tab.dataset.tab, classList: { toggle: (_name, active) => { tab.active = active; } },
  }));
  const events = [];
  const document = {
    body: { dataset },
    querySelectorAll: selector => selector === '.tab' ? tabs : panels,
    dispatchEvent: event => events.push(event.type),
  };
  const code = preview.match(/const VALID_TABS[\s\S]*?(?=function restoreActiveTab)/)[0];
  const { tab, selectTab } = vm.runInNewContext(code + '({tab,selectTab})', { document, Event });
  const open = name => tab(name, { scroll: false });
  selectTab('overview');
  open('maternal-health');
  assert.equal(tabs[0].active, true);
  assert.deepEqual(events, []);
  dataset.formalFamilyReady = 'true';
  open('maternal-health');
  open('overview');
  assert.equal(dataset.formalMaternalOnly, 'true');
  assert.equal(tabs[1].active, true);
  assert.deepEqual(events, ['maternal-health-open']);
  selectTab('overview');
  assert.equal(dataset.formalMaternalOnly, undefined);
  dataset.formalState = 'ready';
  open('maternal-health');
  open('overview');
  assert.equal(tabs[0].active, true);
  assert.equal(dataset.formalMaternalOnly, undefined);
});

test('V1.3.0 passes only verified family context and clears it across account changes and logout', async () => {
  const nodes = new Map();
  const doc = {
    body: { dataset: {} }, addEventListener() {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        hidden: true, dataset: {}, addEventListener(_event, callback) { this.click = callback; },
      });
      return nodes.get(id);
    },
  };
  const contexts = [];
  const cloud = {};
  let context = { app: cloud, actorUid: 'a', familyId: 'family-a' };
  let loginStatus = 'FORMAL_FAMILY_VERIFIED';
  let primaryStatus = 'PRIMARY_NOT_READY';
  let opens = 0;
  let resets = 0;
  const controller = {
    connect: async () => loginStatus,
    verifiedContext: () => context,
    signOut: async () => { context = null; return 'LOGIN_REQUIRED'; },
  };
  const app = formal.create({
    doc, host: { addEventListener() {}, navigator: { onLine: true } },
    loginController: { create: () => controller },
    readModelFactory: () => ({ read: async () => ({ status: primaryStatus, canWrite: false }) }),
    primaryFactory: () => ({}),
    commandsFactory: { create() {} }, actionsFactory: { create() {} },
    projection: { project() { assert.fail('Baby data is not ready'); } }, scriptLoader: async () => {},
    ui: {
      defaults() {}, show() { assert.fail('Baby data is not ready'); }, clear() {},
      openMaternalHealth() { opens++; }, resetNavigation() { resets++; },
    },
    maternalWeightFactory(auth) {
      assert.equal(auth, controller);
      return { setContext: current => contexts.push(current) };
    },
  });
  await app.start();
  const entryButton = nodes.get('formalOpenMaternalHealth');
  assert.equal(app.mode, 'unverified');
  assert.equal(entryButton.hidden, false);
  assert.equal(contexts.at(-1), context);
  await entryButton.click();
  assert.equal(opens, 1);

  context = { app: cloud, actorUid: 'b', familyId: 'family-b' };
  primaryStatus = 'MIGRATION_READ_NOT_READY';
  await app.restore();
  assert.deepEqual(contexts.slice(-2), [null, context]);
  assert.equal(resets, 1);
  assert.equal(entryButton.hidden, false);

  loginStatus = 'FAMILY_PERMISSION_DENIED';
  await app.restore();
  assert.equal(entryButton.hidden, true);
  assert.equal(doc.body.dataset.formalFamilyReady, undefined);
  assert.equal(contexts.at(-1), null);
  await entryButton.click();
  assert.equal(opens, 1);

  loginStatus = 'FORMAL_FAMILY_VERIFIED';
  await app.restore();
  await app.signOut();
  assert.equal(app.mode, 'login');
  assert.equal(entryButton.hidden, true);
  assert.equal(contexts.at(-1), null);
  assert.equal(resets, 3);
});

test('verified baby dates follow profile ACKs and a scoped profile-only refresh without rerendering Settings', async () => {
  const nodes = new Map(), dates = [];
  const doc = {
    body: { dataset: {} }, addEventListener() {},
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, { dataset: {}, addEventListener() {} });
      return nodes.get(id);
    },
  };
  const cloud = { auth: { getSession: async () => ({}) } };
  let ctx = { app: cloud, actorUid: 'a', familyId: 'family' };
  let childId = 'primary', profileRevision = 0, callbacks, refreshDates;
  let shows = 0, primaryReads = 0, selectedChild = childId;
  const reads = [];
  let profile = { babyProfile: {}, dueDate: '2026-01-01', birthDate: '' };
  const kinds = ['reference', 'quotes', 'growth', 'profile', 'settings'];
  const document = kind => ({
    status: 'PRIMARY_DOCUMENT_READ_VERIFIED', kind, familyId: ctx.familyId, childId,
    revision: kind === 'profile' ? profileRevision : 0,
    body: { reference: { referenceOverrides: {} }, quotes: { items: [] },
      growth: { items: [] }, profile, settings: { target: {}, daily: {} } }[kind],
  });
  let readDocument = async kind => document(kind);
  const app = formal.create({
    doc, host: { addEventListener() {}, navigator: { onLine: true } },
    loginController: { create: () => ({
      connect: async () => 'FORMAL_FAMILY_VERIFIED', verifiedContext: () => ctx,
    }) },
    readModelFactory: () => ({ read: async () => {
      primaryReads++;
      return childId ? {
        status: 'PRIMARY_READ_ONLY_READY', source: 'cloudbase-primary-receipt-verified',
        canWrite: false, actorUid: ctx.actorUid, familyId: ctx.familyId, childId,
        inventory: {}, revisions: {},
      } : { status: 'PRIMARY_NOT_READY' };
    } }),
    projection: { project: read => ({
      ...read, state: { inventory: {}, transactions: [], dueDate: '2025-01-01', birthDate: '2025-01-02' },
    }) },
    primaryFactory: () => ({
      activate: async () => ({ status: 'PRIMARY_OUTBOX_READ_ONLY_READY' }),
      selectedScope: () => ({ ...ctx, childId: selectedChild }),
    }),
    commandsFactory: { create: () => ({}) },
    actionsFactory: { create(config) {
      callbacks = config;
      return { attach: () => ({ detach() {} }) };
    } },
    documentsFactory: () => ({
      readAll: async () => ({ status: 'PRIMARY_DOCUMENTS_FULLY_READ',
        documents: Object.fromEntries(kinds.map(kind => [kind, document(kind)])) }),
      read: async request => { reads.push(request); return readDocument(request.kind); },
    }),
    documentsOverlay,
    ui: { defaults: () => ({}), show() { shows++; }, clear() {} },
    scriptLoader: async () => {},
    maternalWeightFactory: (_controller, refresh) => {
      refreshDates = refresh;
      return {
        setContext(current) { if (!current) dates.push(null); },
        setBabyDates: value => dates.push(value),
      };
    },
  });
  await app.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.mode, 'ready');
  assert.deepEqual(dates.filter(Boolean), [{ dueDate: '2026-01-01', birthDate: '' }]);

  async function ack(change) {
    const expectedRevision = profileRevision++;
    profile = { ...profile, ...change };
    return callbacks.onProfileAck({
      kind: 'profile', actorUid: ctx.actorUid, familyId: ctx.familyId, childId,
      requestId: 'synthetic-ack-' + profileRevision, expectedRevision, revision: profileRevision,
      record: change, nextBody: profile,
    });
  }
  assert.equal(await ack({ dueDate: '2026-01-03' }), 'ready');
  assert.deepEqual(dates.at(-1), { dueDate: '2026-01-03', birthDate: '' });
  assert.equal(await ack({ birthDate: '2026-01-02' }), 'ready');
  assert.deepEqual(dates.at(-1), { dueDate: '2026-01-03', birthDate: '2026-01-02' });

  ctx = { ...ctx, actorUid: 'b' };
  const previousDateCount = dates.length;
  await app.restore({ requireComplete: true });
  assert.equal(dates[previousDateCount], null);
  assert.deepEqual(dates.at(-1), { dueDate: '2026-01-03', birthDate: '2026-01-02' });

  let finishRead;
  const oldProfile = document('profile');
  readDocument = () => new Promise(resolve => { finishRead = resolve; });
  const olderRefresh = refreshDates(ctx);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await ack({ dueDate: '2026-01-04' }), 'ready');
  finishRead(oldProfile);
  assert.equal(await olderRefresh, false);
  assert.deepEqual(dates.at(-1), { dueDate: '2026-01-04', birthDate: '2026-01-02' });

  // Another device saved the profile. Only this profile is read on B;
  // the other tabs still retain their rendered Settings revision.
  profile = { ...profile, dueDate: '2026-01-05', birthDate: '' };
  profileRevision++;
  readDocument = async kind => document(kind);
  const previousShows = shows, previousPrimaryReads = primaryReads, previousReads = reads.length;
  assert.equal(await refreshDates(ctx), true);
  assert.deepEqual(reads.slice(previousReads), [{
    kind: 'profile', actorUid: 'b', familyId: 'family', readEnabled: true,
  }]);
  assert.deepEqual(dates.at(-1), { dueDate: '2026-01-05', birthDate: '' });
  profile = { ...profile, birthDate: '2026-01-03' };
  profileRevision++;
  assert.equal(await refreshDates(ctx), true);
  assert.deepEqual(dates.at(-1), { dueDate: '2026-01-05', birthDate: '2026-01-03' });
  assert.equal(shows, previousShows);
  assert.equal(primaryReads, previousPrimaryReads);
  assert.equal(callbacks.readProfileBaseline().revision, profileRevision - 2);

  const unchangedCount = dates.length;
  for (const bad of [
    { status: 'PRIMARY_DOCUMENT_READ_UNVERIFIED' },
    { ...document('profile'), actorUid: 'wrong-actor' },
    { ...document('profile'), childId: 'wrong-child' },
    { ...document('profile'), body: { dueDate: '2026-01-01' } },
  ]) {
    readDocument = async () => bad;
    assert.equal(await refreshDates(ctx), false);
  }
  assert.equal(dates.length, unchangedCount);

  for (const change of [{ actorUid: 'c' }, { familyId: 'elsewhere' }, { childId: 'new-baby' }]) {
    const before = ctx, childBefore = selectedChild, response = document('profile');
    readDocument = () => new Promise(resolve => { finishRead = resolve; });
    const request = refreshDates(ctx);
    await new Promise(resolve => setImmediate(resolve));
    if (change.childId) selectedChild = change.childId;
    else ctx = { ...ctx, ...change };
    finishRead(response);
    assert.equal(await request, false);
    assert.equal(dates.length, unchangedCount);
    ctx = before; selectedChild = childBefore;
  }

  childId = '';
  await app.restore();
  assert.equal(app.mode, 'unverified');
  assert.equal(dates.at(-1), null);
  assert.equal(doc.body.dataset.formalFamilyReady, 'true');
});
