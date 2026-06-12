(function () {
  'use strict';

  const AI_ENDPOINT = 'https://settingly.onrender.com/api/search';
  const KEYWORDS = new Set([
    'settings', 'setting', 'preferences', 'preference', 'configuration', 'config',
    'options', 'option', 'account', 'profile', 'billing', 'team', 'workspace',
    'general', 'security', 'privacy', 'notification', 'notifications',
    'appearance', 'theme', 'language', 'advanced', 'integrations',
    'api', 'keys', 'tokens', 'members', 'users', 'roles',
    'permissions', 'admin', 'administration', 'dashboard',
    'subscription', 'plan', 'usage', 'data', 'export', 'import',
    'customize', 'personalize', 'my account', 'my profile',
    'password', 'authentication', '2fa', 'two-factor', 'mfa',
    'sign out', 'logout', 'login', 'build', 'deploy', 'domain',
    'ssl', 'certificate', 'dns', 'email', 'smtp', 'storage',
    'database', 'function', 'edge', 'runtime', 'environment',
    'variable', 'secret', 'webhook', 'cron', 'schedule',
    'analytics', 'monitor', 'logging', 'audit', 'activity',
  ]);

  const state = {
    overlay: null,
    input: null,
    resultsEl: null,
    footerCount: null,
    settings: [],
    filtered: [],
    selectedIdx: -1,
    isOpen: false,
    destroyed: false,
    aiQuery: '',
    aiResponse: '',
    aiLoading: false,
    aiMode: false,
    aiController: null,
  };

  /* ─── Cache ─── */

  const CACHE_PREFIX = 'sk-cache-';
  const MAX_CACHE = 200;

  function cacheKey() { return CACHE_PREFIX + window.location.hostname; }

  function loadCache() {
    try {
      const raw = localStorage.getItem(cacheKey());
      if (!raw) return [];
      const data = JSON.parse(raw);
      return Array.isArray(data.items) ? data.items : [];
    } catch { return []; }
  }

  function saveToCache(newItems) {
    try {
      const existing = loadCache();
      const merged = [...existing];

      for (const item of newItems) {
        if (item.type === 'input') continue;
        if (!item.href || item.href === '#' || item.href.startsWith('javascript:')) continue;

        const exists = merged.some(m => m.text === item.text && m.href === item.href);
        if (!exists) {
          merged.push({
            text: item.text,
            href: item.href,
            score: item.score,
            cachedPath: window.location.pathname,
            timestamp: Date.now(),
          });
        }
      }

      const trimmed = merged.slice(-MAX_CACHE);

      localStorage.setItem(cacheKey(), JSON.stringify({
        version: 1,
        items: trimmed,
        updated: Date.now(),
      }));
    } catch {}
  }

  /* ─── Discovery ─── */

  function getSectionLabel(el) {
    const role = el.getAttribute('role');
    if (role === 'group' || role === 'region' || role === 'navigation') {
      const label = el.getAttribute('aria-label');
      if (label && label.length < 60) return label.trim();
    }
    const heading = el.querySelector(':scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6, :scope > [role="heading"]');
    if (heading) {
      const text = (heading.textContent || '').trim();
      if (text && text.length < 60) return text;
    }
    const summary = el.querySelector(':scope > summary');
    if (summary) {
      const text = (summary.textContent || '').trim();
      if (text && text.length < 60) return text;
    }
    return '';
  }

  function getBreadcrumb(el, container) {
    const crumbs = [];
    let current = el.parentElement;
    let depth = 0;
    while (current && current !== container && current !== document.body && depth < 4) {
      const label = getSectionLabel(current);
      if (label) crumbs.unshift(label);
      depth++;
      current = current.parentElement;
    }
    return crumbs;
  }

  function findInputLabel(el) {
    let label = el.getAttribute('aria-label');
    if (label && label.trim()) return label.trim();

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const ref = document.getElementById(labelledby);
      if (ref) {
        const text = ref.textContent.trim();
        if (text) return text;
      }
    }

    const id = el.id;
    if (id) {
      const labelEl = document.querySelector('label[for="' + CSS.escape(id) + '"]');
      if (labelEl) {
        const text = labelEl.textContent.trim();
        if (text) return text.replace(el.value || '', '').trim();
      }
    }

    const parentLabel = el.closest('label');
    if (parentLabel) {
      const text = parentLabel.textContent.trim();
      if (text) return text.replace(el.value || '', '').trim();
    }

    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    return '';
  }

  function scanCurrentPage() {
    const items = [];
    const seenEls = new WeakSet();
    const navSelector = 'nav, header, aside, [role="navigation"], [role="menubar"], [role="menu"], [class*="sidebar"], [class*="nav"], [id*="sidebar"], [id*="nav"], [class*="menu"], [id*="menu"], footer';

    const clickables = document.querySelectorAll('a, button, [role="button"], [role="menuitem"], [role="tab"], [role="link"]');

    for (const el of clickables) {
      if (seenEls.has(el)) continue;
      seenEls.add(el);

      const text = (el.textContent || '').trim().slice(0, 120);
      if (!text) continue;

      const href = el.getAttribute('href') || '';
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      const displayText = (ariaLabel || text).slice(0, 100);
      if (displayText.length > 150) continue;

      const navContainer = el.closest(navSelector);
      const isInNav = !!navContainer;

      const t = displayText.toLowerCase();
      const hl = href.toLowerCase();
      const combined = t + ' ' + hl;
      let score = 0;

      for (const kw of KEYWORDS) {
        if (combined.includes(kw)) {
          score += 3;
          if (t.includes(kw)) score += 4;
          if (t === kw) score += 6;
        }
      }

      if (isInNav) score += 10;
      if (el.tagName === 'A' && hl) {
        score += 1;
        if (/setting|prefer|config|account|profile|billing|key|token|api|domain/.test(hl)) score += 3;
      }
      if (/setting|prefer|config|account/i.test(el.id)) score += 2;
      if (typeof el.className === 'string' && /setting|prefer|config|account/i.test(el.className)) score += 1;

      if (isInNav && score <= 0) score = 6;
      if (!isInNav && score <= 0) continue;

      const breadcrumb = isInNav ? getBreadcrumb(el, navContainer) : [];

      items.push({
        el,
        text: displayText,
        href,
        score,
        type: 'link',
        source: isInNav ? 'nav' : 'page',
        breadcrumb,
      });
    }

    const inputSelector = 'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]):not([type="image"]):not([type="color"]):not([type="range"]):not([type="date"]):not([type="time"]), select, textarea';
    const inputs = document.querySelectorAll(inputSelector);

    for (const el of inputs) {
      const label = findInputLabel(el);
      if (!label || label.length > 100) continue;

      const t = label.toLowerCase();
      let score = 0;
      for (const kw of KEYWORDS) {
        if (t.includes(kw)) {
          score += 2;
          if (t === kw) score += 4;
        }
      }
      for (const kw of KEYWORDS) {
        if (kw.length > 3 && t.includes(kw.substring(0, 3))) score += 1;
      }

      if (score <= 0) continue;
      score += 5;

      if (el.closest('form, section, .settings, .config, .form, [class*="setting"], [id*="setting"]')) {
        score += 3;
      }

      items.push({
        el,
        text: label.slice(0, 100),
        href: '',
        score,
        type: 'input',
        source: 'input',
        breadcrumb: [],
      });
    }

    return items;
  }

  function deduplicate(items) {
    const seen = new Set();
    return items.filter(item => {
      const key = item.text + '|' + (item.href || '') + '|' + item.type;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function scanPage() {
    const currentItems = scanCurrentPage();
    saveToCache(currentItems);

    const cachedItems = loadCache();
    const cachedWithScore = cachedItems.map(c => ({
      el: null,
      text: c.text,
      href: c.href,
      score: Math.round((c.score || 10) * 0.55),
      type: 'link',
      source: 'cached',
      breadcrumb: [],
      cachedPath: c.cachedPath,
    }));

    const merged = [...currentItems, ...cachedWithScore];
    const deduped = deduplicate(merged);
    deduped.sort((a, b) => b.score - a.score);
    return deduped.slice(0, 50);
  }

  /* ─── DOM building ─── */

  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'sk-overlay';

    overlay.innerHTML = `
      <div id="sk-backdrop"></div>
      <div id="sk-modal">
        <div id="sk-input-wrap">
          <svg id="sk-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input id="sk-input" type="text" placeholder="Search settings\u2026" autocomplete="off" spellcheck="false" />
          <span id="sk-input-shortcut">ESC</span>
        </div>
        <div id="sk-results"></div>
        <div id="sk-footer">
          <div class="sk-footer-group">
            <span class="sk-footer-hint"><span class="sk-key">\u2191</span><span class="sk-key">\u2193</span> navigate</span>
            <span class="sk-footer-hint"><span class="sk-key">\u21B5</span> select</span>
            <span class="sk-footer-hint"><span class="sk-key">esc</span> close</span>
          </div>
          <span id="sk-footer-count"></span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    state.overlay = overlay;
    state.input = overlay.querySelector('#sk-input');
    state.resultsEl = overlay.querySelector('#sk-results');
    state.footerCount = overlay.querySelector('#sk-footer-count');

    overlay.querySelector('#sk-backdrop').addEventListener('click', close);
  }

  /* ─── Icons & badges ─── */

  function getIconForItem(item) {
    const t = item.text.toLowerCase();
    const bc = (item.breadcrumb || []).join(' ').toLowerCase();
    const c = t + ' ' + bc;
    if (/setting|prefer|config/.test(c)) return '\u2699\uFE0F';
    if (/account|profile/.test(c)) return '\uD83D\uDC64';
    if (/billing|subscription|plan/.test(c)) return '\uD83D\uDCB3';
    if (/security|password|auth|2fa|login|logout/.test(c)) return '\uD83D\uDD12';
    if (/privacy/.test(c)) return '\uD83D\uDEE1\uFE0F';
    if (/notification/.test(c)) return '\uD83D\uDD14';
    if (/theme|appearance/.test(c)) return '\uD83C\uDFA8';
    if (/team|member|user|role|permission/.test(c)) return '\uD83D\uDC65';
    if (/api|key|token|integration/.test(c)) return '\uD83D\uDD11';
    if (/data|export|import/.test(c)) return '\uD83D\uDCE6';
    if (/language/.test(c)) return '\uD83C\uDF10';
    if (/advanced|developer/.test(c)) return '\uD83D\uDEE0\uFE0F';
    if (/webhook|cron|schedule/.test(c)) return '\uD83D\uDD17';
    if (/domain|dns|ssl|certificate/.test(c)) return '\uD83C\uDF0D';
    if (/build|deploy|environment|variable/.test(c)) return '\uD83D\uDCBB';
    if (/database|storage/.test(c)) return '\uD83D\uDDC4';
    if (/email|smtp/.test(c)) return '\u2709\uFE0F';
    if (/analytics|monitor|logging|audit/.test(c)) return '\uD83D\uDCCA';
    if (/input/.test(item.type)) return '\uD83D\uDD0D';
    return '\u2699\uFE0F';
  }

  function getBadgeForItem(item) {
    if (item.source === 'cached') return '';
    if (item.type === 'input') return '';
    if (item.breadcrumb && item.breadcrumb.length) return 'nav';
    if (item.source === 'nav') return 'nav';
    return '';
  }

  function getUrlPreview(item) {
    if (item.type === 'input') return '';
    if (item.cachedPath) return '';
    if (item.breadcrumb && item.breadcrumb.length) return '';
    try {
      const url = item.href;
      if (!url || url === '#' || url.startsWith('javascript:')) return '';
      const u = new URL(url, window.location.href);
      return u.pathname + u.search;
    } catch { return ''; }
  }

  /* ─── Rendering ─── */

  function renderResults(items) {
    state.resultsEl.innerHTML = '';

    if (!items.length) {
      state.resultsEl.innerHTML = '<div class="sk-empty">No settings found on this page</div>';
      state.footerCount.textContent = '';
      return;
    }

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = document.createElement('div');
      row.className = 'sk-item';
      row.dataset.idx = i;

      const breadcrumb = item.breadcrumb && item.breadcrumb.length > 0;
      const cachedPath = item.cachedPath;
      const urlPreview = getUrlPreview(item);
      const isInput = item.type === 'input';
      const badge = getBadgeForItem(item);

      if (item.type === 'ai-fallback') {
        row.className = 'sk-item sk-ai-fallback';
        row.innerHTML = `
          <div class="sk-item-icon">&#x1F50D;</div>
          <div class="sk-item-body">
            <div class="sk-item-text">Search for &quot;${escapeHTML(item.text)}&quot;</div>
          </div>
        `;
        row.addEventListener('click', () => selectItem(item));
        row.addEventListener('mousemove', () => {
          state.selectedIdx = i;
          highlightSelected(items);
        });
        state.resultsEl.appendChild(row);
        continue;
      }

      row.innerHTML = `
        <div class="sk-item-icon">${getIconForItem(item)}</div>
        <div class="sk-item-body">
          <div class="sk-item-text">${escapeHTML(item.text)}</div>
          ${isInput ? '<div class="sk-item-type">input field</div>' : ''}
          ${breadcrumb ? '<div class="sk-item-breadcrumb">' + escapeHTML(item.breadcrumb.join(' \u2192 ')) + '</div>' : ''}
          ${cachedPath ? '<div class="sk-item-path">' + escapeHTML(cachedPath) + '</div>' : ''}
          ${urlPreview ? '<div class="sk-item-url">' + escapeHTML(urlPreview) + '</div>' : ''}
        </div>
        ${badge ? '<span class="sk-item-badge">' + badge + '</span>' : ''}
      `;

      row.addEventListener('click', () => selectItem(item));
      row.addEventListener('mousemove', () => {
        state.selectedIdx = i;
        highlightSelected(items);
      });

      state.resultsEl.appendChild(row);
    }
  }

  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function highlightSelected(items) {
    const rows = state.resultsEl.querySelectorAll('.sk-item');
    rows.forEach(row => {
      const idx = parseInt(row.dataset.idx, 10);
      row.classList.toggle('selected', idx === state.selectedIdx);
      if (idx === state.selectedIdx) {
        row.scrollIntoView({ block: 'nearest' });
      }
    });
    updateFooterCount(items.length);
  }

  function updateFooterCount(total) {
    if (!state.footerCount) return;
    const query = state.input.value.trim();
    if (!query) {
      state.footerCount.textContent = total + ' settings';
    } else {
      state.footerCount.textContent = total + ' of ' + state.settings.length + ' settings';
    }
  }

  /* ─── AI Functions ─── */

  function fetchAIInstructions(query, domain, pageTitle) {
    if (state.aiLoading) return;
    state.aiQuery = query;
    state.aiResponse = '';
    state.aiLoading = true;
    state.aiMode = true;
    state.aiController = null;
    renderAIView();

    try {
      const port = chrome.runtime.connect({ name: 'ai-search' });
      state.aiController = port;

      port.onMessage.addListener((msg) => {
        if (msg.type === 'chunk') {
          state.aiResponse += msg.text;
          renderAIView();
        } else if (msg.type === 'error') {
          state.aiResponse = 'AI search failed.';
          state.aiLoading = false;
          renderAIView();
        } else if (msg.type === 'done') {
          state.aiLoading = false;
          renderAIView();
        }
      });

      port.onDisconnect.addListener(() => {
        if (state.aiLoading) {
          state.aiResponse = state.aiResponse || 'AI search failed.';
          state.aiLoading = false;
          renderAIView();
        }
      });

      port.postMessage({ query, domain, pageTitle });
    } catch (err) {
      state.aiResponse = 'Error: ' + err.message;
      state.aiLoading = false;
      renderAIView();
    }
  }

  function renderAIView() {
    state.resultsEl.innerHTML = '';
    state.footerCount.textContent = '';
    const container = document.createElement('div');
    container.className = 'sk-ai-view';
    const header = document.createElement('div');
    header.className = 'sk-ai-header';
    header.innerHTML = `
      <button class="sk-back-btn">&larr; Back</button>
      <span class="sk-ai-badge">AI</span>
      <span class="sk-ai-query">&#x1F50D; ${escapeHTML(state.aiQuery)}</span>
    `;
    header.querySelector('.sk-back-btn').addEventListener('click', backToResults);
    const content = document.createElement('div');
    content.className = 'sk-ai-content';
    if (state.aiLoading && !state.aiResponse) {
      content.innerHTML = '<div class="sk-ai-loading"><span></span><span></span><span></span></div>';
    } else if (state.aiResponse) {
      content.innerHTML = formatAIResponse(state.aiResponse);
      if (state.aiLoading) {
        content.innerHTML += '<div class="sk-ai-loading"><span></span><span></span><span></span></div>';
      }
    }
    container.appendChild(header);
    container.appendChild(content);
    state.resultsEl.appendChild(container);
  }

  function formatAIResponse(text) {
    return text.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '<br>';
      if (/^\d+[\.\)]/.test(trimmed)) {
        return '<div class="sk-ai-step">' + escapeHTML(trimmed) + '</div>';
      }
      return '<div class="sk-ai-line">' + escapeHTML(trimmed) + '</div>';
    }).join('');
  }

  function backToResults() {
    state.aiMode = false;
    state.aiResponse = '';
    state.aiQuery = '';
    if (state.aiController) {
      state.aiController.disconnect();
      state.aiController = null;
    }
    state.input.value = '';
    state.filtered = [...state.settings];
    state.selectedIdx = state.filtered.length > 0 ? 0 : -1;
    if (state.isOpen) {
      renderResults(state.filtered);
      highlightSelected(state.filtered);
      updateFooterCount(state.filtered.length);
    }
  }

  /* ─── Selection ─── */

  function selectItem(item) {
    if (item.type === 'ai-fallback') {
      fetchAIInstructions(item.text, window.location.hostname, document.title);
      return;
    }
    close();
    if (item.type === 'input' && item.el) {
      item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(() => { try { item.el.focus(); } catch {} }, 300);
      return;
    }
    if (item.el) {
      try { item.el.click(); }
      catch {
        const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
        item.el.dispatchEvent(evt);
      }
    } else if (item.href) {
      window.location.href = item.href;
    }
  }

  /* ─── Search / filter ─── */

  function filterItems(query) {
    const q = query.toLowerCase().trim();
    if (!q) {
      state.filtered = [...state.settings];
      state.selectedIdx = state.filtered.length > 0 ? 0 : -1;
      renderResults(state.filtered);
      highlightSelected(state.filtered);
      return;
    }

    const scored = state.settings.map(item => {
      const t = item.text.toLowerCase();
      const bc = (item.breadcrumb || []).join(' ').toLowerCase();
      const cp = (item.cachedPath || '').toLowerCase();
      const combined = t + ' ' + bc + ' ' + cp;
      let score = 0;

      if (combined === q) score += 100;
      else if (combined.startsWith(q)) score += 50;
      else if (combined.includes(' ' + q)) score += 30;
      else if (combined.includes(q)) score += 10;

      for (const kw of KEYWORDS) {
        if (kw.startsWith(q) && combined.includes(kw)) score += 15;
      }
      return { item, score };
    });

    const matched = scored.filter(s => s.score > 0);
    matched.sort((a, b) => b.score - a.score);
    state.filtered = matched.map(s => s.item);

    if (state.filtered.length === 0 && q) {
      state.filtered = [{
        text: q,
        score: 0,
        type: 'ai-fallback',
        source: 'ai',
        href: '',
        breadcrumb: [],
        el: null,
      }];
      state.selectedIdx = 0;
    } else {
      state.selectedIdx = state.filtered.length > 0 ? 0 : -1;
    }

    renderResults(state.filtered);
    highlightSelected(state.filtered);
  }

  /* ─── Open / Close ─── */

  function open() {
    if (state.isOpen || state.destroyed) return;
    if (state.aiController) {
      state.aiController.disconnect();
      state.aiController = null;
    }
    state.aiMode = false;
    state.aiResponse = '';
    state.aiQuery = '';
    state.aiLoading = false;

    state.settings = scanPage();

    if (state.settings.length === 0) {
      state.overlay.classList.add('open');
      state.isOpen = true;
      renderResults([]);
      updateFooterCount(0);
      requestAnimationFrame(() => state.input.focus());

      setTimeout(() => {
        if (!state.isOpen) return;
        state.settings = scanPage();
        if (state.settings.length > 0) {
          state.filtered = [...state.settings];
          state.selectedIdx = 0;
          renderResults(state.filtered);
          highlightSelected(state.filtered);
        }
      }, 800);

      setTimeout(() => {
        if (!state.isOpen) return;
        const second = scanPage();
        if (second.length > state.settings.length) {
          state.settings = second;
          state.filtered = [...state.settings];
          state.selectedIdx = state.settings.length > 0 ? 0 : -1;
          renderResults(state.filtered);
          highlightSelected(state.filtered);
        }
      }, 2500);

      return;
    }

    state.filtered = [...state.settings];
    state.selectedIdx = state.settings.length > 0 ? 0 : -1;
    state.input.value = '';
    state.overlay.classList.add('open');
    state.isOpen = true;
    renderResults(state.filtered);
    highlightSelected(state.filtered);
    requestAnimationFrame(() => state.input.focus());
  }

  function close() {
    if (!state.isOpen) return;
    if (state.aiController) {
      state.aiController.disconnect();
      state.aiController = null;
    }
    state.aiMode = false;
    state.aiResponse = '';
    state.aiQuery = '';
    state.aiLoading = false;
    state.overlay.classList.remove('open');
    state.isOpen = false;
    state.input.blur();
  }

  /* ─── Keyboard ─── */

  function onKeyDown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      e.stopPropagation();
      if (state.isOpen) close();
      else open();
      return;
    }
    if (!state.isOpen) return;

    if (state.aiMode) {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (state.filtered.length > 0) {
          state.selectedIdx = (state.selectedIdx + 1) % state.filtered.length;
          highlightSelected(state.filtered);
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (state.filtered.length > 0) {
          state.selectedIdx = (state.selectedIdx - 1 + state.filtered.length) % state.filtered.length;
          highlightSelected(state.filtered);
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (state.selectedIdx >= 0 && state.selectedIdx < state.filtered.length) {
          selectItem(state.filtered[state.selectedIdx]);
        }
        break;
      case 'Tab':
        e.preventDefault();
        if (state.filtered.length > 0) {
          state.selectedIdx = e.shiftKey
            ? (state.selectedIdx - 1 + state.filtered.length) % state.filtered.length
            : (state.selectedIdx + 1) % state.filtered.length;
          highlightSelected(state.filtered);
        }
        break;
    }
  }

  /* ─── Init ─── */

  function init() {
    if (document.body) buildOverlay();
    else document.addEventListener('DOMContentLoaded', buildOverlay);
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('input', function (e) {
      if (e.target === state.input) filterItems(state.input.value);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
