// ==UserScript==
// @name         Sub-Store
// @namespace    sub-store-universal-a11y
// @version      1.0.24
// @author       xiaopan007
// @homepageURL  https://github.com/xiaopan007/zaxiang
// @description  为任意域名部署的 Sub-Store 提供无障碍增强，不读取或保存 API 凭证。
// @updateURL    https://raw.githubusercontent.com/xiaopan007/zaxiang/main/sub-store.user.js
// @downloadURL  https://raw.githubusercontent.com/xiaopan007/zaxiang/main/sub-store.user.js
// @match        *://*/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const ROOT_MARKER = 'subStoreA11y';
  let startupObserver;
  let enhancementObserver;
  let detectionQueued = false;
  let enhancementQueued = false;
  let generatedId = 0;
  let activeDialog = null;
  let dialogReturnTarget = null;
  const seenDialogs = new WeakSet();

  const CLASS_LABELS = [
    ['navBar-left-icon--refresh', '刷新'],
    ['navBar-left-icon--add', '新建'],
    ['nut-popup__close-icon', '关闭'],
    ['include-subs-trigger', '选择手动订阅'],
    ['failure-mode-trigger', '选择订阅失败处理方式'],
    ['nut-drag', '拖动排序']
  ];

  const ICON_LABELS = {
    'arrow-rotate-right': '刷新',
    'arrows-rotate': '同步',
    plus: '新建',
    search: '搜索',
    'magnifying-glass': '搜索',
    ellipsis: '更多操作',
    'ellipsis-vertical': '更多操作',
    'pen-nib': '编辑订阅',
    pen: '编辑',
    'pen-to-square': '编辑',
    copy: '复制',
    link: '复制分享链接',
    clone: '复制分享配置',
    'file-export': '导出订阅',
    'file-import': '导入',
    paste: '复制配置',
    trash: '删除',
    'trash-can': '删除',
    xmark: '关闭',
    check: '确认',
    'circle-question': '帮助',
    'chevron-left': '返回',
    'arrow-left': '返回',
    share: '分享',
    'share-nodes': '分享',
    archive: '归档',
    box: '归档',
    'box-archive': '归档',
    'toggle-on': '切换简洁模式',
    'toggle-off': '切换状态',
    'file-lines': '查看记录',
    'floppy-disk': '保存',
    language: '切换语言',
    desktop: '切换到桌面布局',
    'mobile-screen-button': '切换到移动布局',
    'table-columns': '切换分栏布局',
    eye: '显示',
    'eye-slash': '隐藏',
    gear: '设置'
  };

  const IMAGE_CONTROL_LABELS = {
    'jsimg.svg': '切换 JavaScript 语法高亮',
    'undo.svg': '撤销',
    'redo.svg': '重做',
    'format.svg': '格式化内容',
    'search.svg': '查找内容',
    'copy.svg': '复制编辑器内容',
    'del.svg': '清空编辑器内容',
    'zt.svg': '从剪贴板粘贴'
  };

  const NAVIGATION_LABELS = {
    订阅: '订阅管理',
    文件: '文件管理',
    同步: '同步',
    分享: '分享管理',
    归档: '归档',
    我的: '我的'
  };

  const MOBILE_NAVIGATION_LABELS = [
    ['.nut-icon-link', '订阅管理'],
    ['.nut-icon-category', '文件管理'],
    ['.nut-icon-refresh2', '同步'],
    ['svg[data-icon="share-nodes"]', '分享管理'],
    ['.nut-icon-setting', '我的']
  ];

  function isSubStore() {
    let score = 0;
    const title = document.title.trim().toLowerCase();
    const description = document.querySelector('meta[name="description"]')?.content || '';
    const app = document.querySelector('#app, [data-v-app]');
    const scriptSources = Array.from(document.scripts, (item) => item.getAttribute('src') || '');

    if (title === 'sub store' || title === 'sub-store') score += 2;
    if (/sub-converter|progressive web app/i.test(description)) score += 2;
    if (scriptSources.some((item) => /(?:^|\/)index\.js(?:\?|$)/.test(item))) score += 1;
    if (scriptSources.some((item) => /(?:^|\/)registerSW\.js(?:\?|$)/.test(item))) score += 1;
    if (app) {
      score += 1;
      const text = (app.textContent || '').slice(0, 3000);
      const terms = ['订阅', '文件', '同步', '分享', '归档', '我的'];
      if (terms.filter((term) => text.includes(term)).length >= 4) score += 2;
    }
    return score >= 5;
  }

  function activate() {
    if (document.documentElement.dataset[ROOT_MARKER] === 'active') return;
    document.documentElement.dataset[ROOT_MARKER] = 'active';
    startupObserver?.disconnect();
    enhance(document);
    installInfrastructure();
    enhancementObserver = new MutationObserver(queueEnhancement);
    enhancementObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'hidden', 'aria-hidden', 'data-icon', 'style']
    });
  }

  function installInfrastructure() {
    installStyles();
    ensureSkipLink();
    document.addEventListener('keydown', routeSubscriptionDrawerFocus);
    document.addEventListener('keydown', handleCustomControlKey);
    document.addEventListener('focusin', redirectNestedIconFocus, true);
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        handleRouteChange();
        return result;
      };
    }
  }

  function installStyles() {
    if (document.querySelector('#sub-store-a11y-styles')) return;
    const style = document.createElement('style');
    style.id = 'sub-store-a11y-styles';
    style.textContent = `
      .sub-store-a11y-skip-link {
        position: fixed; z-index: 2147483647; inset-block-start: 8px; inset-inline-start: 8px;
        padding: 10px 14px; color: #fff; background: #111; border: 2px solid currentColor;
        border-radius: 6px; transform: translateY(-160%);
      }
      .sub-store-a11y-skip-link:focus { transform: translateY(0); }
      [data-sub-store-a11y="active"] :focus-visible {
        outline: 3px solid #005fcc !important; outline-offset: 3px !important;
      }
      [data-sub-store-a11y="active"] button,
      [data-sub-store-a11y="active"] a[href],
      [data-sub-store-a11y="active"] input,
      [data-sub-store-a11y="active"] select,
      [data-sub-store-a11y="active"] textarea,
      [data-sub-store-a11y="active"] [role="button"],
      [data-sub-store-a11y="active"] [role="link"],
      [data-sub-store-a11y="active"] [role="switch"],
      [data-sub-store-a11y="active"] [role="checkbox"],
      [data-sub-store-a11y="active"] [role="radio"] { min-height: 44px; }
      [data-sub-store-a11y="active"] input,
      [data-sub-store-a11y="active"] select,
      [data-sub-store-a11y="active"] textarea { font-size: max(16px, 1em); }
      @media (prefers-reduced-motion: reduce) {
        [data-sub-store-a11y="active"] *, [data-sub-store-a11y="active"] *::before,
        [data-sub-store-a11y="active"] *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
      }
      @media (forced-colors: active) {
        [data-sub-store-a11y="active"] :focus-visible { outline-color: Highlight !important; }
        .sub-store-a11y-skip-link { color: LinkText; background: Canvas; }
      }
      .sub-store-a11y-drawer-inline { overflow: visible !important; }
      .sub-store-a11y-drawer-collapsed { visibility: hidden !important; }
    `;
    (document.head || document.documentElement).append(style);
  }

  function ensureSkipLink() {
    if (!document.body || document.querySelector('.sub-store-a11y-skip-link')) return;
    const main = document.querySelector('main, [role="main"]');
    if (!main) return;
    if (!main.id) main.id = 'sub-store-a11y-main';
    if (!main.hasAttribute('tabindex')) main.tabIndex = -1;
    const skip = document.createElement('a');
    skip.className = 'sub-store-a11y-skip-link';
    skip.href = `#${main.id}`;
    skip.textContent = '跳到主要内容';
    skip.addEventListener('click', (event) => {
      event.preventDefault();
      main.focus();
    });
    document.body.prepend(skip);
  }

  function handleRouteChange() {
    queueMicrotask(queueEnhancement);
  }

  function routeSubscriptionDrawerFocus(event) {
    if (event.key !== 'Tab' || !(event.target instanceof Element)) return;
    const swipe = event.target.closest('.nut-swipe');
    if (!swipe) return;
    const trigger = swipe.querySelector('button:has(svg[data-icon="angles-right"])');
    if (trigger?.getAttribute('aria-expanded') !== 'true') return;
    const drawer = swipe.querySelector('.nut-swipe__right');
    const preview = swipe.querySelector('.sub-item-detail, .sub-item-detail-isSimple');
    const actions = Array.from(drawer?.querySelectorAll('.sub-item-swipe-btn-wrapper, .sub-item-swipe-btn') || [])
      .map((wrapper) => wrapper.querySelector('a[href], button, .nut-button'))
      .filter(Boolean);
    const firstAction = actions[0];
    const lastAction = actions[actions.length - 1];
    if (!event.shiftKey && event.target === lastAction && preview) {
      event.preventDefault();
      trigger.click();
      const content = swipe.querySelector('.nut-swipe__content');
      const focusPreviewWhenCollapsed = (remainingFrames) => {
        const contentTransform = content ? (getComputedStyle(content).transform || content.style.transform) : '';
        const matrix = contentTransform.match(/^matrix(?:3d)?\((.+)\)$/);
        const values = matrix ? matrix[1].split(',').map(Number) : [];
        const horizontalOffset = values.length === 6 ? values[4] : values.length === 16 ? values[12] : NaN;
        const contentIsCollapsed = !contentTransform
          || contentTransform === 'none'
          || (Number.isFinite(horizontalOffset) && Math.abs(horizontalOffset) < 0.5);
        if (!/rotate\(180deg\)/.test(trigger.style.transform) && contentIsCollapsed) {
          preview.focus();
          return;
        }
        if (remainingFrames > 0) requestAnimationFrame(() => focusPreviewWhenCollapsed(remainingFrames - 1));
      };
      requestAnimationFrame(() => focusPreviewWhenCollapsed(40));
      return;
    }
    let destination = null;
    if (!event.shiftKey && event.target === trigger) destination = firstAction;
    else if (event.shiftKey && event.target === preview) destination = lastAction;
    else if (event.shiftKey && event.target === firstAction) destination = trigger;
    else if (!event.shiftKey && event.target === preview) {
      destination = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [tabindex="0"], [role="button"]'))
        .find((candidate) => !swipe.contains(candidate)
          && Boolean(swipe.compareDocumentPosition(candidate) & Node.DOCUMENT_POSITION_FOLLOWING)
          && !candidate.closest('[inert], [aria-hidden="true"]')
          && !candidate.matches('[disabled], [tabindex="-1"]')
          && getComputedStyle(candidate).display !== 'none'
          && getComputedStyle(candidate).visibility !== 'hidden');
    }
    if (!destination) return;
    event.preventDefault();
    destination.focus();
  }

  function handleCustomControlKey(event) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const control = event.target.closest('[data-clickable], [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="link"]');
    if (!control || control.matches('button, a[href], input, select, textarea')) return;
    event.preventDefault();
    control.click();
  }

  function redirectNestedIconFocus(event) {
    const icon = event.target;
    if (!(icon instanceof Element) || !icon.matches('svg, i')) return;
    const owner = icon.closest('button, a[href], [role="button"]');
    if (owner && owner !== icon) owner.focus();
  }

  function hasAccessibleName(element) {
    if (cleanText(element.getAttribute('aria-label')) || cleanText(element.getAttribute('aria-labelledby'))) return true;
    if ((element.getAttribute('title') || '').trim()) return true;
    const textClone = element.cloneNode(true);
    textClone.querySelectorAll('svg, i').forEach((icon) => icon.remove());
    if (cleanText(textClone.textContent || '')) return true;
    return Boolean(element.querySelector('img[alt]:not([alt=""])'));
  }

  function inferredLabel(element) {
    const shareActions = element.closest('.link-item-actions');
    if (shareActions) {
      if (element.querySelector('svg[data-icon="link"]')) return '编辑来源项目';
      if (element.querySelector('svg[data-icon="clone"]')) return '复制分享配置';
      if (element.querySelector('svg[data-icon="pen-nib"]')) return '编辑分享';
      if (element.querySelector('svg[data-icon="trash-can"], svg[data-icon="trash"]')) return '删除分享';
    }
    if (element.closest('.sub-item-menu')
      && element.classList.contains('public-link-action')
      && element.querySelector('svg[data-icon="share-nodes"]')) return '编辑分享';
    if (element.classList.contains('upload-all-btn')) {
      if (element.querySelector('svg[data-icon="cloud-arrow-up"]')) return '上传全部同步配置';
      if (element.querySelector('svg[data-icon="cloud-arrow-down"]')) return '下载同步配置';
    }
    if (element.classList.contains('preview-btn')) return '预览同步配置';
    if (element.classList.contains('submit-btn')) return visibleText(element) || '保存';
    if (element.classList.contains('compare-sub-link')) {
      if (element.querySelector('svg[data-icon="square-arrow-up-right"]')) return '打开订阅服务页面';
      if (element.querySelector('svg[data-icon="eye"]')) return '生成节点对比';
      return element.querySelector('svg[data-icon="angle-right"]') ? '收起更多操作' : '展开更多操作';
    }
    if (element.classList.contains('copy-sub-link') && element.querySelector('svg[data-icon="clone"]')) return '复制订阅链接';
    if (element.querySelector('svg[data-icon="angles-right"]')) {
      return /rotate\(180deg\)/.test(element.style.transform) ? '收起复制、导出和删除操作' : '展开复制、导出和删除操作';
    }
    const image = element.matches('img[src]') ? element : element.querySelector('img[src]');
    const imageName = image?.getAttribute('src')?.split('/').pop()?.split('?')[0];
    if (imageName === 'more.svg') {
      const toolbar = element.closest('.cm-img-button');
      return toolbar?.querySelector(':scope > div') ? '收起编辑器工具栏' : '展开编辑器工具栏';
    }
    if (IMAGE_CONTROL_LABELS[imageName]) return IMAGE_CONTROL_LABELS[imageName];
    const icon = element.matches('svg[data-icon]')
      ? element.getAttribute('data-icon')
      : element.querySelector('svg[data-icon]')?.getAttribute('data-icon');
    if (ICON_LABELS[icon]) return ICON_LABELS[icon];
    for (const [className, label] of CLASS_LABELS) {
      if (element.classList.contains(className)) return label;
    }
    return '';
  }

  function cleanText(value) {
    return (value || '')
      .replace(/[\uE000-\uF8FF]/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\*+/, '')
      .trim()
      .slice(0, 120);
  }

  function visibleText(element) {
    return cleanText(element.innerText || element.textContent || '');
  }

  function isVisuallyHidden(element) {
    for (let current = element; current && current !== document.documentElement; current = current.parentElement) {
      if (current.hidden || current.getAttribute('aria-hidden') === 'true') return true;
      const style = getComputedStyle(current);
      if (style.display === 'none' || style.visibility === 'hidden') return true;
    }
    return false;
  }

  function contextLabel(element) {
    const container = element.closest('.nut-cell, .nut-form-item, .switch-item, .line, .editor-tab-content');
    if (!container) return '';
    const candidates = container.querySelectorAll('.nut-form-item__label, .nut-cell__title, .label-with-tip, .field-label, label');
    for (const candidate of candidates) {
      if (candidate === element || element.contains(candidate)) continue;
      const text = visibleText(candidate);
      if (text) return text;
    }
    return '';
  }

  function setControlLabel(element, label) {
    if (!label) return;
    const current = cleanText(element.getAttribute('aria-label'));
    if (!current || element.dataset.a11yGeneratedLabel === 'true' || /^(close|button|switch)$/i.test(current)) {
      element.setAttribute('aria-label', label);
      element.dataset.a11yGeneratedLabel = 'true';
    }
  }

  function makeKeyboardControl(element, role, label) {
    element.setAttribute('role', role);
    if (!element.hasAttribute('tabindex')) element.tabIndex = 0;
    setControlLabel(element, label || visibleText(element) || contextLabel(element) || inferredLabel(element));
  }

  function labelControls(root) {
    root.querySelectorAll('button, a[href], [role="button"], [role="link"]').forEach((element) => {
      if (hasAccessibleName(element)) return;
      element.setAttribute('aria-label', inferredLabel(element) || (element.matches('a[href]') ? '打开链接' : '操作按钮'));
      element.dataset.a11yGeneratedLabel = 'true';
    });
    root.querySelectorAll('button svg, button i, a[href] svg, a[href] i, [role="button"] svg, [role="button"] i, [role="link"] svg, [role="link"] i').forEach((icon) => {
      if (icon.getAttribute('aria-hidden') !== 'true') icon.setAttribute('aria-hidden', 'true');
      if (icon.getAttribute('role') !== 'presentation') icon.setAttribute('role', 'presentation');
      if (icon.getAttribute('focusable') !== 'false') icon.setAttribute('focusable', 'false');
      if (icon.getAttribute('tabindex') !== '-1') icon.setAttribute('tabindex', '-1');
    });
  }

  function labelForms(root) {
    root.querySelectorAll('input, select, textarea').forEach((element) => {
      if (element.type === 'hidden' || element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby')) return;
      if (element.id && Array.from(document.querySelectorAll('label[for]')).some((label) => label.htmlFor === element.id)) return;
      const wrapped = element.closest('label');
      if (wrapped && (wrapped.textContent || '').trim()) return;
      const label = contextLabel(element)
        || (element.getAttribute('placeholder') || '').trim()
        || (element.type === 'search' ? '搜索' : '')
        || (element.type === 'file' ? '选择文件' : '')
        || '输入内容';
      element.setAttribute('aria-label', label);
      element.dataset.a11yGeneratedLabel = 'true';
    });
  }

  function repairLandmarks(root) {
    root.querySelectorAll('.nut-navbar, .nut-tabbar').forEach((element) => {
      if (!element.hasAttribute('role')) element.setAttribute('role', 'navigation');
      if (!element.hasAttribute('aria-label')) {
        element.setAttribute('aria-label', element.classList.contains('nut-tabbar') ? '主要导航' : '页面导航');
      }
    });
    if (!document.querySelector('main, [role="main"]')) {
      const main = root.querySelector('.page-container, .main-content, .page-wrapper');
      if (main) main.setAttribute('role', 'main');
    }
  }

  function repairCollections(root) {
    root.querySelectorAll('.sub-list, .collection-list, .file-list').forEach((list) => {
      if (!list.hasAttribute('role')) list.setAttribute('role', 'list');
      list.querySelectorAll(':scope > .sub-item, :scope > .collection-item, :scope > .file-item').forEach((item) => {
        if (!item.hasAttribute('role')) item.setAttribute('role', 'listitem');
      });
    });
  }

  function repairImages(root) {
    root.querySelectorAll('img:not([alt])').forEach((image) => {
      const insideControl = image.closest('button, a[href], [role="button"]');
      image.alt = insideControl ? '' : (image.getAttribute('title') || '图片');
    });
  }

  function repairOverlays(root) {
    if (activeDialog && (!activeDialog.isConnected || isVisuallyHidden(activeDialog))) {
      if (dialogReturnTarget?.isConnected) dialogReturnTarget.focus();
      seenDialogs.delete(activeDialog);
      activeDialog = null;
      dialogReturnTarget = null;
    }
    root.querySelectorAll('.nut-popup, .nut-dialog, [role="dialog"]').forEach((dialog) => {
      if (isVisuallyHidden(dialog)) return;
      if (dialog.classList.contains('nut-popup')
        && Array.from(dialog.querySelectorAll('.nut-dialog')).some((inner) => !isVisuallyHidden(inner))) return;
      if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
        const heading = dialog.querySelector('h1, h2, h3, [class*="title"]');
        if (heading && (heading.textContent || '').trim()) {
          if (!heading.id) heading.id = `sub-store-a11y-heading-${++generatedId}`;
          dialog.setAttribute('aria-labelledby', heading.id);
        } else {
          dialog.setAttribute('aria-label', '对话框');
        }
      }
      if (!seenDialogs.has(dialog)) {
        seenDialogs.add(dialog);
        dialogReturnTarget = document.activeElement && document.activeElement !== document.body
          ? document.activeElement
          : null;
        activeDialog = dialog;
        const focusTarget = dialog.querySelector('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])');
        if (focusTarget) focusTarget.focus();
        else {
          dialog.tabIndex = -1;
          dialog.focus();
        }
      }
    });
    root.querySelectorAll('.nut-notify, .nut-toast, [class*="notice"]').forEach((status) => {
      if (!status.hasAttribute('role')) status.setAttribute('role', 'status');
      if (!status.hasAttribute('aria-live')) status.setAttribute('aria-live', 'polite');
    });
    root.querySelectorAll('.Toastify__close-button').forEach((button) => setControlLabel(button, '关闭通知'));
  }

  function repairCustomControls(root) {
    root.querySelectorAll('.nut-switch, [role="switch"]').forEach((control) => {
      control.setAttribute('role', 'switch');
      if (!control.hasAttribute('tabindex')) control.tabIndex = 0;
      if (!control.hasAttribute('aria-checked') || control.dataset.a11yGeneratedState === 'true') {
        const checked = control.classList.contains('nut-switch--active')
          || control.classList.contains('switch-open')
          || control.classList.contains('is-active');
        control.setAttribute('aria-checked', String(checked));
        control.dataset.a11yGeneratedState = 'true';
      }
      setControlLabel(control, contextLabel(control) || visibleText(control) || '开关');
    });
    root.querySelectorAll('.nut-checkbox, [role="checkbox"]').forEach((control) => {
      makeKeyboardControl(control, 'checkbox', visibleText(control) || contextLabel(control) || '选择项');
      const checked = control.classList.contains('nut-checkbox--checked')
        || Boolean(control.querySelector('.nut-checkbox__icon--checked:not(.nut-checkbox__icon--unchecked)'));
      if (!control.hasAttribute('aria-checked') || control.dataset.a11yGeneratedState === 'true') {
        control.setAttribute('aria-checked', String(checked));
        control.dataset.a11yGeneratedState = 'true';
      }
    });
    root.querySelectorAll('.nut-radiogroup, [role="radiogroup"]').forEach((group) => {
      group.setAttribute('role', 'radiogroup');
      setControlLabel(group, contextLabel(group) || '选项组');
    });
    root.querySelectorAll('.nut-radio, [role="radio"]').forEach((control) => {
      makeKeyboardControl(control, 'radio', visibleText(control) || contextLabel(control) || '选项');
      const checked = control.classList.contains('nut-radio--checked')
        || Boolean(control.querySelector('.nut-radio__button--active'));
      if (!control.hasAttribute('aria-checked') || control.dataset.a11yGeneratedState === 'true') {
        control.setAttribute('aria-checked', String(checked));
        control.dataset.a11yGeneratedState = 'true';
      }
    });
    root.querySelectorAll('[data-clickable]').forEach((control) => {
      if (!control.hasAttribute('role')) control.setAttribute('role', 'button');
      if (!control.hasAttribute('tabindex')) control.tabIndex = 0;
    });
    root.querySelectorAll('.menu-items').forEach((navigation) => {
      if (!navigation.hasAttribute('role')) navigation.setAttribute('role', 'navigation');
      if (!navigation.hasAttribute('aria-label')) navigation.setAttribute('aria-label', '主要导航');
    });
    root.querySelectorAll('.menu-item').forEach((item) => {
      const text = visibleText(item);
      const label = NAVIGATION_LABELS[text] || text;
      makeKeyboardControl(item, 'link', label);
      if (label && item.getAttribute('title') !== label) item.setAttribute('title', label);
      item.querySelectorAll('i, svg').forEach((icon) => {
        if (icon.getAttribute('aria-hidden') !== 'true') icon.setAttribute('aria-hidden', 'true');
      });
      if (item.classList.contains('active')) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });
    root.querySelectorAll('.nut-tabbar-item, .tabbar-item').forEach((item) => {
      const match = MOBILE_NAVIGATION_LABELS.find(([selector]) => item.querySelector(selector));
      if (!match) return;
      const label = match[1];
      makeKeyboardControl(item, 'link', label);
      if (item.getAttribute('title') !== label) item.setAttribute('title', label);
      item.querySelectorAll('i, svg').forEach((icon) => {
        if (icon.getAttribute('aria-hidden') !== 'true') icon.setAttribute('aria-hidden', 'true');
        if (icon.getAttribute('role') !== 'presentation') icon.setAttribute('role', 'presentation');
        if (icon.getAttribute('focusable') !== 'false') icon.setAttribute('focusable', 'false');
        if (icon.getAttribute('tabindex') !== '-1') icon.setAttribute('tabindex', '-1');
      });
      if (item.classList.contains('nut-tabbar-item__icon--unactive')) item.removeAttribute('aria-current');
      else item.setAttribute('aria-current', 'page');
    });
    root.querySelectorAll('.tag').forEach((tag) => {
      tag.setAttribute('role', 'button');
      if (!tag.hasAttribute('tabindex')) tag.tabIndex = 0;
      tag.removeAttribute('aria-pressed');
    });
    root.querySelectorAll('.list-title').forEach((title) => {
      const text = title.querySelector('.list-title-text');
      makeKeyboardControl(title, 'button', (text ? visibleText(text) : '') || visibleText(title));
      title.querySelectorAll('i, svg').forEach((icon) => {
        if (icon.getAttribute('aria-hidden') !== 'true') icon.setAttribute('aria-hidden', 'true');
      });
    });
    root.querySelectorAll('.nut-button, .nut-popup__close-icon').forEach((control) => {
      if (control.closest('button, a[href]')) return;
      if (control.closest('.nut-swipe__left, .nut-swipe__right')) return;
      makeKeyboardControl(control, 'button');
    });
    root.querySelectorAll('.sub-item-menu').forEach((group) => {
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', '订阅操作');
      group.removeAttribute('tabindex');
    });
    root.querySelectorAll('.nut-swipe__left, .nut-swipe__right').forEach((drawer) => {
      if (!drawer.querySelector('.sub-item-swipe-btn-wrapper, .sub-item-swipe-btn')) return;
      const actionHref = drawer.querySelector('a[href]')?.getAttribute('href') || '';
      const objectName = /\/api\/(?:wholeFile|file)\//i.test(actionHref)
        ? '文件'
        : /\/api\/collection\//i.test(actionHref)
          ? '组合订阅'
          : '订阅';
      drawer.setAttribute('role', 'group');
      drawer.setAttribute('aria-label', `${objectName}快捷操作`);
      drawer.querySelectorAll('.sub-item-swipe-btn-wrapper, .sub-item-swipe-btn').forEach((wrapper) => {
        const control = wrapper.querySelector('a, button, .nut-button');
        if (!control) return;
        if (!control.matches('a[href], button')) {
          control.setAttribute('role', 'button');
          if (!control.hasAttribute('tabindex')) control.tabIndex = 0;
        }
        if (control.querySelector('svg[data-icon="paste"]')) setControlLabel(control, `复制${objectName}配置`);
        if (control.querySelector('svg[data-icon="file-export"]')) setControlLabel(control, `导出${objectName}`);
        if (control.querySelector('svg[data-icon="trash-can"], svg[data-icon="trash"]')) setControlLabel(control, `删除${objectName}`);
      });
    });
    root.querySelectorAll('.auto-dialog li').forEach((item) => {
      const nameElement = item.querySelector('.infos p');
      const name = nameElement ? visibleText(nameElement) : '';
      if (!name) return;
      const preview = item.querySelector('.actions a[href]');
      const copy = item.querySelector('.actions button');
      if (preview) setControlLabel(preview, `预览 ${name} 输出`);
      if (copy) setControlLabel(copy, `复制 ${name} 链接`);
    });
    root.querySelectorAll('.compare-sub-link').forEach((control) => {
      if (control.querySelector('svg[data-icon="square-arrow-up-right"]')) {
        setControlLabel(control, '打开订阅服务页面');
        return;
      }
      if (control.querySelector('svg[data-icon="eye"]')) {
        control.removeAttribute('aria-labelledby');
        if (control.getAttribute('aria-label') !== '生成节点对比') control.setAttribute('aria-label', '生成节点对比');
        control.dataset.a11yGeneratedLabel = 'true';
        return;
      }
      if (!control.querySelector('svg[data-icon="ellipsis"], svg[data-icon="ellipsis-vertical"], svg[data-icon="angle-right"]')) return;
      const expanded = Boolean(control.querySelector('svg[data-icon="angle-right"]'));
      control.setAttribute('aria-expanded', String(expanded));
      setControlLabel(control, expanded ? '收起更多操作' : '展开更多操作');
    });
    root.querySelectorAll('button:has(svg[data-icon="angles-right"])').forEach((control) => {
      const expanded = /rotate\(180deg\)/.test(control.style.transform);
      control.setAttribute('aria-expanded', String(expanded));
      setControlLabel(control, expanded ? '收起复制、导出和删除操作' : '展开复制、导出和删除操作');
      const swipe = control.closest('.nut-swipe');
      const drawer = swipe?.querySelector('.nut-swipe__right');
      const content = swipe?.querySelector('.nut-swipe__content');
      if (!drawer) return;
      if (swipe?.dataset.a11yGeneratedOwns === 'true') {
        swipe.removeAttribute('aria-owns');
        delete swipe.dataset.a11yGeneratedOwns;
      }
      const originalActions = Array.from(drawer.querySelectorAll('.sub-item-swipe-btn-wrapper, .sub-item-swipe-btn'))
        .map((wrapper) => wrapper.querySelector('a, button, .nut-button'))
        .filter(Boolean);
      originalActions.forEach((action) => {
        if (action.dataset.a11yOriginalHref) {
          const originalHref = action.dataset.a11yOriginalHref;
          action.setAttribute('href', originalHref);
          delete action.dataset.a11yOriginalHref;
        }
        if (action.getAttribute('role') === 'none') action.removeAttribute('role');
      });
      swipe.querySelectorAll('.sub-store-a11y-drawer-actions').forEach((legacyProxy) => legacyProxy.remove());
      if (drawer.classList.contains('sub-store-a11y-drawer-hidden')) drawer.classList.remove('sub-store-a11y-drawer-hidden');
      const preview = content?.querySelector('.sub-item-detail, .sub-item-detail-isSimple');
      const wrapper = content?.querySelector('.sub-item-wrapper');
      const existingPreviewProxy = swipe.querySelector('.sub-store-a11y-preview-proxy');
      existingPreviewProxy?.remove();
      if (preview) {
        if (preview.classList.contains('sub-store-a11y-proxy-focus')) preview.classList.remove('sub-store-a11y-proxy-focus');
        if (preview.getAttribute('aria-hidden') === 'true') preview.removeAttribute('aria-hidden');
        const originalTabindex = preview.dataset.a11yPreviewTabindex;
        if (originalTabindex === '__none__') preview.removeAttribute('tabindex');
        else if (originalTabindex !== undefined) preview.setAttribute('tabindex', originalTabindex);
        delete preview.dataset.a11yPreviewTabindex;
      }
      if (expanded) {
        if (drawer.classList.contains('sub-store-a11y-drawer-collapsed')) {
          drawer.classList.remove('sub-store-a11y-drawer-collapsed');
        }
        if (preview && drawer.nextElementSibling !== preview) preview.before(drawer);
        if (wrapper && !wrapper.classList.contains('sub-store-a11y-drawer-inline')) {
          wrapper.classList.add('sub-store-a11y-drawer-inline');
        }
        if (drawer.hasAttribute('aria-hidden')) drawer.removeAttribute('aria-hidden');
        if (drawer.hasAttribute('inert')) drawer.removeAttribute('inert');
        originalActions.forEach((action) => {
          action.removeAttribute('aria-hidden');
          action.removeAttribute('inert');
          if (action.matches('a[href], button')) {
            if (action.getAttribute('tabindex') === '-1') action.removeAttribute('tabindex');
          } else if (action.getAttribute('tabindex') !== '0') {
            action.setAttribute('tabindex', '0');
          }
        });
      } else {
        if (!drawer.classList.contains('sub-store-a11y-drawer-collapsed')) {
          drawer.classList.add('sub-store-a11y-drawer-collapsed');
        }
        if (drawer.parentElement !== swipe) swipe.append(drawer);
        if (wrapper?.classList.contains('sub-store-a11y-drawer-inline')) {
          wrapper.classList.remove('sub-store-a11y-drawer-inline');
        }
        if (drawer.getAttribute('aria-hidden') !== 'true') drawer.setAttribute('aria-hidden', 'true');
        if (!drawer.hasAttribute('inert')) drawer.setAttribute('inert', '');
        originalActions.forEach((action) => {
          if (action.getAttribute('aria-hidden') !== 'true') action.setAttribute('aria-hidden', 'true');
          if (!action.hasAttribute('inert')) action.setAttribute('inert', '');
          if (action.getAttribute('tabindex') !== '-1') action.setAttribute('tabindex', '-1');
        });
      }
    });
    root.querySelectorAll('.cm-img-button button').forEach((control) => {
      const label = inferredLabel(control);
      if (label) setControlLabel(control, label);
      if (control.querySelector('img[src$="/images/more.svg"], img[src$="/more.svg"]')) {
        control.setAttribute('aria-expanded', String(Boolean(control.closest('.cm-img-button')?.querySelector(':scope > div'))));
      }
    });
    root.querySelectorAll('.include-subs-trigger, .failure-mode-trigger').forEach((control) => {
      makeKeyboardControl(control, 'button', inferredLabel(control));
    });
    root.querySelectorAll('.common-title-row > .title').forEach((control) => {
      makeKeyboardControl(control, 'button', `展开或收起${visibleText(control) || '配置'}`);
    });
    root.querySelectorAll('.action-btn, .nut-picker__left, .nut-picker__right').forEach((control) => {
      makeKeyboardControl(control, 'button');
    });
    root.querySelectorAll('.sticky-title-icon-container').forEach((control) => {
      makeKeyboardControl(control, 'button', '选择图标');
    });
    root.querySelectorAll('.label-with-tip').forEach((control) => {
      const text = visibleText(control);
      makeKeyboardControl(control, 'button', `查看${text || '字段'}说明`);
    });
    root.querySelectorAll('svg[data-icon="toggle-off"], svg[data-icon="toggle-on"]').forEach((control) => {
      if (control.closest('button, a[href], [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"]')) return;
      const context = visibleText(control.closest('.sticky-title-wrapper, .common-title-row'));
      makeKeyboardControl(control, 'button', context ? `展开或收起${context}` : '切换展开状态');
    });
    root.querySelectorAll('.sub-item-wrapper').forEach((wrapper) => {
      const detail = wrapper.querySelector('.sub-item-detail, .sub-item-detail-isSimple');
      const titleWrapper = wrapper.querySelector('.sub-item-title-wrapper');
      if (detail && titleWrapper && detail.parentElement === titleWrapper.parentElement
        && (detail.compareDocumentPosition(titleWrapper) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        detail.before(titleWrapper);
      }
      const titleElement = wrapper.querySelector('.sub-item-title');
      const title = titleElement ? visibleText(titleElement) : '';
      const source = detail ? visibleText(detail) : '';
      if (detail && title && /订阅/.test(source)) {
        makeKeyboardControl(detail, 'button', '预览/拷贝订阅');
        detail.removeAttribute('aria-description');
      }
      if (wrapper.querySelector('button, a[href]')) {
        wrapper.querySelectorAll('.sub-item-title-wrapper[role="link"], .sub-item-content[role="link"]').forEach((target) => {
          target.removeAttribute('role');
          target.removeAttribute('tabindex');
        });
        return;
      }
      const target = wrapper;
      if (!target) return;
      target.setAttribute('role', 'link');
      if (!target.hasAttribute('tabindex')) target.tabIndex = 0;
    });
    repairPointerControls(root);
  }

  function repairPointerControls(root) {
    root.querySelectorAll('view[class], div[class], span[class], p[class], svg[class], svg[data-icon], i[class]').forEach((control) => {
      if (control.closest('.nut-swipe__left, .nut-swipe__right')) return;
      const interactive = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [role="switch"], [role="checkbox"], [role="radio"]';
      if (control.matches(interactive)) return;
      if (control.closest(interactive)) return;
      if (control.querySelector(interactive)) return;
      if (getComputedStyle(control).cursor !== 'pointer') return;
      const parent = control.parentElement;
      if (parent && getComputedStyle(parent).cursor === 'pointer' && !parent.matches('body, main, [role="main"]')) return;
      makeKeyboardControl(control, 'button', visibleText(control) || contextLabel(control) || inferredLabel(control) || '操作按钮');
    });
  }

  function enhance(root) {
    if (!root?.querySelectorAll) return;
    repairLandmarks(root);
    repairCollections(root);
    repairImages(root);
    repairCustomControls(root);
    repairOverlays(root);
    labelForms(root);
    labelControls(root);
    ensureSkipLink();
  }

  function queueEnhancement() {
    if (enhancementQueued || typeof document === 'undefined') return;
    enhancementQueued = true;
    queueMicrotask(() => {
      enhancementQueued = false;
      enhance(document);
    });
  }

  function detect() {
    detectionQueued = false;
    if (isSubStore()) activate();
  }

  function queueDetection() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    if (detectionQueued || document.documentElement.dataset[ROOT_MARKER] === 'active') return;
    detectionQueued = true;
    queueMicrotask(detect);
  }

  queueDetection();
  document.addEventListener('DOMContentLoaded', queueDetection, { once: true });
  startupObserver = new MutationObserver(queueDetection);
  startupObserver.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => startupObserver?.disconnect(), 15000);
})();
