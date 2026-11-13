XiaoBao V1.2.0 P0 CloudBase static hosting upload package
Source Feature HEAD: 66cc98c378b80be585d7c8d71f0513dc78e39d57
Upload destination (path inside existing Tencent CloudBase static hosting):
/xb-test/formal/
Files to upload together, directly within this directory:
- index.html
- m1-controller.js
- formal-controller.js

This is a TEST-ONLY deployment, not production, not a database migration.
Same CloudBase ENV_ID and existing publishable anon key as the reviewed Feature.
No GitHub Pages or Cloudflare settings, and no SQL, 022/023, or real writes.
FORMAL_WRITE_ENABLED remains false.

After upload: open your EXISTING Tencent CloudBase testing host and path
  https://<your existing CloudBase static hosting host>/xb-test/formal/?p0=66cc98c
Do not substitute a different hostname.

Press F12 > Console and run:
  console.log("P0_SOURCE",document.querySelector('meta[name="xiaobao-p0-source-sha"]')?.content);
  console.table([...document.scripts].filter(s=>s.src).map(s=>({src:s.src})));
Expected meta SHA: 66cc98c378b80be585d7c8d71f0513dc78e39d57
Expected JS paths: /xb-test/formal/m1-controller.js?v=66cc98c and /xb-test/formal/formal-controller.js?v=66cc98c
With Network > Disable cache enabled, Ctrl+Shift+R once and verify both JS return HTTP 200.

Manual real browser acceptance still REQUIRED: OTP, login, five pages, refresh,
5-10 tab switches, spouse's separate browser session; do not call P0 PASS without it.
Keep V1.1.2 stopped and all formal business writes disabled.
