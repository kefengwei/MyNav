/* =========================================================
   MyNav · 可视化管理界面
   纯原生 JS，零依赖。数据真源是 data/links.json，
   本页读 data/links.js（由 build-data.mjs 生成）作为初始值。
   ========================================================= */
(function () {
  'use strict';

  var GH_KEY = 'mynav:github';
  var SCHEMA = './links.schema.json';
  var HAS_FS = typeof window.showOpenFilePicker === 'function' && window.isSecureContext && location.protocol !== 'file:';

  var state = {
    data: null,
    activeCat: 0,
    handle: null,
    dirty: false,
    /** 配置对话框提交后要自动续跑的动作：'publish' | 'pull' | null */
    pendingAction: null
  };

  /* ---------------- 小工具 ---------------- */

  function $(id) { return document.getElementById(id); }
  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }
  function str(v) { return typeof v === 'string' ? v : ''; }

  var statusEl, statusTimer;
  function setStatus(msg, kind) {
    statusEl = statusEl || $('status');
    statusEl.textContent = msg;
    statusEl.className = 'adm-status' + (kind ? ' is-' + kind : '');
    clearTimeout(statusTimer);
    if (kind === 'ok' || kind === 'warn') {
      statusTimer = setTimeout(function () {
        statusEl.className = 'adm-status';
      }, 6000);
    }
  }
  function markDirty() {
    state.dirty = true;
    var btn = $('btn-save');
    if (btn) btn.textContent = '保存文件 •';
  }
  function clearDirty() {
    state.dirty = false;
    var btn = $('btn-save');
    if (btn) btn.textContent = '保存文件';
  }

  /* ---------------- 数据规范化 / 序列化 ---------------- */

  function normalizeLink(l) {
    l = l || {};
    var tags = [];
    if (Array.isArray(l.tags)) {
      tags = l.tags.filter(function (t) { return typeof t === 'string' && t; });
    } else if (typeof l.tags === 'string') {
      tags = l.tags.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    }
    return {
      name: str(l.name),
      url: str(l.url),
      desc: str(l.desc),
      icon: str(l.icon),
      keywords: str(l.keywords),
      tags: tags
    };
  }

  function normalize(raw) {
    var d = (raw && typeof raw === 'object') ? raw : {};
    var meta = (d.meta && typeof d.meta === 'object') ? d.meta : {};
    var out = {
      meta: {
        title: str(meta.title) || 'MyNav',
        subtitle: str(meta.subtitle),
        updated: str(meta.updated) || today()
      },
      categories: []
    };
    var cats = Array.isArray(d.categories) ? d.categories : [];
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      if (!c || typeof c !== 'object') continue;
      out.categories.push({
        id: str(c.id) || 'cat-' + (out.categories.length + 1),
        name: str(c.name) || '未命名分类',
        emoji: str(c.emoji),
        links: (Array.isArray(c.links) ? c.links : []).map(normalizeLink)
      });
    }
    return out;
  }

  function buildJson() {
    var out = {
      $schema: SCHEMA,
      meta: {
        title: state.data.meta.title.trim() || 'MyNav',
        subtitle: state.data.meta.subtitle.trim(),
        updated: state.data.meta.updated || today()
      },
      categories: state.data.categories.map(function (c) {
        var co = { id: c.id.trim(), name: c.name.trim() };
        if (c.emoji) co.emoji = c.emoji;
        co.links = c.links.map(function (l) {
          var x = { name: l.name.trim(), url: l.url.trim() };
          if (l.desc) x.desc = l.desc;
          if (l.icon) x.icon = l.icon;
          if (l.tags.length) x.tags = l.tags;
          if (l.keywords) x.keywords = l.keywords;
          return x;
        });
        return co;
      })
    };
    return JSON.stringify(out, null, 2) + '\n';
  }

  /* ---------------- 校验（与 tools/build-data.mjs 规则一致） ---------------- */

  var ID_RE = /^[A-Za-z0-9_-]+$/;
  var URL_RE = /^https?:\/\//i;

  function validateAll() {
    var errs = [];
    var seenIds = {};
    var seenUrl = {};
    var cats = state.data.categories;

    if (!cats.length) errs.push('至少需要一个分类');

    cats.forEach(function (c, ci) {
      var where = '分类 ' + (ci + 1) + '「' + (c.name || '未命名') + '」';
      if (!c.id.trim()) errs.push(where + '：id 不能为空');
      else if (!ID_RE.test(c.id.trim())) errs.push(where + '：id 只能用字母、数字、下划线、连字符');
      else if (seenIds[c.id.trim()]) errs.push(where + '：id「' + c.id.trim() + '」重复，锚点会冲突');
      seenIds[c.id.trim()] = true;
      if (!c.name.trim()) errs.push(where + '：分类名不能为空');

      c.links.forEach(function (l, li) {
        var at = where + ' 第 ' + (li + 1) + ' 条链接';
        if (!l.name.trim()) errs.push(at + '：名称不能为空');
        if (!l.url.trim()) errs.push(at + '：网址不能为空');
        else if (!URL_RE.test(l.url.trim())) errs.push(at + '：网址必须以 http:// 或 https:// 开头');
        else {
          var key = l.url.trim().replace(/\/+$/, '').toLowerCase();
          if (seenUrl[key]) errs.push(at + '：网址重复（' + l.url.trim() + '）');
          seenUrl[key] = true;
        }
      });
    });
    return errs;
  }

  /* ---------------- 渲染：分类列表 ---------------- */

  function renderCats() {
    var ul = $('cat-list');
    ul.textContent = '';
    state.data.categories.forEach(function (c, i) {
      var li = document.createElement('li');
      li.className = 'adm-cat' + (i === state.activeCat ? ' is-active' : '');
      li.dataset.i = String(i);
      li.title = c.id;

      var em = document.createElement('span');
      em.className = 'adm-cat-emoji';
      em.textContent = c.emoji || '📁';

      var nm = document.createElement('span');
      nm.className = 'adm-cat-name';
      nm.textContent = c.name || '未命名分类';

      var ct = document.createElement('span');
      ct.className = 'adm-cat-count';
      ct.textContent = String(c.links.length);

      li.appendChild(em);
      li.appendChild(nm);
      li.appendChild(ct);
      ul.appendChild(li);
    });
    updateCounts();
  }

  function totalLinks() {
    return state.data.categories.reduce(function (n, c) { return n + c.links.length; }, 0);
  }

  function updateCounts() {
    $('cat-count').textContent = String(state.data.categories.length);
  }

  function updateLinkCount(current) {
    $('link-count').textContent = current + ' / ' + totalLinks();
  }

  function syncCatLabel(i) {
    var li = $('cat-list').children[i];
    if (!li) return;
    var c = state.data.categories[i];
    li.children[1].textContent = c.name || '未命名分类';
    li.children[2].textContent = String(c.links.length);
    li.title = c.id;
  }

  /* ---------------- 渲染：meta ---------------- */

  function renderMeta() {
    $('meta-title').value = state.data.meta.title;
    $('meta-subtitle').value = state.data.meta.subtitle;
    $('meta-updated').value = /^\d{4}-\d{2}-\d{2}$/.test(state.data.meta.updated) ? state.data.meta.updated : today();
  }

  /* ---------------- 渲染：分类编辑器 ---------------- */

  function renderCatEditor() {
    var box = $('cat-editor');
    box.textContent = '';
    var c = state.data.categories[state.activeCat];
    var disabled = !c;
    box.hidden = disabled;
    if (disabled) return;

    box.appendChild(makeField('f-emoji', '图标', 'emoji', c.emoji, '🧭'));
    box.appendChild(makeField('f-name', '分类名', 'name', c.name, '开发'));
    box.appendChild(makeField('f-id', 'id（锚点）', 'id', c.id, 'dev'));

    var sp = document.createElement('div');
    sp.className = 'spacer';
    box.appendChild(sp);

    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'adm-btn';
    del.id = 'btn-del-cat';
    del.textContent = '删除分类';
    box.appendChild(del);
  }

  function makeField(cls, label, key, value, placeholder) {
    var wrap = document.createElement('label');
    wrap.className = cls;
    var span = document.createElement('span');
    span.textContent = label;
    var inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value || '';
    inp.placeholder = placeholder || '';
    inp.autocomplete = 'off';
    inp.dataset.scope = 'cat';
    inp.dataset.k = key;
    wrap.appendChild(span);
    wrap.appendChild(inp);
    return wrap;
  }

  /* ---------------- 渲染：链接行 ---------------- */

  var LINK_FIELDS = [
    { k: 'name', label: '名称', ph: 'GitHub', cls: 'f-name' },
    { k: 'url', label: '网址', ph: 'https://github.com', cls: 'f-url' },
    { k: 'desc', label: '描述', ph: '代码托管与协作', cls: 'f-desc' },
    { k: 'icon', label: '图标', ph: 'assets/icon.png', cls: 'f-icon' },
    { k: 'tags', label: '标签，逗号分隔', ph: 'git, 代码', cls: 'f-tags' },
    { k: 'keywords', label: '搜索关键词', ph: 'gh', cls: 'f-keywords' }
  ];

  function renderLinks() {
    var box = $('link-list');
    box.textContent = '';
    var c = state.data.categories[state.activeCat];
    var links = c ? c.links : [];
    $('links-empty').hidden = links.length > 0;
    updateLinkCount(links.length);

    links.forEach(function (l, i) {
      var row = document.createElement('div');
      row.className = 'adm-link';
      row.dataset.i = String(i);

      var idx = document.createElement('span');
      idx.className = 'adm-idx';
      idx.textContent = String(i + 1);
      row.appendChild(idx);

      LINK_FIELDS.forEach(function (f) {
        var inp = document.createElement('input');
        inp.type = 'text';
        inp.className = f.cls;
        inp.value = f.k === 'tags' ? l.tags.join(', ') : (l[f.k] || '');
        inp.placeholder = f.ph;
        inp.title = f.label;
        inp.autocomplete = 'off';
        inp.dataset.i = String(i);
        inp.dataset.k = f.k;
        if (f.k === 'name' || f.k === 'url') inp.required = true;
        row.appendChild(inp);
      });

      var actions = document.createElement('div');
      actions.className = 'adm-row-actions';
      actions.appendChild(iconBtn('↑', '上移', 'move-up', i === 0));
      actions.appendChild(iconBtn('↓', '下移', 'move-down', i === links.length - 1));
      actions.appendChild(iconBtn('×', '删除', 'delete', false, 'is-danger'));
      row.appendChild(actions);

      box.appendChild(row);
    });
  }

  function iconBtn(text, title, act, disabled, extraCls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'adm-icon-btn' + (extraCls ? ' ' + extraCls : '');
    b.textContent = text;
    b.title = title;
    b.dataset.act = act;
    b.disabled = !!disabled;
    return b;
  }

  function renderAll() {
    renderCats();
    renderMeta();
    renderCatEditor();
    renderLinks();
  }

  /* ---------------- 事件：分类切换 ---------------- */

  function bindCatList() {
    $('cat-list').addEventListener('click', function (e) {
      var li = e.target.closest('.adm-cat');
      if (!li) return;
      var i = Number(li.dataset.i);
      if (i === state.activeCat) return;
      state.activeCat = i;
      renderAll();
    });
  }

  /* ---------------- 事件：分类字段 ---------------- */

  function bindCatEditor() {
    var box = $('cat-editor');

    box.addEventListener('input', function (e) {
      var t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      var c = state.data.categories[state.activeCat];
      if (!c) return;
      var k = t.dataset.k;
      if (k === 'id') {
        c.id = t.value.trim();
        var idBad = !c.id || !ID_RE.test(c.id);
        t.classList.toggle('is-invalid', idBad);
        t.title = idBad ? 'id 只能用字母、数字、下划线、连字符' : 'id（锚点）';
        syncCatLabel(state.activeCat);
      } else if (k === 'name') {
        c.name = t.value;
        var nameBad = !t.value.trim();
        t.classList.toggle('is-invalid', nameBad);
        t.title = nameBad ? '分类名不能为空' : '分类名';
        syncCatLabel(state.activeCat);
      } else if (k === 'emoji') {
        c.emoji = t.value;
        syncCatLabel(state.activeCat);
      }
      markDirty();
    });

    box.addEventListener('click', function (e) {
      var b = e.target.closest('#btn-del-cat');
      if (!b) return;
      var c = state.data.categories[state.activeCat];
      if (!c) return;
      if (!window.confirm('删除分类「' + (c.name || '未命名') + '」及其 ' + c.links.length + ' 条链接？')) return;
      state.data.categories.splice(state.activeCat, 1);
      if (state.activeCat >= state.data.categories.length) {
        state.activeCat = Math.max(0, state.data.categories.length - 1);
      }
      markDirty();
      renderAll();
      setStatus('已删除分类', 'warn');
    });
  }

  /* ---------------- 事件：链接字段 ---------------- */

  function bindLinkList() {
    var box = $('link-list');

    box.addEventListener('input', function (e) {
      var t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      var c = state.data.categories[state.activeCat];
      if (!c) return;
      var i = Number(t.dataset.i);
      var l = c.links[i];
      if (!l) return;
      var k = t.dataset.k;
      if (k === 'tags') {
        l.tags = t.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        l[k] = t.value;
      }
      if (k === 'name') {
        t.classList.toggle('is-invalid', !t.value.trim());
        t.title = t.value.trim() ? '名称' : '名称不能为空';
      } else if (k === 'url') {
        var urlVal = t.value.trim();
        var urlBad = !urlVal || !URL_RE.test(urlVal);
        t.classList.toggle('is-invalid', urlBad);
        t.title = urlBad ? '网址必须以 http:// 或 https:// 开头' : '网址';
      }
      markDirty();
    });

    box.addEventListener('click', function (e) {
      var b = e.target.closest('.adm-icon-btn');
      if (!b || b.disabled) return;
      var c = state.data.categories[state.activeCat];
      if (!c) return;
      var row = b.closest('.adm-link');
      var i = Number(row.dataset.i);
      var act = b.dataset.act;

      if (act === 'delete') {
        c.links.splice(i, 1);
        markDirty();
        renderLinks();
        syncCatLabel(state.activeCat);
        return;
      }
      if (act === 'move-up' && i > 0) {
        var tmp = c.links[i - 1];
        c.links[i - 1] = c.links[i];
        c.links[i] = tmp;
        markDirty();
        renderLinks();
        return;
      }
      if (act === 'move-down' && i < c.links.length - 1) {
        var tmp2 = c.links[i + 1];
        c.links[i + 1] = c.links[i];
        c.links[i] = tmp2;
        markDirty();
        renderLinks();
      }
    });
  }

  /* ---------------- 事件：meta ---------------- */

  function bindMeta() {
    ['meta-title', 'meta-subtitle', 'meta-updated'].forEach(function (id) {
      $(id).addEventListener('input', function () {
        var k = id.replace('meta-', '');
        state.data.meta[k] = this.value;
        markDirty();
      });
    });
  }

  /* ---------------- 增删分类 / 链接 ---------------- */

  function nextCatId() {
    var n = state.data.categories.length + 1;
    var used = {};
    state.data.categories.forEach(function (c) { used[c.id] = true; });
    while (used['cat-' + n]) n++;
    return 'cat-' + n;
  }

  function bindAddButtons() {
    $('btn-add-cat').addEventListener('click', function () {
      var id = nextCatId();
      state.data.categories.push({ id: id, name: '新分类', emoji: '', links: [] });
      state.activeCat = state.data.categories.length - 1;
      markDirty();
      renderAll();
      setStatus('已新增分类，改好名字再添加链接', 'ok');
    });

    $('btn-add-link').addEventListener('click', function () {
      var c = state.data.categories[state.activeCat];
      if (!c) { setStatus('先创建或选择一个分类', 'warn'); return; }
      c.links.push({ name: '', url: '', desc: '', icon: '', keywords: '', tags: [] });
      markDirty();
      renderLinks();
      syncCatLabel(state.activeCat);
      var rows = $('link-list').children;
      var first = rows[rows.length - 1] && rows[rows.length - 1].querySelector('input');
      if (first) first.focus();
    });
  }

  /* ---------------- 文件保存 / 打开 ---------------- */

  async function openFile() {
    var handles;
    try {
      handles = await window.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
        multiple: false
      });
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      setStatus('打开失败：' + (err && err.message), 'err');
      return;
    }
    if (!handles || !handles[0]) return;
    var handle = handles[0];
    try {
      var file = await handle.getFile();
      var text = await file.text();
      var parsed = JSON.parse(text);
      state.data = normalize(parsed);
      state.handle = handle;
      state.activeCat = 0;
      clearDirty();
      renderAll();
      setStatus('已加载 ' + file.name + '（' + file.size + ' 字节）', 'ok');
    } catch (err) {
      setStatus('读取或解析失败：' + (err && err.message), 'err');
    }
  }

  async function saveFile() {
    if (!state.handle) {
      setStatus('还没打开文件，请先用「打开 links.json」', 'warn');
      return;
    }
    try {
      var w = await state.handle.createWritable();
      await w.write(buildJson());
      await w.close();
      clearDirty();
      setStatus('已写入 ' + state.handle.name + '，记得跑 node tools/build-data.mjs 刷新 links.js', 'ok');
    } catch (err) {
      setStatus('保存失败：' + (err && err.message), 'err');
    }
  }

  function download() {
    var errs = validateAll();
    if (errs.length && !window.confirm('有 ' + errs.length + ' 处问题（' + errs[0] + '…），仍要下载吗？')) return;
    var blob = new Blob([buildJson()], { type: 'application/json;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'links.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    setStatus('已下载 links.json，覆盖到 data/ 下后运行 node tools/build-data.mjs', 'ok');
  }

  /* ---------------- GitHub 直连发布 ---------------- */

  function readGh() {
    try { return JSON.parse(localStorage.getItem(GH_KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function writeGh(cfg) {
    try {
      if (!cfg.repo) { localStorage.removeItem(GH_KEY); return; }
      localStorage.setItem(GH_KEY, JSON.stringify({
        repo: cfg.repo,
        branch: cfg.branch || 'main',
        token: cfg.token || ''
      }));
    } catch (e) { /* 隐私模式下静默失败 */ }
  }

  async function ghFetch(cfg, method, body) {
    var url = 'https://api.github.com/repos/' + cfg.repo + '/contents/data/links.json';
    if (cfg.branch) url += '?ref=' + encodeURIComponent(cfg.branch);
    var headers = {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: method,
      headers: headers,
      body: body ? JSON.stringify(body) : undefined
    });
  }

  function ghReason(status) {
    switch (status) {
      case 401: return 'token 无效或已过期';
      case 403: return 'token 权限不足（Contents 需要 Read and write）或触发了限流';
      case 404: return '仓库 / 分支 / 文件不存在，或 token 没有该仓库的访问权';
      case 409: return '与远端冲突，先「从 GitHub 读取」再发布';
      case 422: return 'GitHub 拒绝了这次提交（分支不存在或内容无效）';
      default: return 'HTTP ' + status;
    }
  }

  function b64encode(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }
  function b64decode(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function pullFromGithub() {
    var cfg = readGh();
    if (!cfg.repo || !cfg.token) {
      state.pendingAction = 'pull';
      openGhDialog();
      return;
    }
    setStatus('正在从 GitHub 读取…');
    try {
      var res = await ghFetch(cfg, 'GET');
      if (!res.ok) { setStatus('读取失败：' + ghReason(res.status), 'err'); return; }
      var info = await res.json();
      var text = b64decode(info.content);
      state.data = normalize(JSON.parse(text));
      state.activeCat = 0;
      clearDirty();
      renderAll();
      setStatus('已读取远端 data/links.json（' + (info.size || text.length) + ' 字节）', 'ok');
    } catch (err) {
      setStatus('读取失败：' + (err && err.message), 'err');
    }
  }

  async function publish() {
    var errs = validateAll();
    if (errs.length) {
      setStatus('有 ' + errs.length + ' 处问题，先修复再发布：' + errs[0], 'err');
      return;
    }

    var cfg = readGh();
    if (!cfg.repo || !cfg.token) {
      state.pendingAction = 'publish';
      openGhDialog();
      return;
    }

    setStatus('正在读取远端 sha…');
    try {
      var getRes = await ghFetch(cfg, 'GET');
      var sha = null;
      if (getRes.status === 200) {
        sha = (await getRes.json()).sha;
      } else if (getRes.status !== 404) {
        setStatus('发布失败：' + ghReason(getRes.status), 'err');
        return;
      }

      var body = {
        message: 'chore(data): 通过管理界面更新导航数据',
        content: b64encode(buildJson())
      };
      if (sha) body.sha = sha;
      if (cfg.branch) body.branch = cfg.branch;

      setStatus('正在提交…');
      var putRes = await ghFetch(cfg, 'PUT', body);
      if (!putRes.ok) {
        var detail = '';
        try { detail = (await putRes.json()).message || ''; } catch (e) { /* ignore */ }
        setStatus('发布失败：' + ghReason(putRes.status) + (detail ? '（' + detail + '）' : ''), 'err');
        return;
      }
      var result = await putRes.json();
      var commit = result.commit && result.commit.sha ? result.commit.sha.slice(0, 7) : '';
      clearDirty();
      setStatus('已提交 ' + commit + ' 到 ' + cfg.repo + '，Actions 部署约 1 分钟', 'ok');
    } catch (err) {
      setStatus('发布失败：' + (err && err.message), 'err');
    }
  }

  function openGhDialog() {
    var cfg = readGh();
    $('gh-repo').value = cfg.repo || '';
    $('gh-branch').value = cfg.branch || 'main';
    $('gh-token').value = cfg.token || '';
    $('gh-remember').checked = true;
    $('gh-dialog').showModal();
  }

  function bindGithub() {
    $('btn-pull').addEventListener('click', pullFromGithub);
    $('btn-publish').addEventListener('click', publish);

    $('gh-cancel').addEventListener('click', function () {
      state.pendingAction = null;
      $('gh-dialog').close();
    });

    $('gh-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var repo = $('gh-repo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
      var branch = $('gh-branch').value.trim() || 'main';
      var token = $('gh-token').value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { setStatus('仓库格式应为 owner/repo', 'err'); return; }
      if (!token) { setStatus('token 不能为空', 'err'); return; }
      writeGh({ repo: repo, branch: branch, token: $('gh-remember').checked ? token : '' });
      $('gh-dialog').close();
      var pending = state.pendingAction;
      state.pendingAction = null;
      if (pending === 'publish') {
        setStatus('配置已保存，正在发布…');
        publish();
      } else if (pending === 'pull') {
        setStatus('配置已保存，正在读取…');
        pullFromGithub();
      } else {
        setStatus('已保存 GitHub 配置：' + repo + '@' + branch, 'ok');
      }
    });
  }

  /* ---------------- 从收藏夹导入 ---------------- */

  var BOOKMARK_ROOT_RE = /^(书签栏|其他书签|收藏夹栏|移动设备书签|书签|收藏夹|Bookmarks bar|Bookmarks toolbar|Other bookmarks|Mobile bookmarks|Bookmarks|Favorites bar|Favorites)$/i;
  var SKIP_SCHEME_RE = /^(chrome|edge|about|javascript|file|data|place|moz-extension|chrome-extension|view-source|blob|ftp):/i;

  var importPlan = null;

  function decodeEntities(text) {
    return String(text)
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(Number(d)); })
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  }

  function cleanText(text) {
    return decodeEntities(String(text).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function parseAttributes(raw) {
    var attrs = {};
    var re = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"/g;
    var m;
    while ((m = re.exec(raw)) !== null) attrs[m[1].toUpperCase()] = m[2];
    return attrs;
  }

  function normalizeUrl(url) {
    if (!url) return '';
    var s = decodeEntities(String(url)).trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) return 'http://' + s;
    return s;
  }

  function urlKey(u) {
    var s = String(u || '').trim().replace(/\/+$/, '');
    var m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]+)([\s\S]*)$/i.exec(s);
    if (m) return m[1].toLowerCase() + m[2].toLowerCase() + m[3];
    return s.toLowerCase();
  }

  function keepEntry(e) {
    if (!e.url) return false;
    if (SKIP_SCHEME_RE.test(e.url)) return false;
    if (!/^https?:\/\//i.test(e.url)) return false;
    if (e.url.length > 2000) return false;
    return true;
  }

  function categoryOfPath(pathStack) {
    var cleaned = (pathStack || []).filter(function (p) { return p && !BOOKMARK_ROOT_RE.test(p.trim()); });
    if (!cleaned.length) return '未分类';
    return cleaned[cleaned.length - 1];
  }

  function parseBookmarkHtml(html) {
    var entries = [];
    var TOKEN_RE = new RegExp(
      '<DT>\\s*<H3\\b([^>]*)>([\\s\\S]*?)</H3>' +
      '|<DT>\\s*<A\\b([^>]*)>([\\s\\S]*?)</A>' +
      '|<DD>([\\s\\S]*?)(?=<DT>|</DL>|<HR>|$)' +
      '|<DL\\b[^>]*>|</DL>',
      'gi'
    );
    var stack = [];
    var pendingFolder = null;
    var lastEntry = null;
    var m;
    while ((m = TOKEN_RE.exec(html)) !== null) {
      var token = m[0];
      if (/^<DL/i.test(token)) {
        stack.push(pendingFolder === null ? '' : pendingFolder);
        pendingFolder = null;
        continue;
      }
      if (/^<\/DL/i.test(token)) { stack.pop(); continue; }
      if (m[2] !== undefined) { pendingFolder = cleanText(m[2]); continue; }
      if (m[4] !== undefined) {
        var attrs = parseAttributes(m[3]);
        var url = normalizeUrl(attrs.HREF);
        lastEntry = {
          name: cleanText(m[4]) || url,
          url: url,
          desc: '',
          iconData: attrs.ICON || '',
          tags: (attrs.TAGS || '').split(',').map(function (s) { return decodeEntities(s).trim(); }).filter(Boolean),
          path: stack.filter(Boolean).slice()
        };
        entries.push(lastEntry);
        continue;
      }
      if (m[5] !== undefined && lastEntry) {
        var desc = cleanText(m[5]);
        if (desc && !lastEntry.desc) lastEntry.desc = desc;
      }
    }
    return entries;
  }

  function parseBookmarkJson(text) {
    var json = JSON.parse(text);
    var entries = [];
    function walk(node, path) {
      if (!node) return;
      if (Array.isArray(node)) { node.forEach(function (n) { walk(n, path); }); return; }
      if (node.type === 'url' && node.url) {
        entries.push({
          name: cleanText(node.name || '') || node.url,
          url: normalizeUrl(node.url),
          desc: '',
          iconData: '',
          tags: [],
          path: path.slice()
        });
        return;
      }
      if (Array.isArray(node.children)) {
        var next = node.name ? path.concat(node.name) : path;
        node.children.forEach(function (child) { walk(child, next); });
      }
    }
    var roots = json && json.roots ? json.roots : null;
    if (roots) {
      Object.keys(roots).forEach(function (k) {
        var root = roots[k];
        if (root && Array.isArray(root.children)) {
          root.children.forEach(function (ch) { walk(ch, []); });
        }
      });
    } else if (Array.isArray(json)) {
      json.forEach(function (n) { walk(n, []); });
    }
    return entries;
  }

  /* ---------------- 自动生成标签与关键词 ---------------- */

  // 语义标签规则：[匹配正则, 标签]。顺序即优先级，只取前 2 个。
  var TAG_RULES = [
    [/(^|\.)github\.|(^|\.)gitee\.|(^|\.)gitlab\.|bitbucket|代码托管/i, '代码托管'],
    [/youtube|bilibili|youku|vimeo|视频|直播|弹幕/i, '视频'],
    [/figma|penpot|dribbble|behance|sketch|设计|灵感/i, '设计'],
    [/fonts?\.|typeface|字体/i, '字体'],
    [/npmjs|pypi|packagist|maven|crates\.io|包管理|包仓库/i, '包管理'],
    [/stackoverflow|stack exchange|segmentfault|问答|question/i, '问答'],
    [/\bdocs?\b|docs\.|\/documentation|developer\.|\bapi\b|reference|手册|文档|教程/i, '文档'],
    [/\bforum|\bdiscuss|community|\bbbs\b|社区|论坛|讨论/i, '社区'],
    [/\bwiki|wikipedia|百科/i, '百科'],
    [/\bai\b|openai|chatgpt|claude|llm|大模型|对话助手/i, 'AI'],
    [/unreal|unity|godot|游戏|引擎/i, '游戏'],
    [/cloudflare|vercel|netlify|部署|hosting/i, '部署'],
    [/zhihu|douban|weibo|社交/i, '社交'],
    [/translate|翻译/i, '翻译'],
    [/图片|image|photo|素材|icon|图标/i, '素材'],
    [/新闻|news|资讯/i, '资讯'],
    [/邮箱|\bgmail\b|outlook|\bmail/i, '邮箱'],
    [/music|spotify|网易云|音乐/i, '音乐'],
    [/taobao|\bjd\.com|amazon|购物|商城/i, '购物']
  ];

  // 技术栈词：命中后追加成标签（最多再补 1 个）
  var TECH_WORDS = ['react', 'vue', 'angular', 'svelte', 'next.js', 'nuxt', 'javascript', 'typescript',
    'node', 'deno', 'python', 'java', 'golang', 'rust', 'c++', 'c#', 'php', 'ruby', 'swift', 'kotlin',
    'html', 'css', 'tailwind', 'sass', 'docker', 'kubernetes', 'linux', 'git', 'mysql', 'postgresql',
    'redis', 'mongodb', 'webpack', 'vite', 'webgl', 'shader'];

  var MULTI_SUFFIX_RE = /\.(com|net|org|gov|edu|co|ac|or)\.(cn|uk|jp|hk|tw|kr|au|br)$/i;

  function domainBrand(url) {
    var host = '';
    try { host = new URL(url).hostname.toLowerCase().replace(/^\.+/, ''); } catch (e) { return ''; }
    host = host.replace(/^www\./, '');
    var core = host.replace(MULTI_SUFFIX_RE, '').replace(/\.[a-z]{2,}$/, '');
    var parts = core.split('.').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  }

  function autoTags(entry, catName) {
    var text = [entry.name, entry.desc, entry.url, catName].join(' ');
    var tags = [];
    for (var i = 0; i < TAG_RULES.length && tags.length < 2; i++) {
      if (TAG_RULES[i][0].test(text) && tags.indexOf(TAG_RULES[i][1]) < 0) tags.push(TAG_RULES[i][1]);
    }
    for (var j = 0; j < TECH_WORDS.length && tags.length < 3; j++) {
      var w = TECH_WORDS[j];
      var re = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
      if (tags.indexOf(w) < 0 && re.test(text)) tags.push(w);
    }
    if (!tags.length && catName && catName !== '未分类') tags.push(catName);
    return tags;
  }

  function autoKeywords(entry) {
    var out = [];
    var brand = domainBrand(entry.url);
    if (brand && brand.length >= 2) out.push(brand);
    var words = String(entry.name || '').match(/[A-Za-z][A-Za-z0-9+#.]*/g) || [];
    for (var i = 0; i < words.length && out.length < 5; i++) {
      var w = words[i].toLowerCase().replace(/\.+$/, '');
      if (w.length >= 2 && out.indexOf(w) < 0) out.push(w);
    }
    return out.slice(0, 5).join(' ');
  }

  function buildImportPlan(entries) {
    var existing = {};
    state.data.categories.forEach(function (c) {
      c.links.forEach(function (l) { if (l.url) existing[urlKey(l.url)] = true; });
    });
    var seen = {};
    var skippedDup = 0;
    var skippedBad = 0;
    var groups = [];
    var byName = {};
    entries.forEach(function (e) {
      if (!keepEntry(e)) { skippedBad++; return; }
      var key = urlKey(e.url);
      if (!key || seen[key] || existing[key]) { skippedDup++; return; }
      seen[key] = true;
      var catName = categoryOfPath(e.path);
      var g = byName[catName];
      if (!g) {
        var match = -1;
        for (var i = 0; i < state.data.categories.length; i++) {
          if (state.data.categories[i].name.trim() === catName) { match = i; break; }
        }
        g = { name: catName, catIndex: match, links: [] };
        byName[catName] = g;
        groups.push(g);
      }
      e._tags = autoTags(e, catName);
      e._kw = autoKeywords(e);
      g.links.push(e);
    });
    var kept = 0;
    groups.forEach(function (g) { kept += g.links.length; });
    return { groups: groups, total: entries.length, kept: kept, skippedDup: skippedDup, skippedBad: skippedBad };
  }

  function renderImportPreview(plan) {
    var box = $('import-preview');
    var applyBtn = $('import-apply');
    box.innerHTML = '';
    if (!plan || !plan.total) { box.hidden = true; applyBtn.disabled = true; return; }
    box.hidden = false;

    var sum = document.createElement('p');
    sum.className = 'adm-import-sum';
    var head = '检测到 <strong>' + plan.total + '</strong> 条链接 → 可导入 <strong>' + plan.kept + '</strong> 条';
    var skip = [];
    if (plan.skippedDup) skip.push('重复网址 ' + plan.skippedDup);
    if (plan.skippedBad) skip.push('非网页 ' + plan.skippedBad);
    sum.innerHTML = head + (skip.length ? '，跳过' + skip.join('、') : '');
    box.appendChild(sum);

    if (!plan.groups.length) {
      var none = document.createElement('p');
      none.className = 'adm-import-sum';
      none.textContent = '没有可导入的新链接，全部已存在于当前数据里。';
      box.appendChild(none);
      applyBtn.disabled = true;
      return;
    }

    var mergeN = 0;
    plan.groups.forEach(function (g) { if (g.catIndex >= 0) mergeN++; });
    var hint = document.createElement('p');
    hint.className = 'adm-import-sum';
    hint.textContent = (mergeN ? mergeN + ' 个分类已存在（追加进去）' : '') +
      (mergeN && plan.groups.length - mergeN ? '，' : '') +
      (plan.groups.length - mergeN ? (plan.groups.length - mergeN) + ' 个分类将新建' : '');
    box.appendChild(hint);

    var ul = document.createElement('ul');
    ul.className = 'adm-import-groups';
    plan.groups.slice(0, 80).forEach(function (g) {
      var li = document.createElement('li');
      var tag = document.createElement('span');
      tag.className = 'adm-tag ' + (g.catIndex >= 0 ? 'is-merge' : 'is-new');
      tag.textContent = g.catIndex >= 0 ? '合并' : '新建';
      var name = document.createElement('span');
      name.className = 'adm-gname';
      name.textContent = g.name;
      var n = document.createElement('em');
      n.textContent = '+' + g.links.length;
      li.appendChild(tag);
      li.appendChild(name);
      li.appendChild(n);
      ul.appendChild(li);
    });
    box.appendChild(ul);

    // 自动生成示例（勾选时才显示）
    var autoOn = $('import-autotag').checked;
    var samples = [];
    for (var a = 0; a < plan.groups.length && samples.length < 4; a++) {
      for (var b = 0; b < plan.groups[a].links.length && samples.length < 4; b++) {
        samples.push(plan.groups[a].links[b]);
      }
    }
    if (autoOn && samples.length) {
      var autoWrap = document.createElement('div');
      autoWrap.className = 'adm-auto';
      var cap = document.createElement('p');
      cap.className = 'adm-import-sum';
      cap.textContent = '自动生成示例（导入后仍可在输入框里改）：';
      autoWrap.appendChild(cap);
      var grid = document.createElement('div');
      grid.className = 'adm-auto-grid';
      samples.forEach(function (e) {
        var row = document.createElement('div');
        row.className = 'adm-auto-row';
        var nm = document.createElement('span');
        nm.className = 'adm-auto-name';
        nm.textContent = e.name;
        nm.title = e.name;
        var tg = document.createElement('span');
        tg.className = 'adm-auto-tags';
        tg.textContent = (e._tags && e._tags.length) ? e._tags.join('、') : '（无标签）';
        var kw = document.createElement('span');
        kw.className = 'adm-auto-kw';
        kw.textContent = e._kw || '（无关键词）';
        kw.title = e._kw || '';
        row.appendChild(nm);
        row.appendChild(tg);
        row.appendChild(kw);
        grid.appendChild(row);
      });
      autoWrap.appendChild(grid);
      box.appendChild(autoWrap);
    }

    applyBtn.disabled = false;
  }

  function applyImport() {
    if (!importPlan || !importPlan.groups.length) return;
    var keepIcons = $('import-icons').checked;
    var autoOn = $('import-autotag').checked;
    var added = 0;
    var newCats = 0;
    var firstIdx = -1;
    importPlan.groups.forEach(function (g) {
      var target;
      if (g.catIndex >= 0) {
        target = state.data.categories[g.catIndex];
      } else {
        target = { id: nextCatId(), name: g.name, emoji: '', links: [] };
        state.data.categories.push(target);
        newCats++;
      }
      var idx = state.data.categories.indexOf(target);
      if (firstIdx < 0) firstIdx = idx;
      g.links.forEach(function (e) {
        var tags = autoOn ? (e._tags || []).slice() : [];
        (e.tags || []).forEach(function (t) {
          if (tags.indexOf(t) < 0) tags.push(t);
        });
        target.links.push({
          name: e.name,
          url: e.url,
          desc: e.desc,
          icon: keepIcons ? e.iconData : '',
          keywords: autoOn ? (e._kw || '') : '',
          tags: tags
        });
        added++;
      });
    });
    if (firstIdx >= 0) state.activeCat = firstIdx;
    importPlan = null;
    closeImportDialog();
    markDirty();
    renderAll();
    setStatus('已导入 ' + added + ' 条链接' + (newCats ? '、新建 ' + newCats + ' 个分类' : '') + ' · 记得保存', 'ok');
  }

  function openImportDialog() {
    importPlan = null;
    $('import-preview').innerHTML = '';
    $('import-preview').hidden = true;
    $('import-apply').disabled = true;
    $('import-file').value = '';
    $('import-dialog').showModal();
  }

  function closeImportDialog() {
    var d = $('import-dialog');
    if (d.open) d.close();
  }

  function readImportFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      var text = String(reader.result || '');
      var entries;
      try {
        if (/\.json$/i.test(file.name) || /^\s*[\{\[]/.test(text)) entries = parseBookmarkJson(text);
        else entries = parseBookmarkHtml(text);
      } catch (err) {
        setStatus('解析失败：' + (err && err.message ? err.message : '文件格式不对'), 'err');
        return;
      }
      if (!entries.length) {
        setStatus('文件里没找到链接，确认选的是浏览器导出的书签文件', 'warn');
        return;
      }
      importPlan = buildImportPlan(entries);
      renderImportPreview(importPlan);
    };
    reader.onerror = function () { setStatus('读文件失败', 'err'); };
    reader.readAsText(file, 'utf-8');
  }

  function bindImport() {
    $('btn-import').addEventListener('click', openImportDialog);
    $('import-cancel').addEventListener('click', closeImportDialog);
    $('import-apply').addEventListener('click', applyImport);
    $('import-file').addEventListener('change', function (e) {
      readImportFile(e.target.files && e.target.files[0]);
    });
    $('import-autotag').addEventListener('change', function () {
      if (importPlan) renderImportPreview(importPlan);
    });

    var drop = $('import-drop');
    ['dragenter', 'dragover'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
    });
    ['dragleave', 'drop'].forEach(function (t) {
      drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
    });
    drop.addEventListener('drop', function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) readImportFile(f);
    });

    // 拖到页面别处时阻止浏览器直接打开文件，避免丢失未保存的编辑
    ['dragover', 'drop'].forEach(function (t) {
      document.addEventListener(t, function (e) { e.preventDefault(); });
    });
  }

  /* ---------------- 启动 ---------------- */

  async function init() {
    // 优先读真源 data/links.json（http/https 下没有 CORS 限制）；
    // file:// 打开时 fetch 会被拦，退回构建产物 data/links.js。
    var raw = null;
    var fromSource = false;
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        var res = await fetch('data/links.json', { cache: 'no-store' });
        if (res.ok) { raw = await res.json(); fromSource = true; }
      } catch (e) { /* 退回 links.js */ }
    }
    if (!raw) raw = window.NAV_DATA || null;
    if (!raw) {
      setStatus('没读到 data/links.js 或 data/links.json，页面从空数据开始', 'warn');
    }
    state.data = normalize(raw);

    if (!HAS_FS) {
      $('btn-open').hidden = true;
      $('btn-save').hidden = true;
      $('hint').innerHTML = '当前以文件方式打开，浏览器不允许直接写盘。请用「下载 JSON」覆盖 <code>data/links.json</code>，再运行 <code>node tools/build-data.mjs</code>。';
    } else {
      $('btn-open').hidden = false;
      $('btn-save').hidden = false;
      $('btn-open').addEventListener('click', openFile);
      $('btn-save').addEventListener('click', saveFile);
    }

    $('btn-download').addEventListener('click', download);
    bindCatList();
    bindCatEditor();
    bindLinkList();
    bindMeta();
    bindAddButtons();
    bindGithub();
    bindImport();

    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });

    renderAll();
    setStatus('就绪 · ' + state.data.categories.length + ' 个分类 · ' +
      (fromSource ? '数据来自 data/links.json' : '数据来自 data/links.js（构建产物）'), '');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
