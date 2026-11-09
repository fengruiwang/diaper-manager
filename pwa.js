/* PWA shell only. Never accesses/modifies the existing purchase/inventory data. */
(() => {
  'use strict';
  const byId = id => document.getElementById(id);
  const launch = byId('pwaLaunch');
  const installBtn = byId('installPwa');
  const installTip = byId('pwaInstallTip');
  const updateNotice = byId('pwaUpdateNotice');
  const updateBtn = byId('pwaUpdateNow');
  const migrationNotice = byId('pwaMigrationNotice');
  const importOldBtn = byId('pwaImportOld');
  const dismissBtn = byId('pwaMigrationDismiss');
  const localKey = 'xiaobao_diaper_planner_v1'; // Existing data format: DO NOT RENAME.
  const migrationDismissKey = 'xiaobao_pwa_migration_hint_dismissed_v1';
  let installPrompt = null;
  let registration = null;
  let updateInProgress = false;

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }
  function updateInstallButton() {
    if (isStandalone()) { launch.hidden = true; return; }
    launch.hidden = false;
    installTip.textContent = installPrompt ? '可直接安装到桌面' : '打开一次，日后可从桌面图标进入';
  }
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstallButton();
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installTip.textContent = '已安装到桌面';
    updateInstallButton();
  });
  installBtn.addEventListener('click', async () => {
    if (installPrompt) {
      const p = installPrompt;
      installPrompt = null;
      try { await p.prompt(); } catch (_) { /* Browser controls the install UI. */ }
      updateInstallButton();
      return;
    }
    const ua = navigator.userAgent || '';
    const ios = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (ios) {
      installTip.textContent = '请用 Safari 打开本网址 → 分享按钮 → 添加到主屏幕';
    } else {
      installTip.textContent = '请在 Chrome / Edge 浏览器菜单中选择「安装应用」或「添加到主屏幕」';
    }
  });
  updateInstallButton();

  try {
    if (!localStorage.getItem(localKey) && localStorage.getItem(migrationDismissKey) !== '1') {
      migrationNotice.hidden = false;
    }
  } catch (_) { /* Private mode can disallow storage. */ }
  importOldBtn.addEventListener('click', () => {
    byId('importFile').click(); // Reuse the app's existing validated JSON importer.
  });
  dismissBtn.addEventListener('click', () => {
    migrationNotice.hidden = true;
    try { localStorage.setItem(migrationDismissKey, '1'); } catch (_) { /* ignore */ }
  });
  byId('importFile').addEventListener('change', () => {
    migrationNotice.hidden = true;
  });

  function offerUpdate() {
    if (registration && registration.waiting && navigator.serviceWorker.controller) {
      updateNotice.hidden = false;
    }
  }
  updateBtn.addEventListener('click', () => {
    if (!registration || !registration.waiting || updateInProgress) return;
    if (!window.confirm('应用将重新打开。请先保存正在编辑的表单，已保存的库存和采购记录不会被清空。确定更新吗？')) return;
    updateInProgress = true;
    updateBtn.disabled = true;
    registration.waiting.postMessage({type:'SKIP_WAITING'});
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  let controlledOnce = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateInProgress && controlledOnce) window.location.reload();
    controlledOnce = true;
  });
  navigator.serviceWorker.register('./sw.js', {scope:'./'}).then(reg => {
    registration = reg;
    offerUpdate();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed') offerUpdate();
      });
    });
    // GitHub Pages may cache index.html. The service worker update is the source of truth.
    const check = () => {
      if (navigator.onLine !== false) reg.update().catch(() => {});
    };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check();
    });
    setInterval(check, 6 * 60 * 60 * 1000);
    // Check current version text for diagnostics only; do not force any destructive reset.
    fetch('./version.json', {cache:'no-store'}).catch(() => {});
  }).catch(() => {
    installTip.textContent = '网页可正常使用；当前浏览器未启用离线安装功能';
  });
})();
