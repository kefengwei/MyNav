/* =========================================================
   MyNav 前端逻辑 · 零依赖
   数据来自 data/links.js（window.NAV_DATA）
   ========================================================= */
(function () {
  'use strict';

  var DATA = window.NAV_DATA;
  var THEME_KEY = 'mynav:theme';
  var THEMES = ['auto', 'light', 'dark'];

  var el = {
    title: document.getElementById('site-title'),
    subtitle: document.getElementById('site-subtitle'),
    search: document.getElementById('search'),
    themeBtn: document.getElementById('theme-toggle'),
    catnav: document.getElementById('catnav'),
    catnavBar: document.getElementById('catnav-bar'),
    sidebar: document.getElementById('sidebar'),
    catnavPrev: document.getElementById('catnav-prev'),
    catnavNext: document.getElementById('catnav-next'),
    content: document.getElementById('content'),
    empty: document.getElementById('empty'),
    footerMeta: document.getElementById('footer-meta'),
    searchBox: document.getElementById('search-box'),
    scopeBtn: document.getElementById('scope-btn'),
    scopeIcon: document.getElementById('scope-icon'),
    scopeMenu: document.getElementById('scope-menu'),
    searchGo: document.getElementById('search-go'),
    cmdk: document.getElementById('cmdk'),
    cmdkInput: document.getElementById('cmdk-input'),
    cmdkList: document.getElementById('cmdk-list'),
    cmdkEmpty: document.getElementById('cmdk-empty'),
    cmdkCount: document.getElementById('cmdk-count'),
    favSection: document.getElementById('fav-section'),
    favGroups: document.getElementById('fav-groups'),
    favTotal: document.getElementById('fav-total')
  };

  if (!DATA || !Array.isArray(DATA.categories)) {
    el.content.innerHTML = '<p class="loading">找不到 data/links.js，或 window.NAV_DATA 格式不正确。</p>';
    console.warn('[MyNav] window.NAV_DATA 缺失或格式错误');
    return;
  }

  /* ---------- 数据规范化 ---------- */
  var meta = DATA.meta || {};
  var categories = DATA.categories.map(function (cat, ci) {
    var links = (cat.links || []).filter(function (l) { return l && l.url; }).map(function (l) {
      var tags = Array.isArray(l.tags) ? l.tags : (l.tags ? [l.tags] : []);
      var link = {
        name: String(l.name || l.url),
        url: String(l.url),
        desc: l.desc ? String(l.desc) : '',
        icon: l.icon ? String(l.icon) : '',
        tags: tags.map(String),
        keywords: l.keywords ? String(l.keywords) : ''
      };
      link._hay = [link.name, link.url, link.desc, link.tags.join(' '), link.keywords]
        .join(' ').toLowerCase();
      return link;
    });
    return {
      id: cat.id || ('cat-' + ci),
      name: cat.name || ('分类 ' + (ci + 1)),
      type: cat.type === 'fav' ? 'fav' : 'nav',
      links: links
    };
  }).filter(function (cat) { return cat.links.length > 0; });

  var totalLinks = categories.reduce(function (n, c) { return n + c.links.length; }, 0);

  // 扁平化：给模糊搜索和快速面板用，附带小写字段避免每次重复转换
  var entries = [];
  categories.forEach(function (cat) {
    cat.links.forEach(function (link) {
      entries.push({
        link: link,
        url: link.url,
        name: link.name,
        desc: link.desc,
        catName: cat.name,
        catId: cat.id,
        nameL: link.name.toLowerCase(),
        urlL: link.url.toLowerCase(),
        descL: link.desc.toLowerCase(),
        tagsL: link.tags.join(' ').toLowerCase(),
        kwL: link.keywords.toLowerCase(),
        catL: cat.name.toLowerCase(),
        nameInit: initialsOf(link.name.toLowerCase())
      });
    });
  });

  /* ---------- 文档标题与页脚 ---------- */
  if (meta.title) {
    el.title.textContent = meta.title;
    document.title = meta.title + (meta.subtitle ? ' · ' + meta.subtitle : '');
  }
  if (meta.subtitle) el.subtitle.textContent = meta.subtitle;

  var footerParts = ['共 ' + totalLinks + ' 个链接', categories.length + ' 个分类'];
  if (meta.updated) footerParts.push('更新于 ' + meta.updated);
  el.footerMeta.textContent = footerParts.join(' · ');

  /* ---------- 工具函数 ---------- */
  // 所有分类统一用同一个文件夹图标，收藏夹类只靠 chip 的虚线边框区分
  var SVG_NS = 'http://www.w3.org/2000/svg';
  var FOLDER_D = 'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2';

  function folderIcon(cls) {
    var svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', cls);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    var p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', FOLDER_D);
    svg.appendChild(p);
    return svg;
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return ''; }
  }

  // 稳定哈希 -> 色相，用于无图标时生成首字母色块
  function hashHue(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) % 360;
    }
    return h;
  }

  function isImageIcon(icon) {
    return /^(https?:|data:image\/|\.\/|\/|assets\/|data\/|icons\/)/i.test(icon);
  }

  // 把文本按搜索词切分并高亮，返回节点数组
  function highlightedNodes(text, terms) {
    if (!terms.length) return [document.createTextNode(text)];
    var lower = text.toLowerCase();
    var ranges = [];
    terms.forEach(function (term) {
      var from = 0;
      var found = false;
      while (true) {
        var idx = lower.indexOf(term, from);
        if (idx === -1) break;
        ranges.push([idx, idx + term.length]);
        from = idx + term.length;
        found = true;
      }
      // 精确无命中（模糊/子序列命中）时逐字符标记，避免出现"命中了却没有任何高亮"
      if (!found && term.length > 1 && term.length <= lower.length) {
        var pos = 0;
        for (var i = 0; i < term.length; i++) {
          var at = lower.indexOf(term.charAt(i), pos);
          if (at === -1) break;
          ranges.push([at, at + 1]);
          pos = at + 1;
        }
      }
    });
    if (!ranges.length) return [document.createTextNode(text)];

    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [];
    ranges.forEach(function (r) {
      var last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    });

    var out = [];
    var pos = 0;
    merged.forEach(function (r) {
      if (r[0] > pos) out.push(document.createTextNode(text.slice(pos, r[0])));
      var mark = document.createElement('mark');
      mark.textContent = text.slice(r[0], r[1]);
      out.push(mark);
      pos = r[1];
    });
    if (pos < text.length) out.push(document.createTextNode(text.slice(pos)));
    return out;
  }

  /* ---------- 卡片渲染 ---------- */
  function buildIcon(link) {
    var box = document.createElement('span');
    box.className = 'card-icon';

    if (link.icon && isImageIcon(link.icon)) {
      var img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.src = link.icon;
      img.addEventListener('error', function () {
        box.textContent = '';
        paintFallback(box, link.name);
      });
      box.appendChild(img);
      return box;
    }
    if (link.icon) {
      box.textContent = link.icon;
      box.style.background = 'var(--bg-soft)';
      box.style.color = 'var(--text)';
      return box;
    }
    paintFallback(box, link.name);
    return box;
  }

  function paintFallback(box, name) {
    var ch = (name.trim()[0] || '?').toUpperCase();
    var hue = hashHue(name);
    box.textContent = ch;
    box.style.background = 'linear-gradient(135deg, hsl(' + hue + ' 62% 52%), hsl(' + ((hue + 36) % 360) + ' 66% 44%))';
    box.style.color = '#fff';
  }

  function buildCard(link, terms, idx) {
    var a = document.createElement('a');
    a.className = 'card';
    if (typeof idx === 'number') a.style.setProperty('--i', String(idx));
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = link.name + '\n' + link.url + (link.desc ? '\n' + link.desc : '');

    a.appendChild(buildIcon(link));

    var body = document.createElement('span');
    body.className = 'card-body';

    var name = document.createElement('span');
    name.className = 'card-name';
    highlightedNodes(link.name, terms).forEach(function (n) { name.appendChild(n); });
    body.appendChild(name);

    if (link.desc) {
      var desc = document.createElement('span');
      desc.className = 'card-desc';
      desc.textContent = link.desc;
      body.appendChild(desc);
    }

    var host = hostOf(link.url);
    if (host && !link.desc) {
      var hostEl = document.createElement('span');
      hostEl.className = 'card-host';
      hostEl.textContent = host;
      body.appendChild(hostEl);
    }

    a.appendChild(body);
    return a;
  }

  /* ---------- 分类导航 ---------- */

  function renderNav(visibleCats) {
    el.catnav.textContent = '';
    var inner = document.createElement('div');
    inner.className = 'catnav-inner';

    visibleCats.forEach(function (cat, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cat-chip' + (idx === 0 ? ' is-active' : '') + (cat.type === 'fav' ? ' is-fav' : '');
      btn.dataset.target = cat.id;
      if (cat.type === 'fav') btn.title = '收藏夹分类';

      btn.appendChild(folderIcon('cat-ico'));
      btn.appendChild(document.createTextNode(cat.name));

      var count = document.createElement('span');
      count.className = 'count';
      count.textContent = cat.links.length;
      btn.appendChild(count);

      btn.addEventListener('click', function () {
        setActiveChip(cat.id);
        // 平滑滚动期间锁定高亮，否则 scrollspy 会在途中改到别的分类
        spyLockUntil = Date.now() + 800;
        var target = document.getElementById(cat.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });

      inner.appendChild(btn);
    });

    el.catnav.appendChild(inner);
    if (el.catnavBar) el.catnavBar.hidden = visibleCats.length === 0;
    lastActiveChipId = null;
    updateCatnavScrollState();
  }

  function setActiveChip(id) {
    var chips = el.catnav.querySelectorAll('.cat-chip');
    var hit = null;
    for (var i = 0; i < chips.length; i++) {
      var on = chips[i].dataset.target === id;
      chips[i].classList.toggle('is-active', on);
      if (on) hit = chips[i];
    }
    if (hit && lastActiveChipId !== id) ensureChipVisible(hit);
    lastActiveChipId = id;
  }

  /* ---------- 分类栏横向滚动：分类多到一屏放不下时 ---------- */
  var lastActiveChipId = null;
  var catnavTick = false;
  var navReduceMQ = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };

  // 显式传 behavior 会盖过 CSS 的 prefers-reduced-motion，所以这里自己判断
  function navBehavior() { return navReduceMQ.matches ? 'auto' : 'smooth'; }

  function updateCatnavScrollState() {
    var n = el.catnav;
    if (!n || !n.clientWidth) return;
    // 宽屏是左侧纵向列表，没有横向溢出这回事
    if (isVerticalNav()) {
      n.removeAttribute('data-fade');
      if (el.catnavPrev) el.catnavPrev.hidden = true;
      if (el.catnavNext) el.catnavNext.hidden = true;
      return;
    }
    var max = n.scrollWidth - n.clientWidth;
    var canScroll = max > 1;
    var atStart = n.scrollLeft <= 1;
    var atEnd = n.scrollLeft >= max - 1;
    var fade = (canScroll && !atStart ? 'l ' : '') + (canScroll && !atEnd ? 'r' : '');
    fade = fade.trim();
    if (fade) n.setAttribute('data-fade', fade);
    else n.removeAttribute('data-fade');
    if (el.catnavPrev) el.catnavPrev.hidden = !(canScroll && !atStart);
    if (el.catnavNext) el.catnavNext.hidden = !(canScroll && !atEnd);
  }

  function scrollCatnavBy(dir) {
    var n = el.catnav;
    if (!n) return;
    n.scrollBy({ left: dir * Math.max(180, n.clientWidth * 0.7), behavior: navBehavior() });
  }

  // 宽屏是左侧纵向列表（滚动容器是 .sidebar），窄屏是顶部横向条（容器是 .catnav）
  function isVerticalNav() {
    var inner = el.catnav && el.catnav.firstElementChild;
    if (!inner) return true;
    try { return window.getComputedStyle(inner).flexDirection.indexOf('column') !== -1; } catch (e) { return true; }
  }

  // 让当前选中的标签留在可视区中间（分类被挤出屏幕时自动跟随）
  function ensureChipVisible(chip) {
    var n = el.catnav;
    if (!n || !chip) return;
    var pad = 16;

    if (isVerticalNav()) {
      var box = el.sidebar || n;
      var vmax = box.scrollHeight - box.clientHeight;
      if (vmax <= 1) return;
      var c0 = chip.getBoundingClientRect();
      var b0 = box.getBoundingClientRect();
      if (c0.top >= b0.top + pad && c0.bottom <= b0.bottom - pad) return;
      var vt = box.scrollTop + (c0.top - b0.top) - (b0.height - c0.height) / 2;
      box.scrollTo({ top: Math.max(0, Math.min(vmax, vt)), behavior: navBehavior() });
      return;
    }

    var max = n.scrollWidth - n.clientWidth;
    if (max <= 1) return;
    var cr = chip.getBoundingClientRect();
    var nr = n.getBoundingClientRect();
    var padX = 56;
    if (cr.left >= nr.left + padX && cr.right <= nr.right - padX) return;
    var target = n.scrollLeft + (cr.left - nr.left) - (nr.width - cr.width) / 2;
    n.scrollTo({ left: Math.max(0, Math.min(max, target)), behavior: navBehavior() });
  }

  function onCatnavScroll() {
    if (catnavTick) return;
    catnavTick = true;
    window.requestAnimationFrame(function () { catnavTick = false; updateCatnavScrollState(); });
  }

  function bindCatnav() {
    if (el.catnav) {
      el.catnav.addEventListener('scroll', onCatnavScroll, { passive: true });
      // Tab 到标签栏后可用方向键翻（纵向翻 sidebar，横向翻 catnav）
      el.catnav.addEventListener('keydown', function (e) {
        var forward = e.key === 'ArrowRight' || e.key === 'ArrowDown';
        var back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
        if (!forward && !back) return;
        e.preventDefault();
        if (isVerticalNav()) {
          var box = el.sidebar || el.catnav;
          box.scrollBy({ top: (forward ? 1 : -1) * Math.max(120, box.clientHeight * 0.6), behavior: navBehavior() });
        } else {
          scrollCatnavBy(forward ? 1 : -1);
        }
      });
    }
    if (el.catnavPrev) el.catnavPrev.addEventListener('click', function () { scrollCatnavBy(-1); });
    if (el.catnavNext) el.catnavNext.addEventListener('click', function () { scrollCatnavBy(1); });
    window.addEventListener('resize', onCatnavScroll, { passive: true });
    // 字体加载完宽度会变，重算一次溢出状态
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () { updateCatnavScrollState(); });
    }
  }

  // 滚动高亮：基准线取 sticky 栏下沿（与 .section/.fav-group 的 scroll-margin-top 对齐）。
  // 不用 IntersectionObserver：观察区判定会让"上一段只剩底部露头"时高亮滞后一格。
  function activeChipId() {
    var all = document.querySelectorAll('.section, .fav-group');
    if (!all.length) return null;
    var horizontal = window.matchMedia && window.matchMedia('(max-width: 900px)').matches;
    var topH = 64;
    try { topH = parseInt(window.getComputedStyle(document.documentElement).getPropertyValue('--topbar-h'), 10) || 64; } catch (e) {}
    // 窄屏基准线要越过顶栏 + 横向标签栏；宽屏只有顶栏
    var line = topH + (horizontal ? 66 : 24);
    var current = all[0];
    for (var i = 0; i < all.length; i++) {
      if (all[i].getBoundingClientRect().top <= line) current = all[i];
      else break;
    }
    // 滚到页面底部时，最后一段可能顶不到基准线，兜底高亮最后一个
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      current = all[all.length - 1];
    }
    return current.id;
  }

  function updateActiveChip() {
    if (Date.now() < spyLockUntil) return;
    var id = activeChipId();
    if (id) setActiveChip(id);
  }

  var spyLockUntil = 0;
  var spyTick = false;
  function onScrollSpy() {
    if (spyTick) return;
    spyTick = true;
    window.requestAnimationFrame(function () { spyTick = false; updateActiveChip(); });
  }

  function observeSections() {
    updateActiveChip();
  }

  function bindScrollSpy() {
    window.addEventListener('scroll', onScrollSpy, { passive: true });
    window.addEventListener('resize', onScrollSpy, { passive: true });
  }

  /* ---------- 主渲染 ---------- */
  function buildSection(cat, terms) {
    var section = document.createElement('section');
    section.className = 'section';
    section.id = cat.id;

    var head = document.createElement('div');
    head.className = 'section-head';

    var h2 = document.createElement('h2');
    h2.className = 'section-title';
    h2.appendChild(folderIcon('cat-ico'));
    h2.appendChild(document.createTextNode(cat.name));

    var count = document.createElement('span');
    count.className = 'section-count';
    count.textContent = cat.links.length;

    head.appendChild(h2);
    head.appendChild(count);
    section.appendChild(head);

    var grid = document.createElement('div');
    grid.className = 'grid';
    cat.links.forEach(function (link, i) { grid.appendChild(buildCard(link, terms, i)); });
    section.appendChild(grid);
    return section;
  }

  /* ---------- 收藏夹：紧凑单行条目 ---------- */
  function buildFavItem(link, terms) {
    var a = document.createElement('a');
    a.className = 'fav-item';
    a.href = link.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.title = link.name + (link.desc ? '\n' + link.desc : '') + '\n' + link.url;

    var icon = buildIcon(link);
    icon.classList.add('fav-icon');
    a.appendChild(icon);

    var name = document.createElement('span');
    name.className = 'fav-name';
    highlightedNodes(link.name, terms).forEach(function (n) { name.appendChild(n); });
    a.appendChild(name);

    var host = hostOf(link.url);
    if (host) {
      var h = document.createElement('span');
      h.className = 'fav-host';
      h.textContent = host;
      a.appendChild(h);
    }
    return a;
  }

  function renderFav(favCats, terms) {
    if (!favCats.length) {
      el.favSection.hidden = true;
      return;
    }
    var total = 0;
    favCats.forEach(function (c) { total += c.links.length; });
    el.favTotal.textContent = total + ' 条';
    el.favSection.hidden = false;

    var frag = document.createDocumentFragment();
    favCats.forEach(function (cat) {
      var group = document.createElement('div');
      group.className = 'fav-group';
      group.id = cat.id;

      var head = document.createElement('h3');
      head.className = 'fav-group-head';
      head.appendChild(folderIcon('cat-ico'));
      head.appendChild(document.createTextNode(cat.name));

      var count = document.createElement('span');
      count.className = 'fav-group-count';
      count.textContent = cat.links.length;
      head.appendChild(count);

      group.appendChild(head);

      var grid = document.createElement('div');
      grid.className = 'fav-grid';
      cat.links.forEach(function (link) { grid.appendChild(buildFavItem(link, terms)); });
      group.appendChild(grid);

      frag.appendChild(group);
    });
    el.favGroups.appendChild(frag);
  }

  function render(terms) {
    el.content.textContent = '';
    el.favGroups.textContent = '';
    el.content.classList.toggle('is-filtering', terms.length > 0);

    var navCats = [];
    var favCats = [];
    categories.forEach(function (cat) {
      var hits = terms.length
        ? cat.links.filter(function (l) { return terms.every(function (t) { return l._hay.indexOf(t) !== -1; }); })
        : cat.links;
      if (!hits.length) return;
      var view = { id: cat.id, name: cat.name, type: cat.type, links: hits };
      if (cat.type === 'fav') favCats.push(view);
      else navCats.push(view);
    });

    renderNav(navCats.concat(favCats));

    var frag = document.createDocumentFragment();
    navCats.forEach(function (cat) { frag.appendChild(buildSection(cat, terms)); });
    el.content.appendChild(frag);

    renderFav(favCats, terms);

    var noResult = navCats.length === 0 && favCats.length === 0;
    el.empty.hidden = !noResult;
    el.content.hidden = noResult || navCats.length === 0;

    if (!noResult) observeSections();
  }

  /* ---------- 搜索范围（站内 / 外部引擎） ---------- */
  var SCOPE_KEY = 'mynav:scope';
  var SCOPES = {
    site:   { icon: '🔍', label: '站内搜索', ph: '搜索名称、网址、标签…', url: '' },
    google: { icon: '🌐', label: 'Google',   ph: '在 Google 中搜索…',    url: 'https://www.google.com/search?q=' },
    bing:   { icon: '🔎', label: 'Bing',     ph: '在 Bing 中搜索…',      url: 'https://www.bing.com/search?q=' },
    baidu:  { icon: '🐾', label: '百度',     ph: '在百度中搜索…',        url: 'https://www.baidu.com/s?wd=' }
  };

  function currentScope() {
    var s = '';
    try { s = localStorage.getItem(SCOPE_KEY) || ''; } catch (e) { /* 忽略 */ }
    return SCOPES[s] ? s : 'site';
  }

  function applyScope(name) {
    var scope = SCOPES[name] ? name : 'site';
    try { localStorage.setItem(SCOPE_KEY, scope); } catch (e) { /* 忽略 */ }

    el.scopeIcon.textContent = SCOPES[scope].icon;
    el.search.placeholder = SCOPES[scope].ph;
    el.searchGo.title = SCOPES[scope].url ? ('在 ' + SCOPES[scope].label + ' 中搜索') : '打开第一个结果';

    if (scope !== 'site') {
      el.search.value = '';
      render([]);
    }

    var btns = el.scopeMenu.querySelectorAll('[data-scope]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-checked', btns[i].dataset.scope === scope ? 'true' : 'false');
    }
    return scope;
  }

  function toggleScopeMenu(open) {
    var willOpen = typeof open === 'boolean' ? open : el.scopeMenu.hidden;
    el.scopeMenu.hidden = !willOpen;
    el.scopeBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  }

  /* ---------- 最近访问 ---------- */
  var RECENT_KEY = 'mynav:recent';
  var RECENT_MAX = 8;

  function readRecent() {
    try {
      var v = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return Array.isArray(v) ? v.filter(function (u) { return typeof u === 'string'; }) : [];
    } catch (e) { return []; }
  }

  function pushRecent(url) {
    var list = readRecent().filter(function (u) { return u !== url; });
    list.unshift(url);
    list = list.slice(0, RECENT_MAX);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* 忽略 */ }
  }

  function recentEntries() {
    var byUrl = {};
    entries.forEach(function (e) { byUrl[e.url] = e; });
    return readRecent().map(function (u) { return byUrl[u]; }).filter(Boolean);
  }

  function openEntry(item) {
    if (!item || !item.url) return;
    pushRecent(item.url);
    window.open(item.url, '_blank', 'noopener');
  }

  /* ---------- 模糊匹配 ---------- */
  // 取每段词的首字母："unreal engine 文档" -> "ue文"
  function initialsOf(text) {
    var parts = String(text || '').split(/[^0-9a-zA-Z\u4e00-\u9fff]+/);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      if (parts[i]) out += parts[i].charAt(0);
    }
    return out;
  }

  function isSubsequence(q, hay) {
    var pos = 0;
    for (var i = 0; i < q.length; i++) {
      var at = hay.indexOf(q.charAt(i), pos);
      if (at === -1) return false;
      pos = at + 1;
    }
    return true;
  }

  function subsequenceScore(q, hay) {
    var score = 0;
    var pos = 0;
    var last = -2;
    for (var i = 0; i < q.length; i++) {
      var at = hay.indexOf(q.charAt(i), pos);
      if (at === -1) return -1;
      score += (at === last + 1) ? 14 : 6;
      last = at;
      pos = at + 1;
    }
    return score;
  }

  // 命中开头 > 命中中间 > 词首缩写（ue -> Unreal Engine）> 长词子序列（ghb -> GitHub）
  function fuzzyScore(q, hay, opts) {
    if (!hay) return -1;
    opts = opts || {};

    var idx = hay.indexOf(q);
    if (idx === 0) return 1000 + q.length * 12 - hay.length * 0.05;
    if (idx > 0) return 600 + q.length * 8 - idx - hay.length * 0.05;

    if (opts.initials && opts.initials.length && isSubsequence(q, opts.initials)) {
      return 320 + q.length * 6;
    }
    if (opts.fuzzy && q.length >= 3) {
      var s = subsequenceScore(q, hay);
      if (s >= 0) return 120 + s - hay.length * 0.05;
    }
    return -1;
  }

  function scoreEntry(entry, terms) {
    var total = 0;
    for (var i = 0; i < terms.length; i++) {
      var t = terms[i];
      var best = Math.max(
        fuzzyScore(t, entry.nameL, { initials: entry.nameInit, fuzzy: true }) * 4,
        fuzzyScore(t, entry.kwL, { fuzzy: true }) * 3,
        fuzzyScore(t, entry.tagsL, { fuzzy: true }) * 2,
        fuzzyScore(t, entry.urlL) * 1.5,
        fuzzyScore(t, entry.descL),
        fuzzyScore(t, entry.catL)
      );
      if (best < 0) return -1;
      total += best;
    }
    return total;
  }

  function splitTerms(q) {
    return String(q || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function searchEntries(q) {
    var terms = splitTerms(q);
    if (!terms.length) return null;
    var scored = [];
    entries.forEach(function (entry) {
      var s = scoreEntry(entry, terms);
      if (s >= 0) scored.push({ e: entry, s: s });
    });
    scored.sort(function (a, b) {
      if (b.s !== a.s) return b.s - a.s;
      return a.e.name.localeCompare(b.e.name, 'zh');
    });
    return scored.map(function (o) { return o.e; });
  }

  /* ---------- 快速搜索面板 ---------- */
  var cmdkItems = [];
  var cmdkActive = 0;

  function buildCmdkItem(entry, terms) {
    var li = document.createElement('li');
    li.className = 'cmdk-item';
    li.setAttribute('role', 'option');
    li.dataset.url = entry.url;
    li.title = entry.name + '\n' + entry.url;

    li.appendChild(buildIcon(entry.link));

    var body = document.createElement('div');
    body.className = 'cmdk-body';

    var name = document.createElement('div');
    name.className = 'cmdk-name';
    highlightedNodes(entry.name, terms).forEach(function (n) { name.appendChild(n); });
    body.appendChild(name);

    var sub = document.createElement('div');
    sub.className = 'cmdk-sub';
    sub.textContent = entry.catName + (entry.desc ? ' · ' + entry.desc : '');
    body.appendChild(sub);

    li.appendChild(body);

    var host = hostOf(entry.url);
    if (host) {
      var u = document.createElement('div');
      u.className = 'cmdk-url';
      u.textContent = host;
      li.appendChild(u);
    }
    return li;
  }

  function setCmdkActive(idx) {
    var nodes = el.cmdkList.querySelectorAll('.cmdk-item');
    if (!nodes.length) return;
    if (idx < 0) idx = nodes.length - 1;
    if (idx >= nodes.length) idx = 0;
    cmdkActive = idx;

    for (var i = 0; i < nodes.length; i++) {
      var on = i === idx;
      nodes[i].classList.toggle('is-active', on);
      nodes[i].setAttribute('aria-selected', on ? 'true' : 'false');
    }

    var cur = nodes[idx];
    if (!cur.id) cur.id = 'cmdk-opt-' + idx;
    el.cmdkInput.setAttribute('aria-activedescendant', cur.id);
    if (cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }

  function renderCmdk(q) {
    el.cmdkList.textContent = '';
    cmdkItems = [];

    var results = searchEntries(q);
    var groups = [];

    if (results === null) {
      var rec = recentEntries();
      if (rec.length) groups.push({ title: '最近打开', items: rec });
      var rest = entries.filter(function (e) { return rec.indexOf(e) === -1; }).slice(0, 10);
      if (rest.length) groups.push({ title: '全部链接', items: rest });
    } else if (results.length) {
      groups.push({ title: '搜索结果', items: results.slice(0, 30) });
    }

    var terms = splitTerms(q);

    groups.forEach(function (g) {
      var head = document.createElement('li');
      head.className = 'cmdk-group';
      head.setAttribute('role', 'presentation');
      head.textContent = g.title;
      el.cmdkList.appendChild(head);

      g.items.forEach(function (entry) {
        el.cmdkList.appendChild(buildCmdkItem(entry, terms));
        cmdkItems.push(entry);
      });
    });

    var empty = cmdkItems.length === 0;
    el.cmdkList.hidden = empty;
    el.cmdkEmpty.hidden = !empty;

    if (empty) {
      el.cmdkEmpty.textContent = results === null
        ? '还没有可搜索的链接'
        : '没有匹配的链接，换个词试试';
      el.cmdkCount.textContent = results === null ? '' : '0 个结果';
    } else {
      el.cmdkCount.textContent = results === null
        ? (cmdkItems.length + ' 个链接')
        : (cmdkItems.length + ' 个结果');
      setCmdkActive(0);
    }
  }

  function openCmdk(prefill) {
    if (!el.cmdk) return;
    if (typeof prefill === 'string') el.cmdkInput.value = prefill;
    el.cmdk.hidden = false;
    el.cmdk.setAttribute('aria-hidden', 'false');
    el.cmdkInput.setAttribute('aria-expanded', 'true');
    document.documentElement.classList.add('cmdk-locked');
    document.body.classList.add('cmdk-locked');
    renderCmdk(el.cmdkInput.value);
    el.cmdkInput.focus();
    el.cmdkInput.select();
  }

  function closeCmdk() {
    if (!el.cmdk || el.cmdk.hidden) return;
    el.cmdk.hidden = true;
    el.cmdk.setAttribute('aria-hidden', 'true');
    el.cmdkInput.setAttribute('aria-activedescendant', '');
    el.cmdkInput.setAttribute('aria-expanded', 'false');
    document.documentElement.classList.remove('cmdk-locked');
    document.body.classList.remove('cmdk-locked');
  }

  el.cmdkInput.addEventListener('input', function () { renderCmdk(el.cmdkInput.value); });

  el.cmdkInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCmdkActive(cmdkActive + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCmdkActive(cmdkActive - 1);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      setCmdkActive(cmdkActive + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      var pick = cmdkItems[cmdkActive];
      if (pick) { closeCmdk(); openEntry(pick); }
    }
  });

  el.cmdkList.addEventListener('click', function (e) {
    var item = e.target.closest ? e.target.closest('.cmdk-item') : null;
    if (!item) return;
    var entry = cmdkItems[Array.prototype.indexOf.call(
      el.cmdkList.querySelectorAll('.cmdk-item'), item)];
    if (entry) { closeCmdk(); openEntry(entry); }
  });

  el.cmdkList.addEventListener('mouseover', function (e) {
    var item = e.target.closest ? e.target.closest('.cmdk-item') : null;
    if (!item) return;
    var idx = Array.prototype.indexOf.call(el.cmdkList.querySelectorAll('.cmdk-item'), item);
    if (idx >= 0 && idx !== cmdkActive) setCmdkActive(idx);
  });

  el.cmdk.addEventListener('click', function (e) {
    if (e.target.hasAttribute && e.target.hasAttribute('data-cmdk-close')) closeCmdk();
  });

  /* ---------- 顶栏搜索提交 ---------- */
  // 直接按当前输入计算首个命中，避免 debounce 未触发时拿到上一轮的旧结果
  function findFirstMatch(terms) {
    if (!terms.length) return null;
    for (var i = 0; i < categories.length; i++) {
      var links = categories[i].links;
      for (var j = 0; j < links.length; j++) {
        var hay = links[j]._hay;
        var hit = true;
        for (var k = 0; k < terms.length; k++) {
          if (hay.indexOf(terms[k]) === -1) { hit = false; break; }
        }
        if (hit) return links[j];
      }
    }
    return null;
  }

  function submitSearch() {
    var q = el.search.value.trim();
    var scope = currentScope();

    if (scope !== 'site') {
      if (!q) { el.search.focus(); return; }
      window.open(SCOPES[scope].url + encodeURIComponent(q), '_blank', 'noopener');
      return;
    }
    if (!q) { openCmdk(''); return; }

    var hit = findFirstMatch(splitTerms(q));
    if (hit) { openEntry(hit); return; }
    openCmdk(q);
  }

  el.searchGo.addEventListener('click', submitSearch);

  el.scopeBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    toggleScopeMenu();
  });

  el.scopeMenu.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-scope]') : null;
    if (!btn) return;
    applyScope(btn.dataset.scope);
    toggleScopeMenu(false);
    el.search.focus();
  });

  document.addEventListener('click', function (e) {
    if (el.scopeMenu.hidden) return;
    if (el.searchBox.contains(e.target)) return;
    toggleScopeMenu(false);
  });

  /* ---------- 搜索 ---------- */
  var searchTimer = null;

  function currentTerms() {
    return el.search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  function onSearchInput() {
    if (currentScope() !== 'site') return;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      render(currentTerms());
    }, 90);
  }

  el.search.addEventListener('input', onSearchInput);
  el.search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitSearch();
      return;
    }
    if (e.key === 'Escape') {
      el.search.value = '';
      render([]);
      el.search.blur();
    }
  });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target && e.target.tagName) || '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || (e.target && e.target.isContentEditable);
    var mod = e.metaKey || e.ctrlKey;

    // Ctrl/⌘ + K：开/关快速搜索
    if (mod && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      if (el.cmdk.hidden) openCmdk('');
      else closeCmdk();
      return;
    }
    if (e.key === 'Escape' && el.cmdk && !el.cmdk.hidden) {
      e.preventDefault();
      closeCmdk();
      return;
    }
    if (e.key === '/' && !typing && !mod && !e.altKey && el.cmdk.hidden) {
      e.preventDefault();
      el.search.focus();
      el.search.select();
    }
  });

  /* ---------- 主题 ---------- */
  function applyTheme(theme) {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);

    var labels = { auto: '跟随系统', light: '浅色', dark: '深色' };
    el.themeBtn.title = '主题：' + labels[theme] + '（点击切换）';
    el.themeBtn.setAttribute('aria-label', el.themeBtn.title);
  }

  function initTheme() {
    var saved = '';
    try { saved = localStorage.getItem(THEME_KEY) || ''; } catch (e) { /* 隐私模式忽略 */ }
    if (THEMES.indexOf(saved) === -1) saved = 'auto';
    applyTheme(saved);

    el.themeBtn.addEventListener('click', function () {
      var cur = '';
      try { cur = localStorage.getItem(THEME_KEY) || 'auto'; } catch (e) { /* 忽略 */ }
      var next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* 忽略 */ }
      applyTheme(next);
    });
  }


  /* ---------- 背景动效：漂移星点 + 偶发流星 ---------- */
  function initBg() {
    var cvs = document.getElementById('bgfx');
    if (!cvs || !cvs.getContext) return;
    var ctx = cvs.getContext('2d');
    if (!ctx) return;

    var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var W = 0, H = 0, stars = [], motes = [], meteors = [];
    var raf = 0, lastDraw = 0, nextMeteor = 0;
    var FRAME_GAP = 31; // ≈30fps，背景漂移看不出差别

    var darkF = 1, parX = 0, parY = 0, tgX = 0, tgY = 0;
    var COLORS = ['99, 102, 241', '139, 92, 246', '236, 72, 153', '56, 189, 248'];

    function prefersDark() {
      var attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'dark') return true;
      if (attr === 'light') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }

    function updateTone() {
      darkF = prefersDark() ? 1 : 0.34;
      if (reduceMQ.matches && ctx && W) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        paintOnce();
      }
    }

    function makeStar() {
      var big = Math.random() < 0.15;
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        r: big ? 1.9 + Math.random() * 1.5 : 0.9 + Math.random() * 1.0,
        vx: (Math.random() - 0.5) * 0.07,
        vy: -0.04 - Math.random() * 0.11,
        a: 0.30 + Math.random() * 0.55,
        ph: Math.random() * Math.PI * 2,
        sp: 0.0005 + Math.random() * 0.0014,
        c: COLORS[(Math.random() * COLORS.length) | 0]
      };
    }

    function makeMote() {
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        r: 50 + Math.random() * 100,
        vx: (Math.random() - 0.5) * 0.07,
        vy: -0.02 - Math.random() * 0.05,
        a: 0.030 + Math.random() * 0.045,
        ph: Math.random() * 6.2832,
        sp: 0.00022 + Math.random() * 0.00038,
        c: COLORS[(Math.random() * COLORS.length) | 0]
      };
    }

    function resize() {
      W = window.innerWidth;
      H = window.innerHeight;
      cvs.width = Math.round(W * dpr);
      cvs.height = Math.round(H * dpr);
      var want = Math.round(Math.min(180, Math.max(24, (W * H) / 11000)));
      while (stars.length > want) stars.pop();
      while (stars.length < want) stars.push(makeStar());

      var wantMotes = Math.round(Math.min(14, Math.max(4, (W * H) / 160000)));
      while (motes.length > wantMotes) motes.pop();
      while (motes.length < wantMotes) motes.push(makeMote());

      // 视口变化后把越界的点拉回来，避免拉宽窗口时右半边空着
      for (var si = 0; si < stars.length; si++) {
        if (stars[si].x > W) stars[si].x = Math.random() * W;
        if (stars[si].y > H) stars[si].y = Math.random() * H;
      }
      for (var mj = 0; mj < motes.length; mj++) {
        if (motes[mj].x - motes[mj].r > W) motes[mj].x = Math.random() * W;
        if (motes[mj].y - motes[mj].r > H) motes[mj].y = Math.random() * H;
      }
    }

    function spawnMeteor() {
      meteors.push({
        x: W * 0.3 + Math.random() * W * 0.75,
        y: -50 - Math.random() * 80,
        vx: -1.0 - Math.random() * 0.8,
        vy: 1.7 + Math.random() * 1.0,
        len: 90 + Math.random() * 90,
        age: 0,
        dur: 1100 + Math.random() * 500
      });
    }

    function paint(now) {
      raf = 0;
      if (now - lastDraw < FRAME_GAP) { loop(); return; }
      var dt = lastDraw ? Math.min(now - lastDraw, 64) : 16;
      lastDraw = now;
      var k = dt / 16.67;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 鼠标视差（很轻，只为了有"活"的感觉）
      parX += (tgX - parX) * 0.05;
      parY += (tgY - parY) * 0.05;
      ctx.translate(parX, parY);

      // 光尘（大团柔光，撑起背景的"空气感"）
      for (var mi = 0; mi < motes.length; mi++) {
        var mo = motes[mi];
        mo.x += mo.vx * k;
        mo.y += mo.vy * k;
        if (mo.y < -mo.r) { mo.y = H + mo.r; mo.x = Math.random() * W; }
        if (mo.x < -mo.r) mo.x = W + mo.r;
        else if (mo.x > W + mo.r) mo.x = -mo.r;

        var pulse = 0.72 + 0.28 * Math.sin(now * mo.sp + mo.ph);
        var mg = ctx.createRadialGradient(mo.x, mo.y, 0, mo.x, mo.y, mo.r);
        mg.addColorStop(0, 'rgba(' + mo.c + ', ' + (mo.a * pulse * darkF).toFixed(3) + ')');
        mg.addColorStop(1, 'rgba(' + mo.c + ', 0)');
        ctx.beginPath();
        ctx.arc(mo.x, mo.y, mo.r, 0, 6.2832);
        ctx.fillStyle = mg;
        ctx.fill();
      }

      // 星点（浅色主题下不画：浅底上的半透明彩点会像屏幕灰尘）
      for (var i = 0; darkF > 0.5 && i < stars.length; i++) {
        var s = stars[i];
        s.x += s.vx * k;
        s.y += s.vy * k;
        if (s.y < -20) { s.y = H + 10; s.x = Math.random() * W; }
        if (s.x < -20) s.x = W + 10;
        else if (s.x > W + 20) s.x = -10;
        if (s.r > 1.8) { s.ph += 0.0018 * k; }

        var tw = 0.7 + 0.3 * Math.sin(now * s.sp + s.ph);
        var a = s.a * tw * darkF;
        if (a <= 0.004) continue;

        if (s.r > 1.8) {
          var glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 5.5);
          glow.addColorStop(0, 'rgba(' + s.c + ', ' + (a * 0.42).toFixed(3) + ')');
          glow.addColorStop(1, 'rgba(' + s.c + ', 0)');
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * 5.5, 0, 6.2832);
          ctx.fillStyle = glow;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fillStyle = 'rgba(' + s.c + ', ' + a.toFixed(3) + ')';
        ctx.fill();
      }

      // 流星
      if (now > nextMeteor) {
        spawnMeteor();
        nextMeteor = now + 5500 + Math.random() * 9000;
      }
      for (var j = meteors.length - 1; j >= 0; j--) {
        var m = meteors[j];
        m.age += dt;
        if (m.age >= m.dur) { meteors.splice(j, 1); continue; }
        m.x += m.vx * k;
        m.y += m.vy * k;
        var life = 1 - m.age / m.dur;
        var mag = Math.sqrt(m.vx * m.vx + m.vy * m.vy);
        var dx = m.vx / mag, dy = m.vy / mag;
        var g = ctx.createLinearGradient(m.x, m.y, m.x - dx * m.len, m.y - dy * m.len);
        g.addColorStop(0, 'rgba(255, 255, 255, ' + (0.7 * life * darkF).toFixed(3) + ')');
        g.addColorStop(0.3, 'rgba(167, 139, 250, ' + (0.38 * life * darkF).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(167, 139, 250, 0)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 1.7;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m.x - dx * m.len, m.y - dy * m.len);
        ctx.stroke();
      }

      loop();
    }

    function loop() {
      if (raf || document.hidden || reduceMQ.matches) return;
      raf = window.requestAnimationFrame(paint);
    }

    function start() {
      lastDraw = 0;
      nextMeteor = performance.now() + 2200 + Math.random() * 3000;
      if (reduceMQ.matches) { paintOnce(); return; }
      loop();
    }

    // 用户关闭动效时只画一帧静态星图
    function paintOnce() {
      if (darkF <= 0.5) return;
      for (var i = 0; i < stars.length; i++) {
        var s = stars[i];
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.2832);
        ctx.fillStyle = 'rgba(' + s.c + ', ' + (s.a * darkF * 0.8).toFixed(3) + ')';
        ctx.fill();
      }
    }

    var resizeTick = 0;
    window.addEventListener('resize', function () {
      if (resizeTick) return;
      resizeTick = window.setTimeout(function () {
        resizeTick = 0;
        resize();
        if (reduceMQ.matches) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); paintOnce(); }
      }, 180);
    });

    document.addEventListener('mousemove', function (e) {
      tgX = (e.clientX / window.innerWidth - 0.5) * -16;
      tgY = (e.clientY / window.innerHeight - 0.5) * -10;
    }, { passive: true });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (raf) { window.cancelAnimationFrame(raf); raf = 0; }
      } else {
        lastDraw = 0;
        loop();
      }
    });

    try {
      var mo = new MutationObserver(updateTone);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    } catch (e) { /* 老浏览器忽略 */ }

    if (window.matchMedia) {
      var schemeMQ = window.matchMedia('(prefers-color-scheme: dark)');
      var onScheme = function () { updateTone(); };
      if (schemeMQ.addEventListener) schemeMQ.addEventListener('change', onScheme);
      else if (schemeMQ.addListener) schemeMQ.addListener(onScheme);
    }

    updateTone();
    resize();
    start();
  }

  /* ---------- 启动 ---------- */
  bindCatnav();
  bindScrollSpy();
  initTheme();
  applyScope(currentScope());
  render([]);
  initBg();
})();
