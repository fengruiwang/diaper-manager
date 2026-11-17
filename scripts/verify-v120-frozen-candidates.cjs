/* Release snapshots rc2/rc3/rc4 remain immutable after candidate delivery.
 * New development sources intentionally diverge until the next candidate.
 * Verify their EXACT immutable Git blob SHA-1 rather than trying to rebuild
 * historical candidates from new development source (which would reuse versions).
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..');
const SNAPSHOTS={
  "rc2": {
    ".nojekyll": "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    "formal-controller.js": "80fa4fa9b64d08bd27252425fc42e51c66b7e588",
    "growth.js": "421fbdfa9314a10c9959c13b5cc12720c00138d5",
    "icons/apple-touch-icon.png": "4e7d1e7b5cc61987e2281f146fe120f91b2c7288",
    "icons/icon-192.png": "290e683e4c94363a22969eb8683233ec579c1212",
    "icons/icon-512.png": "bfb2d2810cea442dfd8f47ff9cfa14f3319eb52c",
    "icons/icon-maskable-512.png": "563f97da8564e2de578f37aff7373dde9cf20f20",
    "icons/icon.svg": "52d729514eb1c1e6d1d536af29a903bc2aec74c8",
    "index.html": "76c8421275c30dfa1a36bc2c7ac73bf06716baa8",
    "m1-controller.js": "542d0a9a1b01b4ec44fde4a26b873835f66d0043",
    "manifest.webmanifest": "fe0d32821fe1bf6122b6c69697546b555d21ab89",
    "pwa.js": "20c739b2c8f4e91b8b0b7193f32de2cca6384e15",
    "sw.js": "aca456980ea3cd094d88290dfd1dd2e8491b88c3",
    "version.json": "c1d446974496cb72cced02b11c4a26fea94eaf5d"
  },
  "rc3": {
    ".nojekyll": "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    "formal-controller.js": "3de47aa2222cbf06311e78d2bdc4b43cfc1a7bbe",
    "growth.js": "421fbdfa9314a10c9959c13b5cc12720c00138d5",
    "icons/apple-touch-icon.png": "4e7d1e7b5cc61987e2281f146fe120f91b2c7288",
    "icons/icon-192.png": "290e683e4c94363a22969eb8683233ec579c1212",
    "icons/icon-512.png": "bfb2d2810cea442dfd8f47ff9cfa14f3319eb52c",
    "icons/icon-maskable-512.png": "563f97da8564e2de578f37aff7373dde9cf20f20",
    "icons/icon.svg": "52d729514eb1c1e6d1d536af29a903bc2aec74c8",
    "index.html": "22e9a4524f9b80a0781f02dc46eca9fc3b112637",
    "m1-controller.js": "542d0a9a1b01b4ec44fde4a26b873835f66d0043",
    "manifest.webmanifest": "fe0d32821fe1bf6122b6c69697546b555d21ab89",
    "pwa.js": "20c739b2c8f4e91b8b0b7193f32de2cca6384e15",
    "sw.js": "b1498165e68ba842814f7317331131214bc482a5",
    "version.json": "6b4bd838f4cc576dd2dd0baeed232fafae97a03d"
  },
  "rc4": {
    ".nojekyll": "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    "formal-controller.js": "65856102fe96ed558393c7b273d12f8cb21ca9d1",
    "growth.js": "421fbdfa9314a10c9959c13b5cc12720c00138d5",
    "icons/apple-touch-icon.png": "4e7d1e7b5cc61987e2281f146fe120f91b2c7288",
    "icons/icon-192.png": "290e683e4c94363a22969eb8683233ec579c1212",
    "icons/icon-512.png": "bfb2d2810cea442dfd8f47ff9cfa14f3319eb52c",
    "icons/icon-maskable-512.png": "563f97da8564e2de578f37aff7373dde9cf20f20",
    "icons/icon.svg": "52d729514eb1c1e6d1d536af29a903bc2aec74c8",
    "index.html": "1f393dcc1b7f03ff68dc2f0479a534c4f24749b1",
    "m1-controller.js": "542d0a9a1b01b4ec44fde4a26b873835f66d0043",
    "manifest.webmanifest": "fe0d32821fe1bf6122b6c69697546b555d21ab89",
    "pwa.js": "20c739b2c8f4e91b8b0b7193f32de2cca6384e15",
    "sw.js": "3008be38d96159896d7d9bf86665f4ad54d0e507",
    "version.json": "83163c20e003fdf8c08695af219e50990a0ad1a6"
  }
};
function check(channel){
 const snapshot=SNAPSHOTS[channel];
 if(!snapshot)throw Error('unknown_frozen_candidate');
 const base=path.join(ROOT,channel==='rc2'?'release-candidate/pages-v1.2.0':
  channel==='rc3'?'release-candidate/pages-v1.2.0-rc3':
  'release-candidate/pages-v1.2.0-rc4');
 const seen=[];
 function walk(folder,rel=''){
  for(const entry of fs.readdirSync(folder,{withFileTypes:true})){
   const name=rel?rel+'/'+entry.name:entry.name;
   if(entry.isDirectory())walk(path.join(folder,entry.name),name);
   else seen.push(name);
  }
 }
 walk(base);
 const expected=Object.keys(snapshot);
 const assert=require('node:assert/strict');
 assert.deepEqual(seen.sort(),expected.sort(),'frozen candidate file set');
 for(const name of expected){
  const bytes=fs.readFileSync(path.join(base,name));
  const actual=crypto.createHash('sha1')
   .update('blob '+bytes.length+'\0').update(bytes).digest('hex');
  assert.equal(actual,snapshot[name],'frozen '+channel+' file changed: '+name);
 }
 console.log('FROZEN_CANDIDATE_SHA_PASS',channel,expected.length);
}
module.exports=Object.freeze({check});
