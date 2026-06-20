// ==UserScript==
// @name         Tampermonkey
// @namespace    https://www.tampermonkey.net/
// @version      1.0.0
// @description  改善篡改猴管理界面的屏幕阅读器、键盘、焦点、触控与脚本删除体验。
// @match        https://tampermonkey.net/*
// @match        https://*.tampermonkey.net/*
// @match        https://tmnk.net/*
// @match        https://*.tmnk.net/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.TampermonkeyDashboardA11y = api;
  if (api.isSupportedDashboard(root.document, root.location)) {
    api.enhanceDashboard(root.document, root);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createModule() {
  'use strict';

  const ROW_SELECTOR = '.scripttr, .script-row, .script_row, [data-script-name]';
  const NAME_SELECTOR = '.script_name, .script-name, .script_name_text, [data-script-name]';
  const CONTROL_SELECTOR = 'button, a, input, select, textarea, [role="button"], [onclick], .clickable';
  const DELETE_SELECTOR = [
    '.script-delete', '.script_delete', '.delete', '.trash', '[data-action="delete"]',
    '[title*="Delete" i]', '[title*="Remove" i]', '[title*="删除"]', '[aria-label*="删除"]',
    'img[src*="delete" i]', 'img[src*="trash" i]',
  ].join(',');

  const LABEL_RULES = [
    { pattern: /delete|remove|trash|删除|移除/i, label: '删除脚本' },
    { pattern: /edit|pencil|编辑|修改/i, label: '编辑脚本' },
    { pattern: /update|refresh|更新|刷新/i, label: '检查更新' },
    { pattern: /enable|enabled|greenled|启用/i, label: '启用脚本' },
    { pattern: /disable|disabled|redled|停用|禁用/i, label: '停用脚本' },
    { pattern: /home|homepage|主页/i, label: '打开脚本主页' },
    { pattern: /close|关闭/i, label: '关闭' },
    { pattern: /save|保存/i, label: '保存' },
    { pattern: /cancel|取消/i, label: '取消' },
    { pattern: /confirm|ok|确定|确认/i, label: '确认' },
  ];

  function isSupportedDashboard(document, location) {
    if (!document || !location) return false;
    const host = String(location.hostname || '').toLowerCase();
    const trustedHost = host === 'tampermonkey.net' || host.endsWith('.tampermonkey.net') ||
      host === 'tmnk.net' || host.endsWith('.tmnk.net');
    if (!trustedHost) return false;
    const path = String(location.pathname || '').toLowerCase();
    return /options|dashboard|settings|extension/.test(path) ||
      Boolean(document.querySelector('#dashboard, #options, .main_container, .scripttr, .script-row'));
  }

  function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getControlSignature(element) {
    const image = element.matches?.('img') ? element : element.querySelector?.('img');
    return [
      element.getAttribute?.('aria-label'), element.getAttribute?.('title'),
      element.getAttribute?.('alt'), element.getAttribute?.('data-action'),
      element.id, element.className, element.textContent,
      image?.getAttribute('src'), image?.getAttribute('alt'), image?.getAttribute('title'),
    ].map(cleanText).join(' ');
  }

  function inferControlLabel(element) {
    const existing = cleanText(element.getAttribute('aria-label'));
    if (existing) return existing;
    const visible = cleanText(element.textContent);
    if (visible) return visible;
    const signature = getControlSignature(element);
    return LABEL_RULES.find(rule => rule.pattern.test(signature))?.label || '';
  }

  function enhanceControl(element) {
    if (!(element instanceof element.ownerDocument.defaultView.Element)) return;
    const label = inferControlLabel(element);
    if (label) element.setAttribute('aria-label', label);
    if (!/^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(element.tagName)) {
      if (!element.hasAttribute('role')) element.setAttribute('role', 'button');
      if (!element.hasAttribute('tabindex')) element.setAttribute('tabindex', '0');
      if (!element.dataset.tmA11yKeyboard) {
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            element.click();
          }
        });
        element.dataset.tmA11yKeyboard = 'true';
      }
    }
    element.classList.add('tm-a11y-target');
  }

  function scriptName(row) {
    const nameNode = row.querySelector(NAME_SELECTOR);
    return cleanText(nameNode?.getAttribute('data-script-name') || nameNode?.textContent || row.getAttribute('data-script-name')) || '未命名脚本';
  }

  function findOriginalDelete(row) {
    const candidates = [...row.querySelectorAll(DELETE_SELECTOR)];
    return candidates.find(candidate => !candidate.classList.contains('tm-a11y-delete')) || null;
  }

  function enhanceRow(row, announce) {
    const name = scriptName(row);
    row.setAttribute('role', row.tagName === 'TR' ? 'row' : 'group');
    row.setAttribute('aria-label', `脚本：${name}`);
    row.classList.add('tm-a11y-script-row');

    const originalDelete = findOriginalDelete(row);
    if (originalDelete && !row.querySelector('.tm-a11y-delete')) {
      const button = row.ownerDocument.createElement('button');
      button.type = 'button';
      button.className = 'tm-a11y-delete tm-a11y-target';
      button.textContent = '删除';
      button.setAttribute('aria-label', `删除脚本“${name}”`);
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        announce(`准备删除脚本“${name}”`);
        originalDelete.click();
      });
      const cell = row.tagName === 'TR' ? row.lastElementChild : row;
      cell?.appendChild(button);
    }
  }

  function enhanceDialog(dialog) {
    if (dialog.dataset.tmA11yDialog === 'true') return;
    dialog.dataset.tmA11yDialog = 'true';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    const heading = dialog.querySelector('h1, h2, h3, .title, .dialog-title, .modal-title');
    const label = cleanText(heading?.textContent) || '对话框';
    dialog.setAttribute('aria-label', label);
    dialog.querySelectorAll(CONTROL_SELECTOR).forEach(enhanceControl);
    const primary = dialog.querySelector('.primary, .confirm, [data-action="confirm"], button[type="submit"]');
    const fallback = dialog.querySelector('button, [role="button"], a');
    (primary || fallback)?.focus();
  }

  function installStyles(document) {
    if (document.querySelector('#tm-a11y-styles')) return;
    const style = document.createElement('style');
    style.id = 'tm-a11y-styles';
    style.textContent = `
      .tm-a11y-skip { position: fixed; z-index: 2147483647; top: 8px; left: 8px; padding: 12px 16px;
        background: #fff; color: #000; border: 3px solid #005fcc; border-radius: 6px; transform: translateY(-160%); }
      .tm-a11y-skip:focus { transform: translateY(0); }
      #tm-a11y-toolbar { position: sticky; z-index: 99999; top: 0; display: flex; flex-wrap: wrap; gap: 10px;
        align-items: center; padding: 12px; background: Canvas; color: CanvasText; border: 2px solid currentColor; }
      #tm-a11y-toolbar label { font-weight: 700; }
      #tm-a11y-search { min-height: 44px; min-width: min(22rem, 70vw); padding: 8px 12px; font-size: 16px; }
      .tm-a11y-target { min-width: 44px !important; min-height: 44px !important; box-sizing: border-box !important; }
      .tm-a11y-delete { margin: 4px !important; padding: 8px 12px !important; color: #fff !important;
        background: #9b1c1c !important; border: 2px solid #5f0000 !important; border-radius: 5px !important; }
      .tm-a11y-target:focus-visible, #tm-a11y-search:focus-visible, .tm-a11y-script-row:focus-within {
        outline: 4px solid #ffbf47 !important; outline-offset: 3px !important; }
      .tm-a11y-script-row[hidden] { display: none !important; }
      @media (max-width: 700px) {
        .tm-a11y-script-row { display: block !important; padding: 10px !important; border-bottom: 2px solid currentColor !important; }
        .tm-a11y-script-row > td { display: inline-flex !important; align-items: center; min-height: 44px; padding: 4px !important; }
        #tm-a11y-toolbar { position: relative; }
      }
      @media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; animation: none !important; } }
      @media (forced-colors: active) { .tm-a11y-delete { forced-color-adjust: auto; } }
    `;
    document.head.appendChild(style);
  }

  function installToolbar(document, window, rows, announce) {
    if (document.querySelector('#tm-a11y-toolbar')) return;
    const main = document.querySelector('main, #dashboard, #options, .main_container') || document.body;
    if (!main.id) main.id = 'tm-a11y-main';
    main.setAttribute('role', 'main');

    const skip = document.createElement('a');
    skip.className = 'tm-a11y-skip';
    skip.href = `#${main.id}`;
    skip.textContent = '跳到主要内容';
    document.body.prepend(skip);

    const toolbar = document.createElement('section');
    toolbar.id = 'tm-a11y-toolbar';
    toolbar.setAttribute('role', 'search');
    toolbar.setAttribute('aria-label', '脚本管理辅助工具');
    toolbar.innerHTML = `
      <label for="tm-a11y-search">搜索脚本</label>
      <input id="tm-a11y-search" type="search" autocomplete="off" placeholder="输入脚本名称，按 / 可快速定位">
      <button id="tm-a11y-clear" type="button" class="tm-a11y-target">清除搜索</button>
      <span id="tm-a11y-status" role="status" aria-live="polite"></span>
    `;
    main.prepend(toolbar);

    const search = toolbar.querySelector('#tm-a11y-search');
    const status = toolbar.querySelector('#tm-a11y-status');
    const filter = () => {
      const query = cleanText(search.value).toLocaleLowerCase('zh-CN');
      const currentRows = rows();
      let visible = 0;
      currentRows.forEach(row => {
        const matches = !query || scriptName(row).toLocaleLowerCase('zh-CN').includes(query);
        row.hidden = !matches;
        if (matches) visible++;
      });
      status.textContent = `显示 ${visible} 个脚本，共 ${currentRows.length} 个`;
    };
    search.addEventListener('input', filter);
    toolbar.querySelector('#tm-a11y-clear').addEventListener('click', () => {
      search.value = '';
      filter();
      search.focus();
    });
    document.addEventListener('keydown', event => {
      if (event.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) {
        event.preventDefault();
        search.focus();
      }
      if (event.altKey && event.key.toLowerCase() === 'm') {
        event.preventDefault();
        main.setAttribute('tabindex', '-1');
        main.focus();
      }
    });
    filter();
    announce('无障碍增强已启用');
  }

  function enhanceDashboard(document, window) {
    installStyles(document);
    let live = document.querySelector('#tm-a11y-live');
    if (!live) {
      live = document.createElement('div');
      live.id = 'tm-a11y-live';
      live.setAttribute('role', 'status');
      live.setAttribute('aria-live', 'assertive');
      live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
      document.body.appendChild(live);
    }
    const announce = message => { live.textContent = ''; window.setTimeout(() => { live.textContent = message; }, 0); };
    const rows = () => [...document.querySelectorAll(ROW_SELECTOR)];

    const scan = root => {
      if (root.matches?.(CONTROL_SELECTOR)) enhanceControl(root);
      root.querySelectorAll?.(CONTROL_SELECTOR).forEach(enhanceControl);
      if (root.matches?.(ROW_SELECTOR)) enhanceRow(root, announce);
      root.querySelectorAll?.(ROW_SELECTOR).forEach(row => enhanceRow(row, announce));
      if (root.matches?.('[role="dialog"], .dialog, .modal, .modal-dialog')) enhanceDialog(root);
      root.querySelectorAll?.('[role="dialog"], .dialog, .modal, .modal-dialog').forEach(enhanceDialog);
    };

    scan(document.body);
    installToolbar(document, window, rows, announce);
    const observer = new window.MutationObserver(records => {
      records.forEach(record => record.addedNodes.forEach(node => {
        if (node.nodeType === 1) scan(node);
      }));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return { disconnect: () => observer.disconnect(), rescan: () => scan(document.body) };
  }

  return { enhanceDashboard, inferControlLabel, isSupportedDashboard };
});
