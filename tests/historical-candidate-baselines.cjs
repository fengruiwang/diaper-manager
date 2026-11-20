/* Immutable rc.5/rc.6/rc.7/rc.8 test-only evidence. Git blob IDs below were read from
 * version.json.source_sha history and the frozen release-candidate Git trees.
 * Never compare old candidates against moving Feature sources. No network,
 * filesystem mutation, or runtime loading of their embedded modules.
 */
'use strict';
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const vm=require('node:vm');
const BASELINES=Object.freeze({
 rc5:Object.freeze({sourceSha:'95052656b463a33cfd74394e6acace87f67ec458'}),
 rc6:Object.freeze({sourceSha:'16a6a15d0d158b288e331c4b9d1d6abea72d42c3'}),
 rc7:Object.freeze({sourceSha:'1e575db0918fb14ed4839e7fa85798b9e42fdabf'}),
 rc8:Object.freeze({sourceSha:'fa2db3aa27d4c5f50b8fc310b6ca1a6b321dfc3e'})
});
const COMMON_FILES=Object.freeze({
  ".nojekyll": "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
  "growth.js": "4ba36e7f94e418626b853f5f378cd2f2effb68ba",
  "icons/apple-touch-icon.png": "4e7d1e7b5cc61987e2281f146fe120f91b2c7288",
  "icons/icon-192.png": "290e683e4c94363a22969eb8683233ec579c1212",
  "icons/icon-512.png": "bfb2d2810cea442dfd8f47ff9cfa14f3319eb52c",
  "icons/icon-maskable-512.png": "563f97da8564e2de578f37aff7373dde9cf20f20",
  "icons/icon.svg": "52d729514eb1c1e6d1d536af29a903bc2aec74c8",
  "m1-controller.js": "542d0a9a1b01b4ec44fde4a26b873835f66d0043",
  "manifest.webmanifest": "fe0d32821fe1bf6122b6c69697546b555d21ab89",
  "pwa.js": "20c739b2c8f4e91b8b0b7193f32de2cca6384e15"
});
const RC_FILES=Object.freeze({
  "rc5": {
    "formal-controller.js": "2e667a9c20d3577f4c96f32161c96e4d4b899de3",
    "index.html": "8737b54c3008d04de67d26aab5bc29f4abfd276b",
    "sw.js": "5c6bb74b2bfeb7e3442343a6259853fe5ea187f0",
    "version.json": "6e967ef26076d7649b53d5fe7c6fce9311a7b06e"
  },
  "rc6": {
    "formal-controller.js": "01cb240a014a33a824fc7a23c4ef141d2e5b0c9a",
    "index.html": "5b5baf62816007437dcc3f1ee561b8e545fa09d7",
    "sw.js": "46a58276d51fa4b051ea81afe99ca24999c5b890",
    "version.json": "f834e874923e7f0f3990f31747aa1a4493e9b503"
  },
  "rc7": {
    "formal-controller.js": "c959d4170b35396ddf1eb6f19898aa92a2af8382",
    "index.html": "427562a75ed548f2bfa996cd4d00c78b691e51cf",
    "sw.js": "606be1217f5703b53e6b574f75e80bf13424a200",
    "version.json": "121d6fd6ea8feb42e94e252eecc069649f2ea777"
  },
  "rc8": {
    "formal-controller.js": "05f90b4f8327c1ed6faa43ca9efcad149a8ca85e",
    "index.html": "96474c612a9f57cb9e6c44317aeaf45d0766a5ed",
    "sw.js": "6f1424ae995656ba280a62166786cd8d3c4d7145",
    "version.json": "40816d55f162c1d2b3db622bcca52ee856e85083"
  }
});
const MODULE_BLOBS=Object.freeze({
  "sync/primary-cloud-read-model.js": "1f621e88d3296c09068f3518052648188823aece",
  "sync/primary-cloud-operations.js": "e4f1f8ce3f45ee30f877cd9ffd7f431cb510fe57",
  "sync/primary-documents-client.js": "c0b85dbe9129935061e5033ec260697e88c0b8b2",
  "sync/primary-documents-operations.js": "adb39c8553893e08f040da17755b1c64bd05f3ee",
  "sync/primary-stocktake-batch-client.js": "4d66f48458886dd39a86017c02db7ec57284c77c",
  "sync/inventory-outbox-runner.js": "d24f1eb23077a83d449c5e60bc1d4ed2fddce68c",
  "sync/inventory-sync-reader.js": "7ccfc89a354b9d2af0bf5a16c3e4e8128ad65740"
});
const MODULE_MARKERS=Object.freeze({
  "sync/primary-cloud-read-model.js": "/* XiaoBao V1.2.0 M3 early integration: READ-ONLY view-model adapter for the",
  "sync/primary-cloud-operations.js": "/* M3 formal PRIMARY inventory/transaction bridge, using P2/P3 modules.",
  "sync/primary-documents-client.js": "/* M3 CloudBase primary document client: quotes/reference/growth/profile/settings.",
  "sync/primary-documents-operations.js": "/* M3 CAS document durable queue: SDK + existing P3 IndexedDB/outbox contract.",
  "sync/primary-stocktake-batch-client.js": "/* M3 multi-size stocktake: one PostgreSQL 027 RPC, durable batch ID,",
  "sync/inventory-outbox-runner.js": "/* XiaoBao P3: explicitly invoked, fail-closed inventory outbox replay.",
  "sync/inventory-sync-reader.js": "/* XiaoBao P3: explicit server-to-local inventory reconciliation coordinator.",
  "sync/primary-business-commands.js": "/* M3 original five-page inventory command adapter."
});
const BUSINESS_COMMAND_BLOBS=Object.freeze({
 rc5:'8636df11fc5ab7234d9dba571cffa78c67b25860',
 rc6:'95d9fe3c5d3b80291a7c937e75edebf5ac449da1',
 rc8:'95d9fe3c5d3b80291a7c937e75edebf5ac449da1'
});
// RC8 changed one embedded module since RC6. Keep RC5/RC6 historical hashes intact.
const RC8_MODULE_BLOBS=Object.freeze({
 'sync/primary-cloud-operations.js':'5d52a397b8e35115c880ecb1fc8bf0707960818e'
});

function gitBlobSha(bytes){
 const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 return createHash('sha1').update('blob '+buffer.length+'\0').update(buffer).digest('hex');
}
function checkPinnedResources(readCandidate,version){
 const baseline=BASELINES[version];
 assert.ok(baseline,'unknown frozen candidate '+version);
 const versions=JSON.parse(readCandidate('version.json').toString('utf8'));
 assert.equal(versions.source_sha,baseline.sourceSha,'historic source_sha drift');
 const expected={...COMMON_FILES,...RC_FILES[version]};
 for(const [filename,sha] of Object.entries(expected))
  assert.equal(gitBlobSha(readCandidate(filename)),sha,
   version+' frozen resource modified: '+filename);
 return Object.freeze({sourceSha:baseline.sourceSha,count:Object.keys(expected).length});
}
function historicEmbeddedModule(html,version,source){
 assert.ok(BASELINES[version],'unknown frozen candidate '+version);
 const marker=MODULE_MARKERS[source];
 assert.ok(marker,'unlisted historical module: '+source);
 const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  .map(match=>match[1]).filter(body=>body.includes(marker));
 assert.equal(scripts.length,1,version+' must embed exactly one '+source);
 let body=scripts[0].trim();
 if(source==='sync/inventory-outbox-runner.js'
   ||source==='sync/inventory-sync-reader.js'){
  const banner='/* Embedded for isolated deployment: '+source+' */';
  assert.ok(body.startsWith(banner),'unexpected embed wrapper: '+source);
  body=body.slice(banner.length).trim();
 }
 // Original reviewed module sources end with exactly one newline. Historic
 // script tags may add extra surrounding whitespace when bundling.
 const exactSource=body+'\n';
 const sha=source==='sync/primary-business-commands.js'
  ?BUSINESS_COMMAND_BLOBS[version]:version==='rc8'&&RC8_MODULE_BLOBS[source]
   ?RC8_MODULE_BLOBS[source]:MODULE_BLOBS[source];
 assert.equal(gitBlobSha(Buffer.from(exactSource)),sha,
  version+' embedded module differs from historical Git blob: '+source);
 // Structural syntax check never executes the historical module.
 assert.doesNotThrow(()=>new vm.Script(exactSource,{filename:version+'/'+source}));
 return exactSource;
}
module.exports=Object.freeze({BASELINES,checkPinnedResources,historicEmbeddedModule});
