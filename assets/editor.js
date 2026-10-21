/* MyNav 编辑模式 —— 在首页直接增删改链接，改完一键发布到 GitHub。
   依赖 assets/app.js 暴露的 window.MyNavApp；不引入任何第三方库。 */
(function () {
  'use strict';

  var APP = window.MyNavApp;
  if (!APP) {
    console.warn('[MyNav] app.js 未就绪，编辑模式不启用');
    return;
  }

  var GH_KEY = 'mynav:github';   // 与 admin.html 共用同一份配置
  var SCHEMA = './links.schema.json';
  var editing = false;
  var changes = 0;
  var pending = null;            // { mode: 'edit' | 'add', catId, src }
  var pendingAction = null;      // 'publish' | null

  function $(id) { return document.getElementById(id); }

  function today() {
    var d = new Date();
    var m = String(d.getMonth() + 1);
    var day = String(d.getDate());
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return d.getFullYear() + '-' + m + '-' + day;
  }

  /* ---------------- 底部工具条 ---------------- */

  function setNote(msg, kind) {
    var n = $('edit-note');
    if (!n) return;
    n.textContent = msg || '';
    n.className = 'edit-note' + (kind ? ' is-' + kind : '');
  }

  function updateBar() {
    var c = $('edit-count');
    if (c) c.textContent = changes > 0 ? '已改 ' + changes + ' 处' : '尚未改动';
    var pub = $('btn-publish');
    if (pub) pub.disabled = changes === 0;
    var exp = $('btn-export');
    if (exp) exp.disabled = false;
    document.title = (changes > 0 ? '*' : '') + document.title.replace(/^\*/, '');
  }

  function bump() {
    changes += 1;
    updateBar();
    setNote('改动只存在内存里，点「发布到 GitHub」才会生效', 'warn');
  }

  /* ---------------- 进入 / 退出编辑模式 ---------------- */

  function enter() {
    if (editing) return;
    editing = true;
    changes = 0;
    document.body.classList.add('is-editing');
    var btn = $('btn-edit');
    if (btn) {
      btn.classList.add('is-on');
      btn.setAttribute('aria-pressed', 'true');
      var t = btn.querySelector('.txt');
      if (t) t.textContent = '完成';
      var i = btn.querySelector('.ico');
      if (i) i.textContent = '✓';
    }
    if ($('edit-bar')) $('edit-bar').hidden = false;
    if ($('btn-add-cat')) $('btn-add-cat').hidden = false;
    setNote('点卡片上的 ✎ 改链接、× 删除；左侧分类的 ✎ 改分类；分类标题右侧「+ 添加」新建链接', '');
    updateBar();
    APP.refresh([]);
  }

  function exit(force) {
    if (!editing) return;
    if (!force && changes > 0) {
      if (!window.confirm('还有 ' + changes + ' 处改动没发布，退出会丢掉，确定吗？')) return;
    }
    editing = false;
    changes = 0;
    document.body.classList.remove('is-editing');
    var btn = $('btn-edit');
    if (btn) {
      btn.classList.remove('is-on');
      btn.setAttribute('aria-pressed', 'false');
      var t = btn.querySelector('.txt');
      if (t) t.textContent = '编辑';
      var i = btn.querySelector('.ico');
      if (i) i.textContent = '✏️';
    }
    if ($('edit-bar')) $('edit-bar').hidden = true;
    if ($('btn-add-cat')) $('btn-add-cat').hidden = true;
    setNote('', '');
    APP.refresh([]);
  }

  function toggle() { if (editing) exit(false); else enter(); }

  /* ---------------- 链接编辑弹窗 ---------------- */

  function fieldsOf(catId) {
    return {
      name: $('ld-name'),
      url: $('ld-url'),
      desc: $('ld-desc'),
      tags: $('ld-tags')
    };
  }

  function dialogError(msg) {
    var e = $('ld-err');
    if (!e) return;
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function openEdit(eid) {
    var hit = APP.entry(eid);
    if (!hit) return;
    pending = { mode: 'edit', catId: hit.link._catId, src: hit.src };
    $('ld-title').textContent = '编辑链接';
    $('ld-sub').textContent = hit.cat.name;
    var f = fieldsOf();
    f.name.value = hit.src.name || '';
    f.url.value = hit.src.url || '';
    f.desc.value = hit.src.desc || '';
    f.tags.value = Array.isArray(hit.src.tags) ? hit.src.tags.join(', ') : '';
    dialogError('');
    $('ld-del').hidden = false;
    $('ld-del').setAttribute('data-eid', String(eid));
    showDialog();
  }

  function openAdd(catId) {
    pending = { mode: 'add', catId: catId, src: null };
    var cat = APP.category(catId);
    $('ld-title').textContent = '新增链接';
    $('ld-sub').textContent = cat ? cat.name : '';
    var f = fieldsOf();
    f.name.value = '';
    f.url.value = '';
    f.desc.value = '';
    f.tags.value = '';
    dialogError('');
    $('ld-del').hidden = true;
    showDialog();
  }

  function showDialog() {
    var d = $('link-dialog');
    if (!d) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
    var f = fieldsOf();
    f.name.focus();
    f.name.select();
  }

  function closeDialog() {
    var d = $('link-dialog');
    if (d && typeof d.close === 'function') d.close();
    else if (d) d.removeAttribute('open');
    pending = null;
    dialogError('');
  }

  function parseTags(raw) {
    return String(raw || '').split(/[,，]/).map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
  }

  function saveLink() {
    if (!pending) return;
    var f = fieldsOf();
    var name = f.name.value.trim();
    var url = f.url.value.trim();
    var desc = f.desc.value.trim();
    var tags = parseTags(f.tags.value);

    if (!name) { dialogError('名称不能为空'); f.name.focus(); return; }
    if (!/^https?:\/\//i.test(url)) { dialogError('网址必须以 http:// 或 https:// 开头'); f.url.focus(); return; }

    if (pending.mode === 'add') {
      var cat = APP.category(pending.catId);
      if (!cat) { dialogError('分类不存在（可能刚被删了）'); return; }
      if (!Array.isArray(cat.links)) cat.links = [];
      var fresh = { name: name, url: url };
      if (desc) fresh.desc = desc;
      if (tags.length) fresh.tags = tags;
      cat.links.push(fresh);
    } else {
      var src = pending.src;
      if (!src) { dialogError('链接对象丢失，刷新页面重试'); return; }
      src.name = name;
      if (src.url !== url) {
        src.url = url;
        // 换了网址，原图标属于旧站点，删掉让 CI 重新抓
        delete src.icon;
      }
      if (desc) src.desc = desc; else delete src.desc;
      if (tags.length) src.tags = tags; else delete src.tags;
    }

    closeDialog();
    bump();
    APP.refresh([]);
  }

  function deleteByEid(eid) {
    var hit = APP.entry(eid);
    if (!hit) return;
    if (!window.confirm('删除「' + hit.link.name + '」？\n' + hit.link.url)) return;
    var arr = hit.cat._src.links;
    var i = arr ? arr.indexOf(hit.src) : -1;
    if (i > -1) arr.splice(i, 1);
    bump();
    APP.refresh([]);
  }

  /* ---------------- 分类编辑弹窗 ---------------- */

  var pendingCat = null;   // { mode: 'edit' | 'add', src: 原始分类对象 | null }

  function catFields() {
    return { name: $('cd-name'), id: $('cd-id'), type: $('cd-type') };
  }

  function catError(msg) {
    var e = $('cd-err');
    if (!e) return;
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  function catIndexOf(src) {
    var arr = (APP.data && APP.data.categories) || [];
    for (var i = 0; i < arr.length; i++) { if (arr[i] === src) return i; }
    return -1;
  }

  function syncCatForm() {
    var sub = $('cd-sub');
    var del = $('cd-del');
    var up = $('cd-up');
    var down = $('cd-down');
    var total = ((APP.data && APP.data.categories) || []).length;

    if (!pendingCat || pendingCat.mode === 'add') {
      if (sub) sub.textContent = '新分类会加在列表末尾';
      if (del) del.hidden = true;
      if (up) up.disabled = true;
      if (down) down.disabled = true;
      return;
    }

    var src = pendingCat.src;
    var i = catIndexOf(src);
    var n = Array.isArray(src.links) ? src.links.length : 0;
    if (sub) sub.textContent = '第 ' + (i + 1) + ' / ' + total + ' 个分类 · ' + n + ' 条链接';
    if (del) del.hidden = false;
    if (up) up.disabled = i <= 0;
    if (down) down.disabled = i < 0 || i >= total - 1;
  }

  function openCatEdit(catId) {
    var src = APP.category(catId);
    if (!src) return;
    pendingCat = { mode: 'edit', src: src };
    $('cd-title').textContent = '编辑分类';
    var f = catFields();
    f.name.value = src.name || '';
    f.id.value = src.id || '';
    f.type.value = src.type === 'fav' ? 'fav' : 'nav';
    catError('');
    syncCatForm();
    showCatDialog();
  }

  function openCatAdd() {
    pendingCat = { mode: 'add', src: null };
    $('cd-title').textContent = '新增分类';
    var f = catFields();
    f.name.value = '';
    f.id.value = '';
    f.type.value = 'nav';
    catError('');
    syncCatForm();
    showCatDialog();
  }

  function showCatDialog() {
    var d = $('cat-dialog');
    if (!d) return;
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  function closeCatDialog() {
    var d = $('cat-dialog');
    if (d && typeof d.close === 'function') d.close();
    else if (d) d.removeAttribute('open');
    pendingCat = null;
    catError('');
  }

  function catIdTaken(id) {
    var arr = (APP.data && APP.data.categories) || [];
    for (var i = 0; i < arr.length; i++) {
      var c = arr[i];
      if (!c) continue;
      if (pendingCat && c === pendingCat.src) continue;
      if (c.id === id) return true;
    }
    return false;
  }

  function saveCat() {
    if (!pendingCat) return;
    var f = catFields();
    var name = f.name.value.trim();
    var id = f.id.value.trim();
    var type = f.type.value === 'fav' ? 'fav' : 'nav';

    if (!name) { catError('分类名不能为空'); f.name.focus(); return; }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) { catError('id 只能用字母、数字、下划线、连字符'); f.id.focus(); return; }
    if (catIdTaken(id)) { catError('id 已被其他分类占用，换一个'); f.id.focus(); return; }

    if (pendingCat.mode === 'add') {
      if (!Array.isArray(APP.data.categories)) APP.data.categories = [];
      var fresh = { id: id, name: name };
      if (type === 'fav') fresh.type = 'fav';
      fresh.links = [];
      APP.data.categories.push(fresh);
    } else {
      var src = pendingCat.src;
      if (!src) { catError('分类对象丢失，刷新页面重试'); return; }
      src.id = id;
      src.name = name;
      if (type === 'fav') src.type = 'fav'; else delete src.type;
      if (!Array.isArray(src.links)) src.links = [];
    }

    closeCatDialog();
    bump();
    APP.refresh([]);
  }

  function moveCat(dir) {
    if (!pendingCat || pendingCat.mode !== 'edit') return;
    var arr = (APP.data && APP.data.categories) || [];
    var i = catIndexOf(pendingCat.src);
    var j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    var tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    bump();
    APP.refresh([]);
    syncCatForm();
  }

  function deleteCat() {
    if (!pendingCat || pendingCat.mode !== 'edit') return;
    var src = pendingCat.src;
    var n = Array.isArray(src.links) ? src.links.length : 0;
    var msg = '删除分类「' + (src.name || src.id) + '」？';
    if (n > 0) msg += '\n它下面的 ' + n + ' 条链接会一起删除。';
    msg += '\n只要不发布，刷新页面就能还原。';
    if (!window.confirm(msg)) return;
    var arr = (APP.data && APP.data.categories) || [];
    var i = catIndexOf(src);
    if (i > -1) arr.splice(i, 1);
    closeCatDialog();
    bump();
    APP.refresh([]);
  }

  /* ---------------- 导出 / 发布 ---------------- */

  function buildJson() {
    var d = APP.data;
    var meta = d.meta || {};
    var out = {
      $schema: SCHEMA,
      meta: {
        title: String(meta.title || 'MyNav').trim() || 'MyNav',
        subtitle: String(meta.subtitle || ''),
        updated: meta.updated || today()
      },
      categories: (d.categories || []).map(function (c) {
        var co = { id: String(c.id || ''), name: String(c.name || '') };
        if (c.type === 'fav') co.type = 'fav';
        co.links = (c.links || []).map(function (l) {
          var x = { name: String(l.name || ''), url: String(l.url || '') };
          if (l.desc) x.desc = l.desc;
          if (l.icon) x.icon = l.icon;
          if (Array.isArray(l.tags) && l.tags.length) x.tags = l.tags;
          if (l.keywords) x.keywords = l.keywords;
          return x;
        });
        return co;
      })
    };
    return JSON.stringify(out, null, 2) + '\n';
  }

  function exportJson() {
    try {
      var text = buildJson();
      var blob = new Blob([text], { type: 'application/json;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'links.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
      setNote('已导出 links.json（' + Math.round(text.length / 1024) + ' KB）—— 覆盖 data/links.json 后再跑 node tools/build-data.mjs', 'ok');
    } catch (e) {
      setNote('导出失败：' + (e && e.message), 'err');
    }
  }

  function readGh() {
    try { return JSON.parse(localStorage.getItem(GH_KEY) || 'null') || {}; } catch (e) { return {}; }
  }

  function writeGh(cfg) {
    try {
      if (!cfg.repo) { localStorage.removeItem(GH_KEY); return; }
      localStorage.setItem(GH_KEY, JSON.stringify({
        repo: cfg.repo, branch: cfg.branch || 'main', token: cfg.token || ''
      }));
    } catch (e) { /* 隐私模式忽略 */ }
  }

  function b64encode(text) {
    var bytes = new TextEncoder().encode(text);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  function ghFetch(cfg, method, body) {
    var url = 'https://api.github.com/repos/' + cfg.repo + '/contents/data/links.json';
    if (cfg.branch) url += '?ref=' + encodeURIComponent(cfg.branch);
    var headers = {
      Authorization: 'Bearer ' + cfg.token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined });
  }

  function ghReason(status) {
    switch (status) {
      case 401: return 'token 无效或已过期';
      case 403: return 'token 权限不足（Contents 需要 Read and write）或触发了限流';
      case 404: return '仓库 / 分支 / 文件不存在，或 token 没有该仓库的访问权';
      case 409: return '与远端冲突，先刷新页面重来';
      case 422: return 'GitHub 拒绝了这次提交（分支不存在或内容无效）';
      default: return 'HTTP ' + status;
    }
  }

  function openGh() {
    var cfg = readGh();
    $('gh-repo').value = cfg.repo || '';
    $('gh-branch').value = cfg.branch || 'main';
    $('gh-token').value = cfg.token || '';
    $('gh-remember').checked = true;
    var d = $('gh-dialog');
    if (typeof d.showModal === 'function') d.showModal();
    else d.setAttribute('open', '');
  }

  function closeGh() {
    var d = $('gh-dialog');
    if (d && typeof d.close === 'function') d.close();
    else if (d) d.removeAttribute('open');
    pendingAction = null;
  }

  async function publish() {
    if (changes === 0) { setNote('没有改动', 'warn'); return; }
    var cfg = readGh();
    if (!cfg.repo || !cfg.token) { pendingAction = 'publish'; openGh(); return; }

    var text = buildJson();
    setNote('正在读取远端 sha…', '');
    try {
      var getRes = await ghFetch(cfg, 'GET');
      var sha = null;
      if (getRes.status === 200) sha = (await getRes.json()).sha;
      else if (getRes.status !== 404) { setNote('发布失败：' + ghReason(getRes.status), 'err'); return; }

      var body = { message: 'chore(data): 通过首页编辑模式更新导航数据', content: b64encode(text) };
      if (sha) body.sha = sha;
      if (cfg.branch) body.branch = cfg.branch;

      setNote('正在提交…', '');
      var putRes = await ghFetch(cfg, 'PUT', body);
      if (!putRes.ok) {
        var detail = '';
        try { detail = (await putRes.json()).message || ''; } catch (e) { /* ignore */ }
        setNote('发布失败：' + ghReason(putRes.status) + (detail ? '（' + detail + '）' : ''), 'err');
        return;
      }
      var result = await putRes.json();
      var commit = result.commit && result.commit.sha ? result.commit.sha.slice(0, 7) : '';
      changes = 0;
      updateBar();
      setNote('已提交 ' + commit + ' 到 ' + cfg.repo + '，约 1 分钟后线上生效', 'ok');
    } catch (e) {
      setNote('发布失败：' + (e && e.message), 'err');
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  function clicked(el) {
    return el && el.closest ? el.closest('[data-act],[data-add],[data-cat-act]') : null;
  }

  function bind() {
    var btn = $('btn-edit');
    if (btn) btn.addEventListener('click', toggle);

    // 用捕获阶段，赶在 <a> 的默认跳转之前拦截
    document.addEventListener('click', function (e) {
      if (!editing) return;
      var t = clicked(e.target);
      if (!t) return;
      e.preventDefault();
      e.stopPropagation();
      var act = t.getAttribute('data-act');
      var eid = t.getAttribute('data-eid');
      var add = t.getAttribute('data-add');
      var catAct = t.getAttribute('data-cat-act');
      if (catAct === 'edit') openCatEdit(t.getAttribute('data-cat-id'));
      else if (add) openAdd(add);
      else if (act === 'edit') openEdit(eid);
      else if (act === 'del') deleteByEid(eid);
    }, true);

    document.addEventListener('keydown', function (e) {
      if (!editing) return;
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var t = clicked(e.target);
      if (!t || e.target.tagName === 'INPUT') return;
      e.preventDefault();
      t.click();
    });

    var form = $('link-form');
    if (form) form.addEventListener('submit', function (e) { e.preventDefault(); saveLink(); });
    var cancel = $('ld-cancel');
    if (cancel) cancel.addEventListener('click', closeDialog);
    var del = $('ld-del');
    if (del) del.addEventListener('click', function () {
      var eid = del.getAttribute('data-eid');
      closeDialog();
      deleteByEid(eid);
    });

    var catForm = $('cat-form');
    if (catForm) catForm.addEventListener('submit', function (e) { e.preventDefault(); saveCat(); });
    var cdCancel = $('cd-cancel');
    if (cdCancel) cdCancel.addEventListener('click', closeCatDialog);
    var cdDel = $('cd-del');
    if (cdDel) cdDel.addEventListener('click', deleteCat);
    var cdUp = $('cd-up');
    if (cdUp) cdUp.addEventListener('click', function () { moveCat(-1); });
    var cdDown = $('cd-down');
    if (cdDown) cdDown.addEventListener('click', function () { moveCat(1); });
    var cdId = $('cd-id');
    if (cdId) cdId.addEventListener('input', function () {
      if (!pendingCat) return;
      catError(/^[A-Za-z0-9_-]*$/.test(cdId.value.trim()) ? '' : 'id 只能用字母、数字、下划线、连字符');
    });
    var addCatBtn = $('btn-add-cat');
    if (addCatBtn) addCatBtn.addEventListener('click', function () { if (editing) openCatAdd(); });

    var exitBtn = $('btn-exit');
    if (exitBtn) exitBtn.addEventListener('click', function () { exit(false); });
    var pubBtn = $('btn-publish');
    if (pubBtn) pubBtn.addEventListener('click', publish);
    var expBtn = $('btn-export');
    if (expBtn) expBtn.addEventListener('click', exportJson);

    var ghForm = $('gh-form');
    if (ghForm) ghForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var repo = $('gh-repo').value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\/+$/, '');
      var branch = $('gh-branch').value.trim() || 'main';
      var token = $('gh-token').value.trim();
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { setNote('仓库格式应为 owner/repo', 'err'); return; }
      if (!token) { setNote('token 不能为空', 'err'); return; }
      writeGh({ repo: repo, branch: branch, token: $('gh-remember').checked ? token : '' });
      var d = $('gh-dialog');
      if (d && typeof d.close === 'function') d.close();
      if (pendingAction === 'publish') { pendingAction = null; publish(); }
    });
    var ghCancel = $('gh-cancel');
    if (ghCancel) ghCancel.addEventListener('click', closeGh);

    window.addEventListener('beforeunload', function (e) {
      if (editing && changes > 0) { e.preventDefault(); e.returnValue = ''; return ''; }
    });
  }

  bind();
  updateBar();
})();
