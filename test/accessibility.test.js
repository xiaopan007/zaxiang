const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const scriptPath = join(__dirname, '..', 'sub-store.user.js');
const source = () => readFileSync(scriptPath, 'utf8');

function createPage(html) {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    url: 'https://example.invalid/subs?api=SECRET-MUST-NOT-BE-READ'
  });
  dom.window.eval(source());
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return dom;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

test('metadata matches arbitrary HTTP and HTTPS domains without privileged grants', () => {
  const source = readFileSync(scriptPath, 'utf8');
  const metadata = source.match(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==/m)?.[0] || '';
  assert.match(source, /^\/\/ @name\s+Sub-Store\s*$/m);
  assert.match(source, /^\/\/ @namespace\s+sub-store-universal-a11y\s*$/m);
  assert.match(source, /^\/\/ @version\s+1\.0\.27\s*$/m);
  assert.match(source, /^\/\/ @name:zh-CN\s+Sub-Store 通用无障碍增强\s*$/m);
  assert.match(source, /^\/\/ @name:en\s+Sub-Store Universal Accessibility\s*$/m);
  assert.match(source, /^\/\/ @author\s+xiaopan007\s*$/m);
  assert.match(source, /^\/\/ @description:zh-CN\s+为任意域名部署的 Sub-Store 提供无障碍增强，不读取或保存 API 凭证。\s*$/m);
  assert.match(source, /^\/\/ @description:en\s+Improve accessibility for Sub-Store deployments on any domain without reading or storing API credentials\.\s*$/m);
  assert.match(source, /^\/\/ @license\s+Copyright xiaopan007\s*$/m);
  assert.match(source, /^\/\/ @match\s+\*:\/\/\*\/\*\s*$/m);
  assert.match(source, /@grant\s+none/);
  assert.match(source, /^\/\/ @updateURL\s+https:\/\/update\.greasyfork\.org\/scripts\/583440\/Sub-Store\.meta\.js\s*$/m);
  assert.match(source, /^\/\/ @downloadURL\s+https:\/\/update\.greasyfork\.org\/scripts\/583440\/Sub-Store\.user\.js\s*$/m);
  assert.equal(metadata.includes('github.com'), false);
  assert.equal(metadata.includes('githubusercontent.com'), false);
  for (const browser of ['chrome', 'edge', 'safari']) {
    assert.match(source, new RegExp(`^// @compatible\\s+${browser}\\s*$`, 'm'));
  }
});

test('artifact contains no credential, fixed service domain, network, storage, or clipboard access', () => {
  const source = readFileSync(scriptPath, 'utf8');
  const forbidden = [
    'EXAMPLE_PRIVATE_TOKEN_DO_NOT_SHIP',
    'fixed-instance.example.invalid',
    'GM_',
    'fetch(',
    'XMLHttpRequest',
    'WebSocket',
    'localStorage',
    'sessionStorage',
    'clipboard'
  ];
  for (const value of forbidden) assert.equal(source.includes(value), false, value);
  const executableSource = source.replace(/^\/\/ ==UserScript==[\s\S]*?^\/\/ ==\/UserScript==\s*/m, '');
  assert.doesNotMatch(executableSource, /https?:\/\//);
  assert.doesNotMatch(source, /location\.(?:search|href)|URLSearchParams/);
});

test('detection activates on multiple independent Sub-Store signals', async () => {
  const dom = createPage(`<!doctype html><html><head>
    <title>Sub Store</title>
    <meta name="description" content="A sub-converter running in a Progressive Web App">
  </head><body><div id="app"><nav>订阅 文件 同步 分享 归档 我的</nav></div></body></html>`);
  await tick();
  assert.equal(dom.window.document.documentElement.dataset.subStoreA11y, 'active');
  dom.window.close();
});

test('detection does not inspect or depend on the mirror version metadata', async () => {
  assert.equal(source().includes('meta[name="version"]'), false);
  const dom = createPage(`<!doctype html><html><head>
    <title>Sub Store</title><meta name="version" content="9999.9999.9999">
  </head><body><div id="app">unrelated application</div></body></html>`);
  await tick();
  assert.equal(dom.window.document.documentElement.dataset.subStoreA11y, undefined);
  dom.window.close();
});

test('detection does not activate on an ordinary page with a similar title', async () => {
  const dom = createPage('<!doctype html><title>Sub Store</title><main>unrelated storefront</main>');
  await tick();
  assert.equal(dom.window.document.documentElement.dataset.subStoreA11y, undefined);
  dom.window.close();
});

test('detection handles a Sub-Store app rendered after startup', async () => {
  const dom = createPage('<!doctype html><html><head><title>Loading</title></head><body></body></html>');
  const { document } = dom.window;
  document.title = 'Sub Store';
  const version = document.createElement('meta');
  version.name = 'version';
  version.content = '2.17.49';
  document.head.append(version);
  const app = document.createElement('div');
  app.id = 'app';
  app.textContent = '订阅 文件 同步 分享 归档 我的';
  document.body.append(app);
  await tick();
  assert.equal(document.documentElement.dataset.subStoreA11y, 'active');
  dom.window.close();
});

test('semantic repair labels icon controls and preserves author labels', async () => {
  const dom = createPage(`<!doctype html><html><head>
    <title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="A sub-converter running in a Progressive Web App">
  </head><body><div id="app">订阅 文件 同步 分享 归档 我的
    <button class="navBar-left-icon--refresh"><svg data-icon="arrow-rotate-right"></svg></button>
    <button class="navBar-left-icon--add"><svg data-icon="plus"></svg></button>
    <button class="compare-sub-link"><svg data-icon="ellipsis"></svg></button>
    <button id="refresh-sub" class="refresh-sub-flow"><svg data-icon="arrow-rotate-right"></svg></button>
    <div class="sub-item-menu"><button id="edit-sub" class="copy-sub-link"><svg data-icon="pen-nib"></svg></button></div>
    <button class="copy-sub-link"><svg data-icon="angles-right"></svg></button>
    <div class="link-item-actions">
      <button id="open-share-source" class="copy-sub-link"><svg data-icon="link"></svg></button>
      <button id="clone-share" class="copy-sub-link"><svg data-icon="clone"></svg></button>
      <button id="edit-share" class="refresh-sub-flow"><svg data-icon="pen-nib"></svg></button>
      <button id="delete-share"><svg data-icon="trash-can"></svg></button>
    </div>
    <button id="desktop-layout"><svg data-icon="desktop" role="button" tabindex="0"><title>desktop</title></svg></button>
    <button id="mobile-layout"><svg data-icon="mobile-screen-button"></svg></button>
    <a id="export" href="/private/path"><svg data-icon="file-export"></svg></a>
    <button id="kept" aria-label="自定义名称"><svg data-icon="plus"></svg></button>
  </div></body></html>`);
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('.navBar-left-icon--refresh').ariaLabel, '刷新');
  assert.equal(document.querySelector('.navBar-left-icon--add').ariaLabel, '新建');
  assert.equal(document.querySelector('.compare-sub-link').ariaLabel, '展开更多操作');
  assert.equal(document.querySelector('.compare-sub-link').getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelector('#refresh-sub').ariaLabel, '刷新');
  assert.equal(document.querySelector('#edit-sub').ariaLabel, '编辑订阅');
  const actionDrawer = document.querySelector('button.copy-sub-link:has(svg[data-icon="angles-right"])');
  assert.equal(actionDrawer.ariaLabel, '展开复制、导出和删除操作');
  assert.equal(actionDrawer.getAttribute('aria-expanded'), 'false');
  actionDrawer.style.transform = 'rotate(180deg)';
  await tick();
  assert.equal(actionDrawer.ariaLabel, '收起复制、导出和删除操作');
  assert.equal(actionDrawer.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('#open-share-source').ariaLabel, '编辑来源项目');
  assert.equal(document.querySelector('#clone-share').ariaLabel, '复制分享配置');
  assert.equal(document.querySelector('#edit-share').ariaLabel, '编辑分享');
  assert.equal(document.querySelector('#delete-share').ariaLabel, '删除分享');
  assert.equal(document.querySelector('#desktop-layout').ariaLabel, '切换到桌面布局');
  assert.equal(document.querySelector('#mobile-layout').ariaLabel, '切换到移动布局');
  const nestedIcon = document.querySelector('#desktop-layout svg');
  assert.equal(nestedIcon.getAttribute('aria-hidden'), 'true');
  assert.equal(nestedIcon.getAttribute('role'), 'presentation');
  assert.equal(nestedIcon.getAttribute('tabindex'), '-1');
  assert.equal(document.querySelector('#export').ariaLabel, '导出订阅');
  assert.equal(document.querySelector('#kept').ariaLabel, '自定义名称');
  dom.window.close();
});

test('semantic repair adds landmarks, form labels, image text, lists, dialogs, and statuses', async () => {
  const dom = createPage(`<!doctype html><html><head>
    <title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="A sub-converter running in a Progressive Web App">
  </head><body><div id="app">订阅 文件 同步 分享 归档 我的
    <div class="nut-navbar">订阅管理</div>
    <div class="page-container"><input type="search"><input class="input-text" placeholder="名称"></div>
    <div class="sub-list"><div class="sub-item">A</div><div class="sub-item">B</div></div>
    <img id="meaningful" title="订阅图标"><button><img id="decorative"></button>
    <div class="nut-popup"><h2>选择订阅类型</h2></div>
    <div class="nut-notify">已刷新</div>
    <div class="nut-switch nut-switch--active"></div>
    <div data-clickable>打开详情</div>
  </div></body></html>`);
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('.nut-navbar').getAttribute('role'), 'navigation');
  assert.equal(document.querySelector('.page-container').getAttribute('role'), 'main');
  assert.equal(document.querySelector('input[type="search"]').ariaLabel, '搜索');
  assert.equal(document.querySelector('.input-text').ariaLabel, '名称');
  assert.equal(document.querySelector('.sub-list').getAttribute('role'), 'list');
  assert.deepEqual(Array.from(document.querySelectorAll('.sub-item'), (item) => item.getAttribute('role')), ['listitem', 'listitem']);
  assert.equal(document.querySelector('#meaningful').alt, '订阅图标');
  assert.equal(document.querySelector('#decorative').alt, '');
  assert.equal(document.querySelector('.nut-popup').getAttribute('role'), 'dialog');
  assert.equal(document.querySelector('.nut-popup').getAttribute('aria-modal'), 'true');
  assert.equal(document.querySelector('.nut-notify').getAttribute('role'), 'status');
  assert.equal(document.querySelector('.nut-notify').getAttribute('aria-live'), 'polite');
  assert.equal(document.querySelector('.nut-switch').getAttribute('role'), 'switch');
  assert.equal(document.querySelector('.nut-switch').getAttribute('aria-checked'), 'true');
  assert.equal(document.querySelector('[data-clickable]').getAttribute('role'), 'button');
  assert.equal(document.querySelector('[data-clickable]').tabIndex, 0);
  dom.window.close();
});

test('semantic repair is idempotent', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的<button><svg data-icon="search"></svg></button></div>`);
  await tick();
  const button = dom.window.document.querySelector('button');
  const before = button.outerHTML;
  dom.window.document.querySelector('#app').append(dom.window.document.createTextNode(' '));
  await tick();
  assert.equal(button.outerHTML, before);
  assert.equal(dom.window.document.querySelectorAll('[data-a11y-generated-label]').length, 1);
  dom.window.close();
});

test('keyboard activation works once for custom controls', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的<div data-clickable>详情</div></div>`);
  await tick();
  const control = dom.window.document.querySelector('[data-clickable]');
  let clicks = 0;
  control.addEventListener('click', () => clicks++);
  control.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  control.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(clicks, 2);
  dom.window.close();
});

test('focus and style layer provides skip navigation and system preference support', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的<div class="page-container"><button>内容</button></div></div>`);
  await tick();
  const { document } = dom.window;
  const skip = document.querySelector('.sub-store-a11y-skip-link');
  const main = document.querySelector('[role="main"]');
  assert.equal(skip.getAttribute('href'), `#${main.id}`);
  skip.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  assert.equal(document.activeElement, main);
  const css = document.querySelector('#sub-store-a11y-styles').textContent;
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /forced-colors:\s*active/);
  assert.match(css, /min-height:\s*44px/);
  dom.window.close();
});

test('dynamic content and route changes are repaired without a persistent status prompt', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的<div class="page-container"></div></div>`);
  await tick();
  const { document, history } = dom.window;
  const button = document.createElement('button');
  button.innerHTML = '<svg data-icon="search"></svg>';
  document.querySelector('.page-container').append(button);
  await tick();
  assert.equal(button.ariaLabel, '搜索');
  assert.equal(document.querySelector('#sub-store-a11y-live'), null);
  button.removeAttribute('aria-label');
  delete button.dataset.a11yGeneratedLabel;
  history.pushState({}, '', '/files?api=PRIVATE');
  await tick();
  assert.equal(button.ariaLabel, '搜索');
  assert.equal(document.querySelector('#sub-store-a11y-live'), null);
  dom.window.close();
});

test('dialog focus enters new modal and returns when it closes', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的<button id="open">打开</button><div class="page-container"></div></div>`);
  await tick();
  const { document } = dom.window;
  const opener = document.querySelector('#open');
  opener.focus();
  const dialog = document.createElement('div');
  dialog.className = 'nut-popup';
  dialog.innerHTML = '<h2>选项</h2><button id="inside">确定</button>';
  document.body.append(dialog);
  await tick();
  assert.equal(document.activeElement.id, 'inside');
  dialog.remove();
  await tick();
  assert.equal(document.activeElement, opener);
  dom.window.close();
});

test('dialog focus can enter a NutUI custom button created with the dialog', async (t) => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="description" content="sub-converter">
    <div id="app">订阅 文件 同步 分享 归档 我的<button id="open">打开</button></div>`);
  t.after(() => dom.window.close());
  await tick();
  const { document } = dom.window;
  document.querySelector('#open').focus();
  const dialog = document.createElement('div');
  dialog.className = 'nut-popup';
  dialog.innerHTML = '<h2>创建文件</h2><view id="import" class="nut-button">导入</view>';
  document.body.append(dialog);
  await tick();
  assert.equal(document.activeElement, document.querySelector('#import'));
});

test('realistic fixture leaves every interactive element with an accessible name', async () => {
  const fixture = readFileSync(join(__dirname, 'fixtures', 'sub-store.html'), 'utf8');
  const dom = createPage(fixture);
  await tick();
  const controls = Array.from(dom.window.document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="radio"]'));
  const unnamed = controls.filter((element) => {
    const text = (element.textContent || '').trim();
    const associatedLabel = element.id
      && Array.from(dom.window.document.querySelectorAll('label[for]')).some((label) => label.htmlFor === element.id);
    return !text
      && !element.getAttribute('aria-label')
      && !element.getAttribute('aria-labelledby')
      && !element.getAttribute('title')
      && !associatedLabel;
  });
  assert.deepEqual(unnamed, []);
  assert.equal(dom.window.document.querySelectorAll('.sub-store-a11y-skip-link').length, 1);
  assert.equal(dom.window.document.querySelectorAll('#sub-store-a11y-live').length, 0);
  dom.window.close();
});

test('bottom navigation and custom Sub-Store controls become keyboard accessible', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="menu-items"><div class="menu-item active"><i class="nut-icon-link"></i><span>订阅</span></div><div class="menu-item"><i class="nut-icon-category"></i><span>文件</span></div><div class="menu-item"><i class="nut-icon-refresh2"></i><span>同步</span></div><div class="menu-item"><svg data-icon="share-nodes"></svg><span>分享</span></div><div class="menu-item"><svg data-icon="box-archive"></svg><span>归档</span></div><div class="menu-item"><i class="nut-icon-setting"></i><span>我的</span></div></div>
      <span class="tag current">全部</span><p class="list-title">单条订阅</p>
      <view class="nut-button"><svg data-icon="file-import"></svg></view>
      <view class="nut-popup__close-icon"></view>
      <div class="sub-item-wrapper">示例订阅</div><div class="sub-item-menu"><svg data-icon="ellipsis"></svg></div>
    </div>`);
  await tick();
  const { document, KeyboardEvent } = dom.window;
  const nav = document.querySelector('.menu-items');
  const active = document.querySelector('.menu-item.active');
  assert.equal(nav.getAttribute('role'), 'navigation');
  assert.equal(nav.ariaLabel, '主要导航');
  const navItems = document.querySelectorAll('.menu-item');
  assert.equal(navItems.length, 6);
  assert.deepEqual(Array.from(navItems, (item) => item.getAttribute('role')), Array(6).fill('link'));
  assert.deepEqual(Array.from(navItems, (item) => item.ariaLabel), ['订阅管理', '文件管理', '同步', '分享管理', '归档', '我的']);
  assert.deepEqual(Array.from(navItems, (item) => item.title), ['订阅管理', '文件管理', '同步', '分享管理', '归档', '我的']);
  assert.deepEqual(Array.from(navItems, (item) => item.tabIndex), Array(6).fill(0));
  assert.deepEqual(Array.from(document.querySelectorAll('.menu-item i, .menu-item svg'), (icon) => icon.getAttribute('aria-hidden')), Array(6).fill('true'));
  assert.equal(active.getAttribute('aria-current'), 'page');
  assert.equal(document.querySelector('.tag').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.tag').hasAttribute('aria-pressed'), false);
  assert.equal(document.querySelector('.list-title').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.nut-button').ariaLabel, '导入');
  assert.equal(document.querySelector('.nut-popup__close-icon').ariaLabel, '关闭');
  assert.equal(document.querySelector('.sub-item-wrapper').getAttribute('role'), 'link');
  assert.equal(document.querySelector('.sub-item-menu').getAttribute('role'), 'group');
  assert.equal(document.querySelector('.sub-item-menu').ariaLabel, '订阅操作');
  assert.equal(document.querySelector('.sub-item-menu').hasAttribute('tabindex'), false);
  let activated = 0;
  document.querySelector('.menu-item:not(.active)').addEventListener('click', () => activated++);
  document.querySelector('.menu-item:not(.active)').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(activated, 1);
  dom.window.close();
});

test('navigation repair does not rewrite an unchanged aria-hidden value', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="menu-items"><div class="menu-item"><i class="nut-icon-link"></i><span>订阅</span></div></div>
    </div>`);
  await tick();
  const { document } = dom.window;
  const icon = document.querySelector('.menu-item i');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');

  const originalSetAttribute = icon.setAttribute.bind(icon);
  let redundantWrites = 0;
  icon.setAttribute = (name, value) => {
    if (name === 'aria-hidden' && icon.getAttribute(name) === String(value)) {
      redundantWrites++;
      return;
    }
    originalSetAttribute(name, value);
  };

  document.querySelector('.menu-item').classList.add('active');
  await tick();
  assert.equal(redundantWrites, 0);
  dom.window.close();
});

test('mobile NutUI tabbar items expose exact VoiceOver navigation names', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="nut-tabbar tabbar">
        <div class="nut-tabbar-item tabbar-item" style="cursor:pointer"><view class="nut-tabbar-item_icon-box"><view><i class="nut-icon-link"></i></view><view class="nut-tabbar-item_icon-box_nav-word"></view></view></div>
        <div class="nut-tabbar-item nut-tabbar-item__icon--unactive tabbar-item" style="cursor:pointer"><view class="nut-tabbar-item_icon-box"><view><i class="nut-icon-category"></i></view><view class="nut-tabbar-item_icon-box_nav-word"></view></view></div>
        <div class="nut-tabbar-item nut-tabbar-item__icon--unactive tabbar-item" style="cursor:pointer"><view class="nut-tabbar-item_icon-box"><view><i class="nut-icon-refresh2"></i></view><view class="nut-tabbar-item_icon-box_nav-word"></view></view></div>
        <div class="nut-tabbar-item nut-tabbar-item__icon--unactive tabbar-item" style="cursor:pointer"><view class="nut-tabbar-item_icon-box"><div><svg data-icon="share-nodes"></svg></div><view class="nut-tabbar-item_icon-box_nav-word"></view></view></div>
        <div class="nut-tabbar-item nut-tabbar-item__icon--unactive tabbar-item" style="cursor:pointer"><view class="nut-tabbar-item_icon-box"><view><i class="nut-icon-setting"></i></view><view class="nut-tabbar-item_icon-box_nav-word"></view></view></div>
      </div>
    </div>`);
  await tick();
  const { document } = dom.window;
  const items = document.querySelectorAll('.nut-tabbar-item');
  assert.deepEqual(Array.from(items, (item) => item.getAttribute('role')), Array(5).fill('link'));
  assert.deepEqual(Array.from(items, (item) => item.ariaLabel), ['订阅管理', '文件管理', '同步', '分享管理', '我的']);
  assert.deepEqual(Array.from(items, (item) => item.title), ['订阅管理', '文件管理', '同步', '分享管理', '我的']);
  assert.deepEqual(Array.from(items, (item) => item.tabIndex), Array(5).fill(0));
  assert.equal(items[0].getAttribute('aria-current'), 'page');
  assert.deepEqual(Array.from(items).slice(1).map((item) => item.getAttribute('aria-current')), Array(4).fill(null));
  assert.deepEqual(Array.from(document.querySelectorAll('.nut-tabbar-item i, .nut-tabbar-item svg'), (icon) => icon.getAttribute('aria-hidden')), Array(5).fill('true'));
  assert.equal(document.querySelectorAll('.nut-tabbar-item [role="button"], .nut-tabbar-item [tabindex="0"]').length, 0);
  dom.window.close();
});

test('subscription more-actions control exposes its dynamic name and expansion state', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="sub-item-menu">
        <button class="compare-sub-link"><svg data-icon="ellipsis"></svg></button>
      </div>
    </div>`);
  await tick();
  const { document } = dom.window;
  const group = document.querySelector('.sub-item-menu');
  const trigger = document.querySelector('.compare-sub-link');
  assert.equal(group.getAttribute('role'), 'group');
  assert.equal(group.hasAttribute('tabindex'), false);
  assert.equal(trigger.ariaLabel, '展开更多操作');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');

  trigger.querySelector('svg').setAttribute('data-icon', 'angle-right');
  trigger.insertAdjacentHTML('afterend', `
    <button class="public-link-action"><svg data-icon="share-nodes"></svg></button>
    <button class="copy-sub-link"><svg data-icon="clone"></svg></button>`);
  await tick();
  assert.equal(trigger.ariaLabel, '收起更多操作');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(group.querySelector('.public-link-action').ariaLabel, '编辑分享');
  assert.equal(group.querySelector('.copy-sub-link').ariaLabel, '复制订阅链接');
  dom.window.close();
});

test('expanded subscription actions precede the preview action in accessibility order', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="sub-item-wrapper"><div class="sub-item-content">
        <p class="sub-item-detail-isSimple" style="cursor:pointer"><span>本地订阅</span></p>
        <div class="sub-item-title-wrapper"><h3 class="sub-item-title">示例订阅</h3><div class="sub-item-menu">
          <button class="compare-sub-link"><svg data-icon="angle-right"></svg></button>
          <button class="compare-sub-link"><svg data-icon="eye"></svg></button>
          <button class="copy-sub-link"><svg data-icon="clone"></svg></button>
        </div></div>
      </div></div>
    </div>`);
  await tick();
  const { document } = dom.window;
  const wrapper = document.querySelector('.sub-item-wrapper');
  const names = Array.from(wrapper.querySelectorAll('button, [role="button"]'), (control) => control.ariaLabel);
  assert.deepEqual(names, ['收起更多操作', '生成节点对比', '复制订阅链接', '预览/拷贝订阅']);
  dom.window.close();
});

test('subscription section title hides its decorative fold icon from the accessible name', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <p class="list-title"><span class="list-title-text">单条订阅(7)</span><i class="nut-icon">f</i></p>
    </div>`);
  await tick();
  const { document } = dom.window;
  const title = document.querySelector('.list-title');
  assert.equal(title.ariaLabel, '单条订阅(7)');
  assert.equal(title.querySelector('.nut-icon').getAttribute('aria-hidden'), 'true');
  dom.window.close();
});

test('subscription action buttons never sit inside a generated link role', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="sub-item-wrapper">
        <div class="sub-item-content">
          <div class="sub-item-title-wrapper">
            <h3 class="sub-item-title">示例订阅</h3>
            <div class="sub-item-menu">
              <button class="compare-sub-link"><svg data-icon="ellipsis"></svg></button>
              <button class="refresh-sub-flow"><svg data-icon="pen-nib"></svg></button>
            </div>
          </div>
          <a href="/api/sub/example">订阅链接</a>
        </div>
      </div>
    </div>`);
  await tick();
  const { document } = dom.window;
  const trigger = document.querySelector('.compare-sub-link');
  assert.equal(trigger.closest('[role="link"]'), null);
  assert.equal(document.querySelector('.sub-item-title-wrapper').hasAttribute('tabindex'), false);
  assert.equal(document.querySelector('.sub-item-content').hasAttribute('tabindex'), false);
  dom.window.close();
});

test('subscription source text exposes the card preview action instead of masquerading as a local-subscription control', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="sub-item-wrapper" style="cursor:pointer">
        <div class="sub-item-content" style="cursor:pointer">
          <div class="sub-item-title-wrapper">
            <h3 class="sub-item-title">Shadowrocket</h3>
            <div class="sub-item-menu"><button><svg data-icon="pen-nib"></svg></button></div>
          </div>
          <p class="sub-item-detail" style="cursor:pointer"><span>本地订阅</span></p>
        </div>
      </div>
      <div class="sub-item-wrapper" style="cursor:pointer">
        <div class="sub-item-content" style="cursor:pointer">
          <div class="sub-item-title-wrapper">
            <h3 class="sub-item-title">Surge</h3>
            <div class="sub-item-menu"><button><svg data-icon="pen-nib"></svg></button></div>
          </div>
          <p class="sub-item-detail-isSimple" style="cursor:pointer"><span>本地订阅</span></p>
        </div>
      </div>
    </div>`);
  await tick();
  const { document } = dom.window;
  const entry = document.querySelector('.sub-item-detail');
  assert.equal(entry.getAttribute('role'), 'button');
  assert.equal(entry.ariaLabel, '预览/拷贝订阅');
  assert.equal(entry.hasAttribute('aria-description'), false);
  assert.equal(entry.tabIndex, 0);
  assert.equal(entry.querySelector('span').textContent, '本地订阅');
  const simpleEntry = document.querySelector('.sub-item-detail-isSimple');
  assert.equal(simpleEntry.getAttribute('role'), 'button');
  assert.equal(simpleEntry.ariaLabel, '预览/拷贝订阅');
  assert.equal(simpleEntry.hasAttribute('aria-description'), false);
  assert.equal(entry.closest('[role="link"]'), null);
  dom.window.close();
});

test('editor image toolbar buttons receive specific Chinese names and expansion state', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="cm-img-button">
        <div class="toolbar-actions">
          <button><img src="/images/jsimg.svg"></button>
          <button><img src="/images/undo.svg"></button>
          <button><img src="/images/redo.svg"></button>
          <button><img src="/images/format.svg"></button>
          <button><img src="/images/search.svg"></button>
          <button><img src="/images/copy.svg"></button>
          <button><img src="/images/del.svg"></button>
          <button><img src="/images/zt.svg"></button>
        </div>
        <button id="toolbar-more"><img src="/images/more.svg"></button>
      </div>
    </div>`);
  await tick();
  const { document } = dom.window;
  const labels = Array.from(document.querySelectorAll('.toolbar-actions button'), (button) => button.ariaLabel);
  assert.deepEqual(labels, [
    '切换 JavaScript 语法高亮', '撤销', '重做', '格式化内容',
    '查找内容', '复制编辑器内容', '清空编辑器内容', '从剪贴板粘贴'
  ]);
  const more = document.querySelector('#toolbar-more');
  assert.equal(more.ariaLabel, '收起编辑器工具栏');
  assert.equal(more.getAttribute('aria-expanded'), 'true');

  document.querySelector('.toolbar-actions').remove();
  await tick();
  assert.equal(more.ariaLabel, '展开编辑器工具栏');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  dom.window.close();
});

test('subscription swipe drawer exposes an isolated group with exact action names', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <view class="nut-swipe sub-item-swipe">
        <view class="nut-swipe__content"><div class="sub-item-wrapper">本地订阅</div></view>
        <view class="nut-swipe__right">
          <div class="sub-item-swipe-btn-wrapper"><view class="nut-button"><svg data-icon="paste"></svg></view></div>
          <div class="sub-item-swipe-btn-wrapper"><a href="/export"><view class="nut-button"><svg data-icon="file-export"></svg></view></a></div>
          <div class="sub-item-swipe-btn-wrapper"><view class="nut-button"><svg data-icon="trash-can"></svg></view></div>
        </view>
      </view>
    </div>`);
  await tick();
  const { document } = dom.window;
  const drawer = document.querySelector('.nut-swipe__right');
  assert.equal(drawer.getAttribute('role'), 'group');
  assert.equal(drawer.ariaLabel, '订阅快捷操作');
  const actions = Array.from(drawer.querySelectorAll('.sub-item-swipe-btn-wrapper'), (wrapper) => wrapper.querySelector('a[href], .nut-button'));
  assert.deepEqual(Array.from(actions, (action) => action.ariaLabel), ['复制订阅配置', '导出订阅', '删除订阅']);
  assert.deepEqual(Array.from(actions, (action) => action.getAttribute('role')), ['button', null, 'button']);
  assert.equal(actions[1].getAttribute('href'), '/export');
  dom.window.close();
});

test('subscription swipe drawer is exposed only while its action drawer is open', async (t) => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <view class="nut-swipe sub-item-swipe">
        <view class="nut-swipe__content"><div class="sub-item-wrapper">
          <h3 class="sub-item-title">示例订阅</h3>
          <button class="copy-sub-link"><svg data-icon="angles-right"></svg></button>
          <p class="sub-item-detail-isSimple" style="cursor:pointer"><span>本地订阅</span></p>
        </div></view>
        <view class="nut-swipe__right">
          <div class="sub-item-swipe-btn-wrapper"><view class="nut-button"><svg data-icon="paste"></svg></view></div>
          <div class="sub-item-swipe-btn-wrapper"><a href="/export"><view class="nut-button"><svg data-icon="file-export"></svg></view></a></div>
          <div class="sub-item-swipe-btn-wrapper"><view class="nut-button"><svg data-icon="trash-can"></svg></view></div>
        </view>
      </view>
    </div>`);
  t.after(() => dom.window.close());
  await tick();
  const { document } = dom.window;
  const trigger = document.querySelector('.copy-sub-link');
  const drawer = document.querySelector('.nut-swipe__right');
  const swipe = document.querySelector('.nut-swipe');
  const preview = document.querySelector('.sub-item-detail-isSimple');
  const originalActions = Array.from(drawer.querySelectorAll('.sub-item-swipe-btn-wrapper'), (wrapper) => wrapper.querySelector('a, .nut-button'));
  const originalHref = originalActions[1].getAttribute('href');
  const clicks = [0, 0, 0, 0];
  trigger.addEventListener('click', () => dom.window.requestAnimationFrame(() => {
    trigger.style.transform = '';
  }));
  originalActions.forEach((action, index) => action.addEventListener('click', (event) => {
    if (action.matches('a')) event.preventDefault();
    clicks[index]++;
  }));
  preview.addEventListener('click', () => clicks[3]++);

  assert.equal(trigger.ariaLabel, '展开复制、导出和删除操作');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(drawer.hasAttribute('inert'), true);
  assert.equal(drawer.classList.contains('sub-store-a11y-drawer-collapsed'), true);
  assert.equal(dom.window.getComputedStyle(drawer).visibility, 'hidden');
  assert.equal(swipe.hasAttribute('aria-owns'), false);
  assert.equal(document.querySelector('.sub-store-a11y-drawer-actions'), null);
  assert.equal(document.querySelector('.sub-store-a11y-preview-proxy'), null);
  assert.equal(originalActions[1].getAttribute('href'), originalHref);
  assert.deepEqual(Array.from(originalActions, (action) => action.hasAttribute('inert')), [true, true, true]);
  assert.deepEqual(Array.from(originalActions, (action) => action.getAttribute('aria-hidden')), ['true', 'true', 'true']);
  assert.deepEqual(Array.from(originalActions, (action) => action.getAttribute('tabindex')), ['-1', '-1', '-1']);

  trigger.style.transform = 'rotate(180deg)';
  await tick();
  assert.equal(trigger.ariaLabel, '收起复制、导出和删除操作');
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(drawer.hasAttribute('aria-hidden'), false);
  assert.equal(drawer.hasAttribute('inert'), false);
  assert.equal(drawer.classList.contains('sub-store-a11y-drawer-collapsed'), false);
  assert.equal(Boolean(trigger.compareDocumentPosition(drawer) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING), true);
  assert.equal(Boolean(drawer.compareDocumentPosition(preview) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING), true);
  assert.equal(swipe.hasAttribute('aria-owns'), false);
  assert.equal(document.querySelector('.sub-store-a11y-drawer-actions'), null);
  assert.deepEqual(Array.from(originalActions, (action) => action.ariaLabel), [
    '复制订阅配置', '导出订阅', '删除订阅'
  ]);
  assert.deepEqual(Array.from(originalActions, (action) => action.getAttribute('role')), ['button', null, 'button']);
  assert.deepEqual(Array.from(originalActions, (action) => action.hasAttribute('inert')), [false, false, false]);
  assert.deepEqual(Array.from(originalActions, (action) => action.getAttribute('aria-hidden')), [null, null, null]);
  assert.deepEqual(Array.from(originalActions, (action) => action.getAttribute('tabindex')), ['0', null, '0']);
  assert.equal(originalActions[1].getAttribute('href'), originalHref);
  assert.equal(preview.hasAttribute('aria-hidden'), false);
  assert.equal(preview.getAttribute('tabindex'), '0');
  assert.equal(swipe.querySelector('.sub-store-a11y-preview-proxy'), null);

  const tab = (target, shiftKey = false) => target.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Tab', bubbles: true, cancelable: true, shiftKey
  }));
  trigger.focus();
  tab(trigger);
  assert.equal(document.activeElement, originalActions[0]);
  tab(originalActions[2]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(document.activeElement, preview);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');

  originalActions.forEach((action) => action.click());
  preview.focus();
  preview.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(clicks, [1, 1, 1, 1]);

  trigger.style.transform = '';
  await tick();
  assert.equal(drawer.getAttribute('aria-hidden'), 'true');
  assert.equal(drawer.hasAttribute('inert'), true);
  assert.equal(drawer.classList.contains('sub-store-a11y-drawer-collapsed'), true);
  assert.equal(dom.window.getComputedStyle(drawer).visibility, 'hidden');
  assert.deepEqual(Array.from(originalActions, (action) => action.hasAttribute('inert')), [true, true, true]);
  assert.deepEqual(Array.from(originalActions, (action) => action.getAttribute('aria-hidden')), ['true', 'true', 'true']);
  assert.deepEqual(Array.from(originalActions, (action) => action.getAttribute('tabindex')), ['-1', '-1', '-1']);
  assert.equal(swipe.hasAttribute('aria-owns'), false);
  assert.equal(swipe.querySelector('.sub-store-a11y-preview-proxy'), null);
  assert.equal(preview.getAttribute('tabindex'), '0');
  assert.equal(originalActions[1].getAttribute('href'), originalHref);
  dom.window.close();
});

test('file swipe drawer uses file-specific action names', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <view class="nut-swipe">
        <view class="nut-swipe__right">
          <div class="sub-item-swipe-btn-wrapper"><view class="nut-button"><svg data-icon="paste"></svg></view></div>
          <div class="sub-item-swipe-btn-wrapper"><a href="/api/file/example?raw=1"><view class="nut-button"><svg data-icon="file-export"></svg></view></a></div>
          <div class="sub-item-swipe-btn-wrapper"><view class="nut-button"><svg data-icon="trash-can"></svg></view></div>
        </view>
      </view>
    </div>`);
  await tick();
  const { document } = dom.window;
  const drawer = document.querySelector('.nut-swipe__right');
  assert.equal(drawer.ariaLabel, '文件快捷操作');
  const actions = drawer.querySelectorAll('[role="button"], a[href]');
  assert.deepEqual(Array.from(actions, (action) => action.ariaLabel), ['复制文件配置', '导出文件', '删除文件']);
  dom.window.close();
});

test('subscription preview and service actions use behavior-specific names', async (t) => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="sub-item-menu">
        <button id="service" class="compare-sub-link"><svg data-icon="square-arrow-up-right"></svg></button>
        <span id="empty-label"></span><button id="preview" class="compare-sub-link" aria-label="" aria-labelledby="empty-label"><svg data-icon="eye"></svg></button>
        <button id="copy-link" class="copy-sub-link"><svg data-icon="clone"></svg></button>
      </div>
      <div class="auto-dialog"><ul><li>
        <div class="infos"><p>Shadowrocket</p></div>
        <div class="actions"><a href="/preview"><svg data-icon="eye"></svg></a><button class="copy-sub-link"><svg data-icon="copy"></svg></button></div>
      </li></ul></div>
    </div>`);
  t.after(() => dom.window.close());
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('#service').ariaLabel, '打开订阅服务页面');
  assert.equal(document.querySelector('#preview').ariaLabel, '生成节点对比');
  assert.equal(document.querySelector('#preview').hasAttribute('aria-labelledby'), false);
  assert.equal(document.querySelector('#copy-link').ariaLabel, '复制订阅链接');
  assert.equal(document.querySelector('.actions a').ariaLabel, '预览 Shadowrocket 输出');
  assert.equal(document.querySelector('.actions button').ariaLabel, '复制 Shadowrocket 链接');
  dom.window.close();
});

test('icons inside named controls cannot become separate empty focus targets in Edge', async (t) => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <button class="compare-sub-link" aria-label=""><svg data-icon="eye" tabindex="0" focusable="true"></svg></button>
    </div>`);
  t.after(() => dom.window.close());
  await tick();
  const { document } = dom.window;
  const button = document.querySelector('button');
  const icon = button.querySelector('svg');
  assert.equal(button.ariaLabel, '生成节点对比');
  assert.equal(icon.getAttribute('aria-hidden'), 'true');
  assert.equal(icon.getAttribute('role'), 'presentation');
  assert.equal(icon.getAttribute('focusable'), 'false');
  assert.equal(icon.getAttribute('tabindex'), '-1');
  icon.setAttribute('aria-hidden', 'false');
  icon.setAttribute('tabindex', '0');
  icon.focus();
  assert.equal(document.activeElement, button);
  dom.window.close();
});

test('sync page controls expose exact Chinese action names', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <view id="sync-upload" class="nut-button upload-all-btn"><svg data-icon="cloud-arrow-up"></svg></view>
      <view id="sync-download" class="nut-button upload-all-btn"><svg data-icon="cloud-arrow-down"></svg></view>
      <view id="sync-preview" class="nut-button preview-btn"><svg data-icon="eye"></svg></view>
      <view id="sync-add" class="nut-button">立即添加</view>
      <view id="sync-save" class="nut-button submit-btn"><svg data-icon="floppy-disk"></svg><span>保存</span></view>
    </div>`);
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('#sync-upload').ariaLabel, '上传全部同步配置');
  assert.equal(document.querySelector('#sync-download').ariaLabel, '下载同步配置');
  assert.equal(document.querySelector('#sync-preview').ariaLabel, '预览同步配置');
  assert.equal(document.querySelector('#sync-add').ariaLabel, '立即添加');
  assert.equal(document.querySelector('#sync-save').ariaLabel, '保存');
  assert.deepEqual(
    Array.from(document.querySelectorAll('#sync-upload, #sync-download, #sync-preview, #sync-add, #sync-save'), (control) => control.getAttribute('role')),
    Array(5).fill('button')
  );
  dom.window.close();
});

test('overlay repair targets known NutUI overlays without promoting hidden dialog templates', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="version" content="2.17.49">
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div class="configuration-dialog-template">尚未打开</div>
      <div class="nut-dialog"><h2>确认操作</h2><button>取消</button></div>
    </div>`);
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('.configuration-dialog-template').getAttribute('role'), null);
  assert.equal(document.querySelector('.nut-dialog').getAttribute('role'), 'dialog');
  dom.window.close();
});

test('hidden NutUI overlays stay out of the dialog tree and never steal focus', async (t) => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <button id="return-target">打开弹窗</button>
      <div id="hidden-popup" class="nut-popup" style="display:none"><button id="hidden-action">隐藏操作</button></div>
      <div id="visible-dialog" class="nut-dialog"><h2>确认操作</h2><button id="visible-action">取消</button></div>
    </div>`);
  t.after(() => dom.window.close());
  dom.window.document.querySelector('#return-target').focus();
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('#hidden-popup').hasAttribute('role'), false);
  assert.equal(document.querySelector('#hidden-popup').hasAttribute('aria-modal'), false);
  assert.equal(document.activeElement, document.querySelector('#visible-action'));
});

test('nested NutUI popup wrappers expose one dialog instead of duplicate dialogs', async (t) => {
  const dom = createPage(`<!doctype html><title>Sub Store</title>
    <meta name="description" content="sub-converter"><div id="app">订阅 文件 同步 分享 归档 我的
      <div id="popup-wrapper" class="nut-popup"><div id="inner-dialog" class="nut-dialog"><h2>预览</h2><button>取消</button></div></div>
    </div>`);
  t.after(() => dom.window.close());
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('#popup-wrapper').hasAttribute('role'), false);
  assert.equal(document.querySelector('#inner-dialog').getAttribute('role'), 'dialog');
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
});

test('editor controls receive contextual Chinese names instead of generic or English labels', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="description" content="sub-converter">
    <div id="app">订阅 文件 同步 分享 归档 我的
      <div class="page-container">
        <div class="nut-cell nut-form-item"><div class="nut-form-item__label">名称</div><input placeholder="输入展示的名称"></div>
        <button class="nav-leading-button"><svg data-icon="arrow-left"></svg></button>
        <button id="help"><svg data-icon="circle-question"></svg></button>
        <button class="Toastify__close-button" aria-label="close"></button>
        <view class="nut-button compare-btn"><svg data-icon="eye"></svg><span>即时预览</span></view>
        <view class="nut-button submit-btn"><svg data-icon="floppy-disk"></svg><span>保存</span></view>
        <div class="action-btn">更多</div><div class="action-btn">恢复默认</div>
        <view class="nut-picker__left">取消</view><view class="nut-picker__right">确定</view>
      </div>
    </div>`);
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('input').ariaLabel, '名称');
  assert.equal(document.querySelector('.nav-leading-button').ariaLabel, '返回');
  assert.equal(document.querySelector('#help').ariaLabel, '帮助');
  assert.equal(document.querySelector('.Toastify__close-button').ariaLabel, '关闭通知');
  assert.equal(document.querySelector('.compare-btn').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.submit-btn').getAttribute('role'), 'button');
  assert.deepEqual(Array.from(document.querySelectorAll('.action-btn'), (item) => [item.getAttribute('role'), item.tabIndex, item.textContent]), [
    ['button', 0, '更多'], ['button', 0, '恢复默认']
  ]);
  assert.equal(document.querySelector('.nut-picker__left').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.nut-picker__right').getAttribute('role'), 'button');
  dom.window.close();
});

test('NutUI switches, checkboxes, and radios expose contextual names and live state', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="description" content="sub-converter">
    <div id="app">订阅 文件 同步 分享 归档 我的<div class="page-container">
      <div class="nut-cell nut-form-item"><div class="nut-form-item__label">图标原色</div><view id="color-switch" class="nut-switch switch-open nut-switch-base"></view></div>
      <view id="sub-check" class="nut-checkbox nut-checkbox--round"><view class="nut-checkbox__label">示例订阅</view></view>
      <div class="nut-cell nut-form-item"><div class="nut-form-item__label">密钥类型</div>
        <view class="nut-radiogroup"><view id="radio-a" class="nut-radio nut-radio--button"><view class="nut-radio__button nut-radio__button--active">X25519</view></view><view id="radio-b" class="nut-radio nut-radio--button"><view class="nut-radio__button">混合密钥</view></view></view>
      </div>
    </div></div>`);
  await tick();
  const { document, KeyboardEvent } = dom.window;
  const toggle = document.querySelector('#color-switch');
  assert.equal(toggle.getAttribute('role'), 'switch');
  assert.equal(toggle.ariaLabel, '图标原色');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
  const checkbox = document.querySelector('#sub-check');
  assert.equal(checkbox.getAttribute('role'), 'checkbox');
  assert.equal(checkbox.ariaLabel, '示例订阅');
  assert.equal(checkbox.getAttribute('aria-checked'), 'false');
  assert.equal(document.querySelector('.nut-radiogroup').getAttribute('role'), 'radiogroup');
  assert.equal(document.querySelector('.nut-radiogroup').ariaLabel, '密钥类型');
  assert.equal(document.querySelector('#radio-a').getAttribute('role'), 'radio');
  assert.equal(document.querySelector('#radio-a').getAttribute('aria-checked'), 'true');
  assert.equal(document.querySelector('#radio-b').getAttribute('aria-checked'), 'false');
  let clicks = 0;
  checkbox.addEventListener('click', () => clicks++);
  checkbox.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  assert.equal(clicks, 1);
  toggle.classList.remove('switch-open');
  toggle.classList.add('switch-close');
  await tick();
  assert.equal(toggle.getAttribute('aria-checked'), 'false');
  dom.window.close();
});

test('settings switches use the real NutUI cell title as their accessible name', async (t) => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="description" content="sub-converter">
    <div id="app">订阅 文件 同步 分享 归档 我的
      <view class="nut-cell"><view class="nut-cell__title">卡片右滑呼出</view><view id="swipe-switch" class="nut-switch switch-open nut-switch-base"></view></view>
    </div>`);
  t.after(() => dom.window.close());
  await tick();
  const toggle = dom.window.document.querySelector('#swipe-switch');
  assert.equal(toggle.ariaLabel, '卡片右滑呼出');
  assert.equal(toggle.getAttribute('role'), 'switch');
  assert.equal(toggle.getAttribute('aria-checked'), 'true');
});

test('editor triggers and conservative pointer fallback become named keyboard controls without nesting roles', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="description" content="sub-converter">
    <div id="app">订阅 文件 同步 分享 归档 我的<div class="page-container">
      <view class="nut-cell include-subs-trigger">手动选择的订阅</view>
      <view class="nut-cell failure-mode-trigger">订阅失败处理</view>
      <div class="common-title-row"><div class="title">常用配置</div></div>
      <div id="new-control" class="future-control" style="cursor:pointer"><span style="cursor:pointer">镜像新增操作</span></div>
      <div id="native-wrapper" style="cursor:pointer"><button>原生按钮</button></div>
    </div></div>`);
  await tick();
  const { document, KeyboardEvent } = dom.window;
  assert.equal(document.querySelector('.include-subs-trigger').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.include-subs-trigger').ariaLabel, '选择手动订阅');
  assert.equal(document.querySelector('.failure-mode-trigger').ariaLabel, '选择订阅失败处理方式');
  assert.equal(document.querySelector('.common-title-row .title').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.common-title-row .title').ariaLabel, '展开或收起常用配置');
  const future = document.querySelector('#new-control');
  assert.equal(future.getAttribute('role'), 'button');
  assert.equal(future.ariaLabel, '镜像新增操作');
  assert.equal(future.querySelector('span').getAttribute('role'), null);
  assert.equal(document.querySelector('#native-wrapper').getAttribute('role'), null);
  let clicks = 0;
  future.addEventListener('click', () => clicks++);
  future.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(clicks, 1);
  dom.window.close();
});

test('standalone editor icons and field-help affordances receive specific Chinese button names', async () => {
  const dom = createPage(`<!doctype html><title>Sub Store</title><meta name="description" content="sub-converter">
    <div id="app">订阅 文件 同步 分享 归档 我的<div class="page-container">
      <div class="nut-cell nut-form-item"><div class="nut-form-item__label">图标链接</div><div class="sticky-title-icon-container" style="cursor:pointer"><view class="nut-image"></view></div></div>
      <span class="label-with-tip" style="cursor:pointer">age 加密公钥<i class="nut-icon-tips"></i></span>
      <div class="sticky-title-wrapper actions-title-wrapper">节点操作<svg id="toggle" data-icon="toggle-off" style="cursor:pointer"></svg></div>
      <view class="nut-drag" style="cursor:pointer"></view>
    </div></div>`);
  await tick();
  const { document } = dom.window;
  assert.equal(document.querySelector('.sticky-title-icon-container').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.sticky-title-icon-container').ariaLabel, '选择图标');
  assert.equal(document.querySelector('.label-with-tip').getAttribute('role'), 'button');
  assert.equal(document.querySelector('.label-with-tip').ariaLabel, '查看age 加密公钥说明');
  assert.equal(document.querySelector('#toggle').getAttribute('role'), 'button');
  assert.equal(document.querySelector('#toggle').ariaLabel, '展开或收起节点操作');
  assert.equal(document.querySelector('.nut-drag').ariaLabel, '拖动排序');
  dom.window.close();
});
