/* 창의융합프로그램 신청자 명단 점검 — 웹 화면 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var H = Core.HEADER;
  var POLL_MS = 20000;
  // 화면 코드 버전. docs/version.txt 와 같게 맞춥니다 (다르면 '새 버전' 안내)
  var APP_VERSION = '38';
  var S = {
    token: null, user: null, data: null, date: null, rev: null, view: 'home',
    showAll: false, open: null, query: '', busy: false, lastUpload: null, settings: null, loadedAt: null, newVersion: false,
    f: { result: [], state: [], isNew: false, cls: '' }, sort: { col: null, dir: 0 },
    sel: {}, att: null
  };
  var root = document.getElementById('app');

  /* ───────── 공통 도구 ───────── */

  function esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function tip(text) { return '<span class="tip" tabindex="0" role="note" aria-label="' + esc(text) + '" data-tip="' + esc(text) + '">?</span>'; }
  var toastTimer;
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show'; S.toastAt = Date.now();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, ms || 4500);
  }
  function setBusy(b) { S.busy = b; var el = document.getElementById('busy'); if (el) el.className = b ? 'busy-bar' : ''; }

  function jwtPayload(tok) {
    try {
      var s = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(s))));
    } catch (e) { return null; }
  }
  function tokenValid(tok) { var p = tok && jwtPayload(tok); return !!(p && p.exp * 1000 > Date.now() + 60000); }

  function api(action, payload) {
    if (!tokenValid(S.token)) { relogin('로그인 시간이 지났습니다. 다시 로그인해 주세요.'); return Promise.reject(new Error('로그인 필요')); }
    var body = Object.assign({ action: action, token: S.token }, payload || {});
    return fetch(CFG.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) {
          if (res.code === 'AUTH' || res.code === 'FORBIDDEN') relogin(res.error);
          var e = new Error(res.error || '오류'); e.code = res.code; throw e;
        }
        return res;
      });
  }

  /* ───────── 로그인 ───────── */

  function relogin(msg) {
    S.token = null;
    try { sessionStorage.removeItem('idtoken'); } catch (e) { /* 무시 */ }
    showLogin(msg);
  }

  function showLogin(msg) {
    root.innerHTML = '<div class="card login"><div class="brand">창의융합프로그램 신청자 명단 점검</div>' +
      '<p class="muted">등록된 점검자 구글 계정으로 로그인해 주세요.</p>' +
      (msg ? '<p style="color:var(--red)">' + esc(msg) + '</p>' : '') +
      '<div id="gbtn"></div></div>';
    whenGsi(function () {
      google.accounts.id.renderButton(document.getElementById('gbtn'), { theme: 'outline', size: 'large', text: 'signin_with', locale: 'ko' });
      google.accounts.id.prompt();
    });
  }

  function whenGsi(cb) {
    if (window.google && google.accounts && google.accounts.id) { initGsi(); cb(); return; }
    setTimeout(function () { whenGsi(cb); }, 150);
  }
  var gsiInit = false;
  function initGsi() {
    if (gsiInit) return;
    gsiInit = true;
    google.accounts.id.initialize({ client_id: CFG.CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: false });
  }
  function onCredential(resp) {
    S.token = resp.credential;
    try { sessionStorage.setItem('idtoken', S.token); } catch (e) { /* 무시 */ }
    start();
  }

  function boot() {
    if (!CFG.API_URL || /여기에/.test(CFG.API_URL + CFG.CLIENT_ID)) {
      root.innerHTML = '<div class="card login"><b>설정이 필요합니다</b><p class="muted">config.js 에 Apps Script 주소와 클라이언트 ID를 넣어 주세요.</p></div>';
      return;
    }
    var saved = null;
    try { saved = sessionStorage.getItem('idtoken'); } catch (e) { /* 무시 */ }
    if (tokenValid(saved)) { S.token = saved; start(); } else showLogin();
  }

  /** 처음 불러올 때: 돌아가는 표시 + 진행 단계 문구 (멈춘 것처럼 보이지 않도록) */
  function showLoader() {
    var steps = ['서버에 연결하는 중…', '구글 시트에서 명단을 읽는 중…', '점검 결과를 계산하는 중…', '화면을 준비하는 중…'];
    root.innerHTML = '<div class="loader" role="status" aria-live="polite"><div class="spin" aria-hidden="true"></div>' +
      '<div class="ld-title">창의융합프로그램 신청자 명단 점검</div><div class="ld-msg" id="ldmsg">' + steps[0] + '</div>' +
      '<div class="ld-bar" aria-hidden="true"><span id="ldbar"></span></div><div class="ld-sec muted small" id="ldsec"></div></div>';
    var t0 = Date.now();
    var timer = setInterval(function () {
      var m = document.getElementById('ldmsg');
      if (!m) { clearInterval(timer); return; }
      var sec = (Date.now() - t0) / 1000;
      m.textContent = steps[Math.min(steps.length - 1, Math.floor(sec / 2.5))];
      var bar = document.getElementById('ldbar');
      if (bar) bar.style.width = Math.min(95, Math.round(100 * (1 - Math.exp(-sec / 6)))) + '%';
      var sc = document.getElementById('ldsec');
      if (sc) sc.textContent = Math.floor(sec) + '초' + (sec > 8 ? ' · 처음 접속할 때는 구글 서버가 깨어나느라 10~20초 걸릴 수 있습니다' : '');
    }, 250);
  }

  function start() {
    var p = jwtPayload(S.token) || {};
    S.user = { email: p.email, name: p.name };
    showLoader();
    load(null).then(function () {
      try { if (!localStorage.getItem('guide-v2')) { localStorage.setItem('guide-v2', '1'); if (!localStorage.getItem('guide-v1')) showGuide(); } } catch (e) { /* 무시 */ }
    });
    restoreView();
    setInterval(poll, POLL_MS);
    checkVersion();
    setInterval(checkVersion, 10 * 60000);
  }

  /* ───────── 데이터 ───────── */

  function checkVersion() {
    fetch('version.txt?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; })
      .then(function (v) { v = v.trim(); if (v && v !== APP_VERSION && !S.newVersion) { S.newVersion = true; render(); } })
      .catch(function () { /* 다음에 다시 */ });
  }

  function load(date) {
    setBusy(true);
    return api('state', { date: date }).then(function (res) {
      if (S.date !== res.date) { S.att = null; S.sel = {}; }
      // 무엇이 바뀌었으면 설정 화면도 다음에 새로 받기 (고치던 표가 있으면 그대로 둠)
      if (S.rev && res.rev !== S.rev && !Object.keys(S.setDraft || {}).some(function (k) { return S.setDraft[k]; })) S.settings = null;
      S.data = res; S.date = res.date; S.rev = res.rev; S.user = res.user || S.user;
      S.loadedAt = new Date();
      draftRefresh();
      render();
    }).catch(function (e) { if (e.code !== 'AUTH' && e.code !== 'FORBIDDEN') toast(e.message); })
      .then(function () { setBusy(false); });
  }

  function poll() {
    if (S.busy || S.absPending || S.stPending || !S.token || document.visibilityState !== 'visible' || document.querySelector('.modal-bg')) return;
    // 메모를 쓰는 중이면 화면을 다시 그리지 않습니다
    var typing = Array.prototype.some.call(document.querySelectorAll('input.memo'), function (m) { return m.value || m === document.activeElement; });
    var ae = document.activeElement;
    if (typing || (ae && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName) && ae.type !== 'checkbox')) return;
    api('rev').then(function (res) { if (res.rev !== S.rev) load(S.date); }).catch(function () { /* 다음에 다시 */ });
  }

  function clsInfo(name) { return (S.data.classes || []).filter(function (c) { return c['접수명'] === name; })[0] || null; }
  function rowByNo(no) { return S.data.rows.filter(function (r) { return r.no === no; })[0]; }
  function openRows(lv) { return S.data.rows.filter(function (r) { return !r.cancelled && r.level === lv && !r.status; }); }
  function doneRows() { return S.data.rows.filter(function (r) { return r.status; }).sort(function (a, b) { return a.status.at < b.status.at ? 1 : -1; }); }
  function visibleCols() { return H.map(function (h, i) { return i; }).filter(function (i) { return S.showAll || Core.HIDDEN_COLS.indexOf(i) < 0; }); }

  /* ───────── 폴더에서 명단 올리기 ───────── */

  function idb() {
    return new Promise(function (ok, no) {
      var rq = indexedDB.open('weekend-checker', 1);
      rq.onupgradeneeded = function () { rq.result.createObjectStore('kv'); };
      rq.onsuccess = function () { ok(rq.result); };
      rq.onerror = function () { no(rq.error); };
    });
  }
  function idbGet(k) { return idb().then(function (db) { return new Promise(function (ok) { var r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = function () { ok(r.result); }; r.onerror = function () { ok(null); }; }); }); }
  function idbSet(k, v) { return idb().then(function (db) { return new Promise(function (ok) { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = ok; tx.onerror = ok; }); }); }
  function dirKey() { return 'dir:' + ((S.user && S.user.email) || ''); }

  async function getDir(pick) {
    var h = pick ? null : await idbGet(dirKey());
    if (!h) {
      h = await window.showDirectoryPicker({ id: 'weekend-lists', mode: 'read', startIn: 'downloads' });
      await idbSet(dirKey(), h);
    }
    var perm = await h.queryPermission({ mode: 'read' });
    if (perm !== 'granted') perm = await h.requestPermission({ mode: 'read' });
    if (perm !== 'granted') throw new Error('폴더를 읽을 권한이 없습니다.');
    return h;
  }

  async function changeFolder() {
    if (!window.showDirectoryPicker) { toast('이 브라우저는 폴더 지정을 지원하지 않습니다. 크롬이나 엣지를 사용해 주세요.'); return; }
    try { var h = await getDir(true); toast('명단 폴더: ' + h.name); render(); } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  }

  async function uploadFromFolder() {
    if (S.busy) return;
    if (!window.showDirectoryPicker) { document.getElementById('pick').click(); return; }
    var dir;
    try { dir = await getDir(false); } catch (e) { if (e.name !== 'AbortError') toast(e.message); return; }
    setBusy(true);
    try {
      var stat = { found: 0, outside: 0, already: 0 };
      var picked = [];
      for await (var entry of dir.values()) {
        if (entry.kind !== 'file') continue;
        if (!Core.isListFile(entry.name)) continue;
        var file = await entry.getFile();
        var meta = Core.fileStamp(file.name, file.lastModified);
        if (!meta) continue;
        stat.found++;
        if (!Core.inWindow(meta.date, S.date)) { stat.outside++; continue; }
        if ((S.data.uploadedFiles || []).indexOf(file.name + '|' + meta.ts) >= 0) { stat.already++; continue; }
        picked.push(file);
      }
      await sendFiles(picked, stat);
    } catch (e) { toast('명단을 읽는 중 문제가 생겼습니다: ' + e.message); }
    setBusy(false);
  }

  async function uploadFromFiles(fileList, extras) {
    if (S.busy) return;
    setBusy(true);
    try {
      var stat = { found: 0, outside: 0, already: 0 }, picked = [], other = 0;
      Array.prototype.forEach.call(fileList, function (f) {
        var meta = Core.fileStamp(f.name, f.lastModified);
        if (!meta) { other++; return; }
        stat.found++;
        if (!Core.inWindow(meta.date, S.date)) { stat.outside++; return; }
        picked.push(f);
      });
      if (other) toast('명단 파일이 아닌 ' + other + '개는 건너뛰었습니다.');
      await sendFiles(picked, stat, extras);
    } catch (e) { toast(e.message); }
    setBusy(false);
  }

  /*
   * 통합예약 관리자 화면의 즐겨찾기 버튼(통합예약 엑셀 일괄 받기)이 보내는 명단을 바로 받습니다.
   * - 관리자 사이트(cms.use.go.kr)에서 온 메시지만 받습니다.
   * - 엑셀 원본 그대로 받아 [명단 올리기]와 똑같은 경로로 올립니다 (파일로 저장하지 않음).
   * 주고받는 신호: xd-hello → wc-ready / xd-files → wc-received → (사용자 확인) → wc-done 또는 wc-cancel
   */
  var CMS_ORIGIN = CFG.CMS_ORIGIN || 'https://cms.use.go.kr';
  // 창의융합교육센터(누리집 34) 통합예약 목록이 바로 나오는 주소
  var CMS_LIST_URL = CMS_ORIGIN + '/intra/reservation/BD_selectReservationMngList.do?q_rsvtRegSn=&q_rType=&q_searchSiteSn=34&q_rsvtSeCdId=&q_searchSttsSn=&q_searchAplyBgngYmd=&q_searchAplyEndYmd=&q_searchVal=&q_rowPerPage=10&q_currPage=1&q_sortName=&q_sortOrder=';
  // 창 이름: 관리자 화면의 즐겨찾기 버튼이 이 이름으로 이 창을 찾습니다 (새로 열거나 새로고침하지 않도록)
  try { if (window.name !== 'weekendChecker') window.name = 'weekendChecker'; } catch (e) { /* 무시 */ }

  /** [통합예약 관리자 ↗]: 열려 있는 관리자 창이 있으면 그 창으로, 없으면 새 창으로 (이렇게 열면 두 창이 연결됨) */
  function openCms() {
    var w = window.open('', 'cmsAdmin');
    if (!w) { toast('크롬이 새 창을 막았습니다. 주소창 오른쪽의 팝업 차단 표시를 눌러 「항상 허용」을 골라 주세요.', 5000); return; }
    var fresh = false;
    try { fresh = w.location.href === 'about:blank'; } catch (e) { fresh = false; }  // 다른 사이트(관리자 화면)면 읽을 수 없음 = 이미 열린 창
    if (fresh) w.location.href = CMS_LIST_URL;
    try { w.focus(); } catch (e) { /* 무시 */ }
  }
  var cmsBusy = false;
  function cmsReply(src, msg) { try { src.postMessage(msg, CMS_ORIGIN); } catch (e) { /* 창이 닫힘 */ } }
  window.addEventListener('message', function (e) {
    if (e.origin !== CMS_ORIGIN || !e.source || !e.data || typeof e.data !== 'object') return;
    var d = e.data;
    if (d.type === 'xd-hello') {
      // 로그인하고 명단을 다 불러온 뒤에만 준비됐다고 답합니다 (관리자 화면은 1초마다 다시 물어봅니다)
      if (S.token && S.data && !S.busy && !cmsBusy) cmsReply(e.source, { type: 'wc-ready', app: APP_VERSION, date: S.date });
    } else if (d.type === 'xd-files' && !cmsBusy) receiveCms(e.source, d);
  });

  function receiveCms(src, d) {
    var list = Array.isArray(d.files) ? d.files.slice(0, 40) : [];
    var files = [], extras = {};
    list.forEach(function (f) {
      if (!f || typeof f.name !== 'string' || !(f.bytes instanceof ArrayBuffer) || !f.bytes.byteLength || f.bytes.byteLength > 5e6) return;
      var at = +f.at || Date.now();
      files.push({ file: new File([f.bytes], f.name.slice(0, 120), { lastModified: at }), title: String(f.title || '').slice(0, 200) });
      // 관리자 화면에서 읽은 신청일시·취소 시각 (신청일련번호별)
      if (f.extra && typeof f.extra === 'object') Object.keys(f.extra).forEach(function (k) { extras[k] = f.extra[k]; });
    });
    var nCancel = Object.keys(extras).filter(function (k) { return extras[k] && extras[k].c; }).length;
    cmsReply(src, { type: 'wc-received', count: files.length });
    if (!files.length) { cmsReply(src, { type: 'wc-done', ok: false, message: '받은 명단 파일이 없습니다.' }); return; }
    cmsBusy = true;
    try { window.focus(); } catch (e) { /* 무시 */ }
    var round = (S.data.dates || []).filter(function (x) { return x.date === S.date; })[0];
    var html = '<span class="badge new" style="align-self:flex-start">통합예약 관리자 화면에서 받음</span>' +
      '<h2 style="margin:0">명단 ' + files.length + '개가 왔습니다</h2>' +
      '<p style="margin:0">올릴 회차: <b>' + (round ? esc(round.n) + '회차 · ' : '') + esc(md(S.date)) + '</b> <span class="muted small">(다른 회차라면 [취소] 후 회차를 바꾸고 다시 보내 주세요)</span></p>' +
      '<div class="small" style="max-height:240px;overflow:auto;line-height:1.8">' + files.map(function (f) { return '· ' + esc(f.title || f.file.name); }).join('<br>') + '</div>' +
      (Object.keys(extras).length ? '<p class="small" style="margin:0">관리자 화면에서 <b>신청일시</b> ' + Object.keys(extras).length + '명 · <b>취소 시각</b> ' + nCancel + '명도 함께 받았습니다.</p>' : '') +
      '<p class="muted small" style="margin:0">[명단 올리기]와 똑같이 처리합니다. 접수 기간 밖이거나 이미 올라간 것보다 오래된 명단은 건너뜁니다.</p>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn" data-m="no">취소</button><button class="btn primary" data-m="yes">올리기</button></div>';
    modal(html, function (m, b, w, close) {
      close();
      if (m !== 'yes') { cmsBusy = false; cmsReply(src, { type: 'wc-cancel' }); return; }
      S.view = 'home'; render(); window.scrollTo(0, 0);
      uploadFromFiles(files.map(function (f) { return f.file; }), extras).then(function () {
        var u = S.lastUpload || { results: [] };
        cmsReply(src, { type: 'wc-done', ok: true, results: (u.results || []).map(function (r) { return { result: r.result, title: r.cls || r.title || r.file, detail: r.detail || '' }; }),
          skipped: (u.stat && u.stat.outside) || 0, date: S.date });
      }).catch(function (er) {
        cmsReply(src, { type: 'wc-done', ok: false, message: er.message });
      }).then(function () { cmsBusy = false; });
    });
  }

  async function parseFile(file) {
    var buf = await file.arrayBuffer();
    var wb = XLSX.read(buf, { type: 'array' });
    var ws = wb.Sheets[wb.SheetNames[0]];
    var aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
    var header = (aoa[0] || []).map(function (s) { return String(s).trim(); });
    var rows = aoa.slice(1).filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); })
      .map(function (r) { return H.map(function (_, i) { return String(r[i] === undefined || r[i] === null ? '' : r[i]).trim(); }); });
    var meta = Core.fileStamp(file.name, file.lastModified);
    return { fileName: file.name, fileTs: meta.ts, header: header, title: rows.length ? rows[0][1] : '', rows: rows };
  }

  async function sendFiles(files, stat, extras) {
    var parsed = [], empty = 0, bad = 0;
    for (var i = 0; i < files.length; i++) {
      try {
        var p = await parseFile(files[i]);
        if (!p.rows.length) { empty++; continue; }
        parsed.push(p);
      } catch (e) { bad++; }
    }
    // 같은 예약명은 가장 최근 파일만 보냅니다
    var year = S.date.slice(0, 4), latest = {}, older = 0;
    parsed.forEach(function (p) {
      var k = Core.parseTitle(p.title, year).key + '|' + Core.parseTitle(p.title, year).start;
      if (!latest[k] || latest[k].fileTs < p.fileTs) { if (latest[k]) older++; latest[k] = p; } else older++;
    });
    var send = Object.keys(latest).map(function (k) { return latest[k]; });
    var summary = { stat: stat, empty: empty, bad: bad, older: older, results: [], at: new Date() };
    if (!send.length) {
      S.lastUpload = summary; render();
      toast(stat.found ? '새로 올릴 명단이 없습니다.' : '폴더에서 명단 파일을 찾지 못했습니다.');
      return;
    }
    var res = await api('upload', { date: S.date, files: send, extras: extras || null });
    summary.results = res.results;
    S.lastUpload = summary;
    if (res.needMap && res.needMap.length) {
      var maps = await askMapping(res.needMap);
      if (maps) {
        var again = send.filter(function (f) { return res.needMap.some(function (n) { return n.file === f.fileName; }); });
        var res2 = await api('upload', { date: S.date, files: again, mappings: maps, extras: extras || null });
        summary.results = summary.results.filter(function (r) { return r.result !== '연결 필요'; }).concat(res2.results);
      }
    }
    await load(S.date);
  }

  function askMapping(list) {
    return new Promise(function (resolve) {
      var html = '<div class="modal-bg"><div class="modal" role="dialog" aria-labelledby="mt">' +
        '<span class="badge warn" style="align-self:flex-start">예약명 연결 필요</span>' +
        '<h2 id="mt" style="margin:0">이 명단은 어느 반인가요?</h2>' +
        '<p class="muted" style="margin:0">예약명이 설정된 반과 달라 아직 반영하지 않았습니다. 고른 연결은 기억해 두고 다음부터 자동으로 씁니다.</p>';
      list.forEach(function (n, i) {
        html += '<fieldset class="card pad" style="display:flex;flex-direction:column;gap:8px"><legend class="small muted">' + esc(n.file) + ' · ' + n.count + '명</legend>' +
          '<b>' + esc(n.title) + '</b>';
        n.candidates.forEach(function (c, j) {
          html += '<label class="opt"><input type="radio" name="m' + i + '" value="' + esc(c.name) + '"' + (j === 0 ? '' : '') + '><span>' + esc(c.label) + '</span></label>';
        });
        html += '<label class="opt"><input type="radio" name="m' + i + '" value="" checked><span class="muted">건너뛰기 (이번에는 반영 안 함)</span></label></fieldset>';
      });
      html += '<div class="row" style="justify-content:flex-end"><button class="btn" data-m="cancel">모두 건너뛰기</button><button class="btn primary" data-m="ok">연결하고 반영</button></div></div></div>';
      var wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', function (ev) {
        var b = ev.target.closest('[data-m]');
        if (!b) return;
        var out = null;
        if (b.getAttribute('data-m') === 'ok') {
          out = {};
          list.forEach(function (n, i) {
            var sel = wrap.querySelector('input[name="m' + i + '"]:checked');
            if (sel && sel.value) out[n.key] = sel.value;
          });
          if (!Object.keys(out).length) out = null;
        }
        wrap.remove();
        resolve(out);
      });
    });
  }

  /* ───────── 처리 버튼 ───────── */

  /*
   * [완료]·[문제없음]·[되돌리기]: 화면을 바로 바꾸고 구글 시트 저장은 뒤에서 차례로 (전체를 다시 받지 않음)
   * 다른 선생님이 먼저 처리했으면(서버가 알려 줌) 그때만 새로 불러옵니다.
   */
  var stQ = Promise.resolve();
  S.stPending = 0;
  S.srvAt = {};
  function setStatus(no, status, memo) {
    var r = rowByNo(no);
    if (!r) return;
    memo = memo || '';
    if (S.srvAt[no] === undefined) S.srvAt[no] = r.status ? r.status.at : '';
    r.status = status ? { s: status, who: (S.user && S.user.name) || '', at: nowKst() + ':00', memo: memo, pending: true } : null;
    r.changed = false;
    S.open = null;
    render();
    S.stPending++;
    stQ = stQ.then(function () {
      return api('status', { date: S.date, no: no, status: status, memo: memo, prevAt: S.srvAt[no] }).then(function (res) {
        if (res.conflict) { toast(res.message, 5000); delete S.srvAt[no]; return load(S.date); }
        S.srvAt[no] = res.status ? res.status.at : '';
        var cur = rowByNo(no);
        if (cur && cur.status && cur.status.pending && res.status && cur.status.s === res.status.s) cur.status = res.status;
        if (res.rev && S.stPending === 1) S.rev = res.rev;
      });
    }).catch(function (e) { toast('처리 상태를 저장하지 못했습니다: ' + e.message + ' — 새로 불러옵니다.', 5000); delete S.srvAt[no]; return load(S.date); })
      .then(function () { S.stPending = Math.max(0, S.stPending - 1); if (!S.stPending) S.srvAt = {}; });
  }

  /* ───────── 화면 ───────── */

  var VIEWS = [['home', '홈'], ['review', '점검 목록'], ['full', '전체 명단'], ['att', '출석부'], ['abs', '결석'], ['uploads', '업로드 기록'], ['settings', '설정']];

  function render() {
    if (!S.data) return;
    var counts = { red: openRows('red').length, amber: openRows('amber').length };
    var html = '<header class="top"><div class="wrap"><span class="brand">창의융합프로그램 신청자 명단 점검</span><nav class="menu" aria-label="메뉴">' +
      VIEWS.map(function (v) {
        var n = v[0] === 'review' && (counts.red + counts.amber) ? ' (' + (counts.red + counts.amber) + ')' : '';
        return '<button data-view="' + v[0] + '" class="' + (S.view === v[0] ? 'on' : '') + '">' + v[1] + n + '</button>';
      }).join('') + '</nav>' + (S.date ? '<span class="hbreak" aria-hidden="true"></span><div class="ctx-head">' + ctxHtml() + '</div>' : '') + '<div class="top-right"><span class="muted small">' + (S.loadedAt ? S.loadedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' 기준' : '') + '</span>' +
      '<button class="btn sm" data-act="cms" title="통합예약 관리자 화면을 새 창으로 엽니다. 이미 열려 있으면 그 창으로 갑니다. 이렇게 연 창의 즐겨찾기 버튼은 이 웹앱 창으로 명단을 바로 보냅니다.">통합예약 관리자 ↗</button>' +
      '<button class="btn sm" data-act="refresh" title="서버에서 최신 명단·처리 상태·설정을 다시 불러옵니다">새로고침</button><button class="btn sm" data-act="guide">? 도움말</button>' +
      '<a href="' + esc(S.data.sheetUrl) + '" target="_blank" rel="noopener">구글 시트</a><span class="chip">' + esc((S.data.user && S.data.user.name) || '') + ' 선생님</span></div></div><div id="busy" class="' + (S.busy ? 'busy-bar' : '') + '"></div></header>';
    if (S.newVersion) html += '<div class="wrap"><div class="card pad row between" style="margin-top:12px;border-color:#BFD0F5;background:#F0F5FF"><span>웹앱 새 버전이 나왔습니다.</span><button class="btn sm primary" data-act="update">지금 적용</button></div></div>';
    if (S.date) html += '<div class="ctx-mob">' + ctxHtml() + '</div>' + flowBar(counts);
    html += '<main class="wrap">';
    if (!S.date) html += '<div class="card pad">설정_수업일 탭에 수업일이 없습니다. 구글 시트에서 수업일을 먼저 입력해 주세요.</div>';
    else if (S.view === 'home') html += viewHome(counts);
    else if (S.view === 'review') html += viewReview();
    else if (S.view === 'full') html += viewFull();
    else if (S.view === 'uploads') html += viewUploads();
    else if (S.view === 'settings') html += viewSettings();
    else if (S.view === 'att') html += viewAtt();
    else if (S.view === 'abs') html += viewAbs();
    else if (S.view === 'guide') html += viewGuide();
    html += '</main><input type="file" id="pick" accept=".xls" multiple hidden>';
    var y = window.scrollY;
    root.innerHTML = html;
    window.scrollTo(0, y);
  }

  /** 제목 아래 「작업 기준」: 운영 시기 › 회차. 모든 화면이 이 회차를 기준으로 동작 */
  function currentRoundDate() { return Core.currentRound(S.data.dates || [], (S.data.today || nowKst().slice(0, 10))); }
  function ctxHtml() {
    var cur = currentRoundDate(), off = cur && S.date !== cur;
    return '<div class="ctx' + (off ? ' off' : '') + '"><span class="ctx-term">📌 ' + esc(S.data.termName || '2026 하반기 주말') + ' ›</span>' + roundSelect() +
      (off ? '<b class="ctx-warn">⚠ ' + (S.date < cur ? '지난' : '다음') + ' 회차</b><button class="btn sm primary" data-x="round-now">이번 회차로</button>' : '') + '</div>';
  }

  function roundSelect() {
    return '<select class="round-sel" aria-label="수업 회차">' + S.data.dates.map(function (d) {
      return '<option value="' + esc(d.date) + '"' + (d.date === S.date ? ' selected' : '') + '>' + esc(d.n) + '회차 · ' + esc(Core.shortDate(d.date)) + (d.note ? ' · ' + esc(d.note) : '') + '</option>';
    }).join('') + '</select>';
  }

  function viewHome(counts) {
    var from = Core.addDays(S.date, -Core.WINDOW_DAYS);
    var html = '<section class="card pad row between"><div style="display:flex;flex-direction:column;gap:6px">' +
      '<b>명단 올리기</b><span class="muted small">' + esc(Core.shortDate(from)) + ' ~ ' + esc(Core.shortDate(S.date)) + '에 받은 파일만 올라갑니다 · 즐겨찾기 버튼으로 보내면 폴더 없이 바로 올라옵니다</span></div>' +
      '<div class="row"><button class="btn" data-act="folder">폴더 변경</button>' + tip('통합예약 엑셀이 저장되는 폴더를 지정합니다. 크롬은 다운로드 폴더 자체는 열지 못하게 막으므로, 다운로드 폴더 안에 「주말명단」 같은 하위 폴더를 만들어 지정하세요. 계정과 PC마다 한 번만 지정하면 기억합니다.') +
      '<button class="btn primary" data-act="upload">명단 올리기</button>' + tip('지정한 폴더에서 이번 접수 기간에 받은 「통합예약신청자목록」 파일 중 아직 안 올린 것만 골라 올립니다. 같은 반 파일이 여러 개면 가장 최근 파일만 반영합니다.') + '</div>' +
      '<div class="drop" id="drop" style="flex-basis:100%">' + (window.showDirectoryPicker ? '크롬·엣지가 아니라면 여기에 엑셀 파일을 끌어다 놓으세요' : '이 기기에서는 폴더 지정이 안 되어 [명단 올리기]를 누르면 파일을 직접 고릅니다 (명단 올리기는 PC를 권장합니다)') + '</div></section>';

    if (S.lastUpload) html += uploadResult(S.lastUpload);

    var done = doneRows().length;
    html += '<section class="tiles"><div class="card tile"><span class="muted small">취소 대상 · 미처리 ' + tip('중복 신청, 단체 신청, 대상 학년, 관외 학교, 신청 제한 학생. 연락 후 취소 처리할 대상입니다.') + '</span><strong style="color:var(--red)">' + counts.red + '건</strong></div>' +
      '<div class="card tile"><span class="muted small">확인 필요 · 미처리 ' + tip('입력 내용 오류, 학부모 연락처 필요. 보호자에게 연락해 확인한 뒤 통합예약시스템 관리자 페이지에서 원본을 고칩니다. 원본을 고쳐 두면 다음 명단부터 다시 걸리지 않습니다.') + '</span><strong style="color:var(--amber)">' + counts.amber + '건</strong></div>' +
      '<div class="card tile"><span class="muted small">처리 완료 · 문제없음</span><strong>' + done + '건</strong></div></section>';

    ['오전', '오후'].forEach(function (t) {
      var list = S.data.classes.filter(function (c) { return c['시간대'] === t; });
      if (!list.length) return;
      html += '<h2>' + t + '</h2><section class="cards">' + list.map(function (c) {
        var rows = S.data.rows.filter(function (r) { return r.cls === c['접수명']; });
        var live = rows.filter(function (r) { return !r.cancelled; });
        var red = live.filter(function (r) { return r.level === 'red' && !r.status; }).length;
        var amber = live.filter(function (r) { return r.level === 'amber' && !r.status; }).length;
        var approved = live.filter(function (r) { return r.cells[12] === '승인'; }).length;
        var waiting = live.filter(function (r) { return r.cells[12] === '대기'; });
        var waitOk = waiting.filter(function (r) { return !r.level || r.status; }).length;
        var fresh = live.filter(function (r) { return r.isNew; }).length;
        var go = esc(c['접수명']);
        return '<article class="card ccard"><div class="row between"><b>' + esc(c['접수명']) + '</b><span class="muted small">' + esc(c.rangeText) + '</span></div>' +
          '<div>신청 <b style="font-size:20px">' + live.length + '</b> <span class="muted">/ 정원 ' + esc(c.cap) + ' · 승인 ' + approved + '</span></div>' +
          '<div class="row"><span class="badge red">취소 대상 ' + red + '</span><span class="badge amber">확인 필요 ' + amber + '</span></div>' +
          (waiting.length ? '<button class="btn sm" data-go="wait" data-cls="' + go + '" title="전체 명단에서 이 반의 대기 신청만 봅니다">승인 대상(대기) ' + waiting.length + '명 · 이상 없음 ' + waitOk + (waiting.length - waitOk ? ' · 문제 ' + (waiting.length - waitOk) : '') + '</button>' : '<span class="muted small">승인 대상(대기) 없음</span>') +
          (fresh ? '<button class="btn sm" data-go="new" data-cls="' + go + '">새로 들어옴 ' + fresh + '명</button>' : '') +
          '<div class="muted small">' + (c.lastAt ? '최종 업로드 ' + esc(c.lastAt.slice(5, 16)) + ' · ' + esc(c.lastBy) : '아직 올린 명단 없음') + '</div></article>';
      }).join('') + '</section>';
    });
    return html;
  }

  function uploadResult(u) {
    var html = '<section class="card pad" style="border-color:#BFD0F5"><div class="row between"><b>업로드 결과 · ' + u.at.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) + '</b><button class="btn sm" data-act="close-result">닫기</button></div>' +
      '<p class="muted small" style="margin:6px 0">명단 파일 ' + u.stat.found + '개 확인 · 접수 기간 밖 ' + u.stat.outside + '개 · 이미 올린 파일 ' + u.stat.already + '개 · 같은 반 이전 파일 ' + u.older + '개' +
      (u.empty ? ' · 빈 명단 ' + u.empty + '개' : '') + (u.bad ? ' · 읽지 못한 파일 ' + u.bad + '개' : '') + '</p>';
    u.results.forEach(function (r) {
      var color = r.result === '반영' ? 'var(--blue)' : (r.result === '오류' ? 'var(--red)' : 'var(--muted)');
      html += '<div class="result-line"><b style="color:' + color + '">' + esc(r.result) + '</b><span style="flex:1">' + esc(r.cls || r.title) + '</span><span class="muted">' + esc(r.detail) + '</span>' +
        (r.warning ? '<span class="badge warn">' + esc(r.warning) + '</span>' : '') + '</div>';
    });
    if (!u.results.length) html += '<div class="muted">새로 반영한 명단이 없습니다.</div>';
    return html + '</section>';
  }

  function issueBadges(r) {
    return r.issues.map(function (i) { return '<span class="badge ' + i.level + '">' + esc(i.label) + '</span>'; }).join(' ');
  }
  function issueDetail(r) { return r.issues.map(function (i) { return esc(i.detail); }).join('<br>'); }

  function colsToolbar() {
    return '<label class="row small" style="min-height:44px"><input type="checkbox" data-act="cols"' + (S.showAll ? ' checked' : '') + ' style="width:18px;height:18px">모든 열 보기 ' +
      tip('기본으로 감춘 이메일·단체명·단체인원수·기타내용 열을 보여 줍니다.') + '</label>';
  }

  function dataCells(r, cols, hl, extra) {
    return cols.map(function (i) {
      var v = r.cells[i];
      var title = '';
      if (i === 1) { title = v; v = r.cls; }
      var cls = hl && hl[i] ? ' class="' + hl[i] + '"' : '';
      if (i === 0 && r.appliedAt) title = '신청 ' + r.appliedAt;
      var more = i === 12 && r.cancelAt && /예약취소/.test(v) ? '<div class="small muted">' + esc(shortTs(r.cancelAt)) + ' 취소</div>' : '';
      return '<td' + cls + ' title="' + esc(title || r.cells[i]) + '">' + esc(v) + more + (extra && extra[i] ? ' ' + extra[i] : '') + '</td>';
    }).join('');
  }

  function actionCell(r) {
    if (r.status) {
      return '<span class="badge done">' + (r.status.s === 'ok' ? '문제없음' : '처리 완료') + '</span><div class="small muted">' + esc(r.status.who) + ' · ' + esc(r.status.at.slice(5, 16)) + '</div>' +
        (r.status.memo ? '<div class="small">' + esc(r.status.memo) + '</div>' : '') + '<button class="btn sm" data-undo="' + esc(r.no) + '">되돌리기</button>';
    }
    return '<div class="row" style="gap:6px"><input type="text" class="memo" placeholder="메모" aria-label="메모">' +
      '<button class="btn sm primary" data-done="' + esc(r.no) + '">완료</button><button class="btn sm" data-ok="' + esc(r.no) + '">문제없음</button></div>';
  }

  /* 휴대폰용 신청 카드 */
  function mobileCard(r) {
    var c = r.cells;
    return '<div class="mcard"><div class="row">' + issueBadges(r) + (r.changed ? '<span class="badge warn">내용 변경됨</span>' : '') + '</div>' +
      '<div><b style="font-size:16px">' + esc(c[9]) + '</b> · ' + esc(c[10]) + ' · ' + esc(c[11]) + '</div>' +
      '<div class="small muted">' + esc(r.cls) + ' · ' + esc(c[12]) + ' · 신청번호 ' + esc(c[0]) + '</div>' +
      '<div class="small">신청자 ' + esc(c[2]) + ' · <a href="tel:' + esc(c[3].replace(/[^0-9]/g, '')) + '">' + esc(c[3]) + '</a></div>' +
      '<div class="small">' + issueDetail(r) + '</div>' + actionCell(r) + '</div>';
  }

  /** 이번 회차 신청 제한 학생과 이번 주 신청 여부 (학생명 + 정식 학교 이름으로 찾기) */
  function restrictMatches() {
    var memo = {};
    // 같은 학생(이름·학교)·같은 결석일의 기록은 한 줄로 (신청했던 반이 여럿이면 함께)
    var groups = [];
    (S.data.restrictions || []).forEach(function (r) {
      var g = groups.filter(function (x) { return x.name === r.name && x.absent === r.absent && Core.sameSchool(x.school, r.school, S.data.schools || [], memo) === 'same'; })[0];
      if (!g) { g = { name: r.name, school: r.school, absent: r.absent, ban: '', parent: '', phone: '', items: [], memo: [] }; groups.push(g); }
      g.ban = g.ban || r.ban || ''; g.parent = g.parent || r.parent || ''; g.phone = g.phone || r.phone || '';
      g.items.push({ cls: r.cls || '', reason: r.reason || '', cancelAt: r.cancelAt || '' });
      if (r.memo) g.memo.push(r.memo);
    });
    return groups.map(function (rs) {
      var hits = [];
      (S.data.rows || []).forEach(function (r) {
        if (Core.str(r.cells[9]) !== Core.str(rs.name)) return;
        var rel = Core.sameSchool(rs.school, r.cells[10], S.data.schools || [], memo);
        if (rel !== 'diff') hits.push({ row: r, rel: rel });
      });
      hits.sort(function (a, b) { return (a.rel === 'same' ? 0 : 1) - (b.rel === 'same' ? 0 : 1); });
      return { rs: rs, hits: hits, state: hits.some(function (h) { return h.rel === 'same' && !h.row.cancelled; }) ? 'yes' : (hits.some(function (h) { return !h.row.cancelled; }) ? 'maybe' : 'no') };
    }).sort(function (a, b) { var o = { yes: 0, maybe: 1, no: 2 }; return (o[a.state] - o[b.state]) || String(a.rs.name).localeCompare(String(b.rs.name), 'ko'); });
  }

  function restrictCard() {
    var list = restrictMatches();
    if (!list.length) return '';
    var yes = list.filter(function (x) { return x.state === 'yes'; }).length, maybe = list.filter(function (x) { return x.state === 'maybe'; }).length;
    var open = yes + maybe > 0;
    return '<details class="card pad rcard"' + (open ? ' open' : '') + '><summary><b>🚫 이번 회차 신청 제한 ' + list.length + '명</b> <span class="small">(' + esc(md(S.date)) + ' 수업)' +
      (yes ? ' · <b style="color:var(--red)">신청함 ' + yes + '명</b>' : '') + (maybe ? ' · <b style="color:var(--amber)">학교 확인 ' + maybe + '명</b>' : '') + '</span> ' +
      tip('지난 회차 결석 기록 중 출석 인정이 아닌 학생과, 설정의 신청제한 명단에 적은 학생입니다. 학생명이 같고 정식 학교 이름이 같으면 「신청함」, 학교를 정할 수 없으면 「학교 확인」입니다. 잘못 제한된 학생은 결석 메뉴에서 그 회차로 가서 「출석 인정」에 체크하면 빠집니다.') + '</summary>' +
      '<div class="tbox" style="margin-top:8px"><table class="grid rtbl"><thead><tr><th>학생명</th><th>학교</th><th>학반</th><th>신청자 (연락처)</th><th>사유 · 취소 시각</th><th>신청했던 반 (수업일)</th><th>이번 주 신청</th></tr></thead><tbody>' + list.map(function (x) {
        var rs = x.rs, h = x.hits.filter(function (y) { return !y.row.cancelled; });
        var cell = x.state === 'no' ? '<span class="muted">아직 신청 안 함</span>' : h.map(function (y) {
          return '<div><b style="color:' + (y.rel === 'same' ? 'var(--red)' : 'var(--amber)') + '">⚠ ' + (y.rel === 'same' ? '신청함' : '신청했을 수 있음 · 학교 확인') + '</b> ' +
            esc(y.row.cls) + ' · ' + esc(y.row.cells[12]) + (y.rel === 'same' ? '' : ' · 적힌 학교 「' + esc(y.row.cells[10]) + '」') + ' <button class="btn sm" data-x="r-find" data-name="' + esc(rs.name) + '">보기</button></div>';
        }).join('');
        var reasons = rs.items.map(function (it) { return esc(it.reason) + (it.cancelAt ? ' <b style="color:var(--red);white-space:nowrap">' + esc(it.cancelAt) + ' 취소</b>' : ''); });
        var uniq = reasons.filter(function (v, k) { return reasons.indexOf(v) === k; });
        return '<tr class="' + (x.state === 'no' ? 'muted' : '') + '"><td><b>' + esc(rs.name) + '</b></td><td>' + esc(rs.school) + '</td><td>' + esc(rs.ban || '—') + '</td>' +
          '<td>' + esc(rs.parent || '—') + (rs.phone ? '<br><a class="small" href="tel:' + esc(String(rs.phone).replace(/[^0-9]/g, '')) + '">' + esc(rs.phone) + '</a>' : '') + '</td>' +
          '<td>' + uniq.join('<br>') + (rs.memo.length ? '<br><span class="muted small">' + esc(rs.memo.join(' / ')) + '</span>' : '') + '</td>' +
          '<td>' + (rs.items.map(function (it) { return esc(it.cls || '—'); }).filter(function (v, k, a) { return a.indexOf(v) === k; }).join('<br>')) + ' <span class="muted small">(' + esc(Core.shortDate(rs.absent) || '') + ')</span></td>' +
          '<td>' + cell + '</td></tr>';
      }).join('') + '</tbody></table></div></details>';
  }

  function viewReview() {
    var cols = visibleCols();
    var head = cols.map(function (i) { return '<th>' + (i === 1 ? '반' : esc(H[i])) + '</th>'; }).join('') + '<th class="chk">사유</th><th>자세한 내용</th><th>처리</th>';
    var sections = [
      ['red', '취소 대상 · 미처리', '중복 · 단체 · 대상 학년 · 관외 · 신청 제한 — 먼저 처리', openRows('red')],
      ['amber', '확인 필요 · 미처리', '입력 내용 오류 · 학부모 연락처 필요 — 보호자에게 연락해 확인한 뒤 <b>통합예약시스템 관리자 페이지에서 원본 수정</b> (다음 명단부터 다시 걸리지 않습니다)', openRows('amber')],
      ['done', '처리 완료 · 문제없음', '최근 처리한 것이 위 · 잘못 누른 것은 되돌리기', doneRows()]
    ];
    var html = restrictCard() + '<section class="card pad row between"><div class="row">' + colsToolbar() + '</div>' +
      '<span class="muted small">열 순서는 엑셀 원본과 같습니다 ' + tip('완료: 연락·취소 등 조치를 함 / 문제없음: 확인해 보니 정상. 처리한 항목은 아래 「처리 완료」로 내려갑니다. 신청 내용이 나중에 바뀌면 다시 미처리로 올라옵니다.') + '</span></section>';
    sections.forEach(function (s) {
      html += '<section class="card" style="overflow:hidden"><div class="sec-head ' + s[0] + '"><span class="badge ' + s[0] + '">' + s[1] + ' ' + s[3].length + '건</span><span class="small">' + s[2] + '</span></div>';
      if (!s[3].length) { html += '<div class="pad muted small">없습니다.</div></section>'; return; }
      html += '<div class="tbox only-desk"><table class="grid"><thead><tr>' + head + '</tr></thead><tbody>' + s[3].map(function (r) {
        return '<tr>' + dataCells(r, cols, null) + '<td class="chk">' + issueBadges(r) + (r.changed ? ' <span class="badge warn">내용 변경됨</span>' : '') + '</td><td style="min-width:220px">' + issueDetail(r) + '</td><td style="min-width:230px">' + actionCell(r) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
      html += '<div class="only-mobile">' + s[3].map(mobileCard).join('') + '</div></section>';
    });
    return html;
  }

  var WIDTH = { 0: 86, 1: 130, 2: 76, 3: 118, 4: 140, 5: 84, 6: 90, 7: 70, 8: 200, 9: 76, 10: 120, 11: 84, 12: 74, 13: 120 };

  function fullTableHtml() {
    var cols = visibleCols();
    var q = S.query.trim();
    var colgroup = '<colgroup><col style="width:36px">' + cols.map(function (i) { return '<col style="width:' + WIDTH[i] + 'px">'; }).join('') + '<col style="width:200px"><col style="width:150px"></colgroup>';
    var total = cols.reduce(function (a, i) { return a + WIDTH[i]; }, 0) + 386;
    var letters = linkLetters();
    var absNos = {};
    (S.data.absences || []).forEach(function (a) { if (a.no) absNos[a.no] = true; });
    var mark = function (k) { return S.sort.col === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''; };
    var head = '<th><span class="sr-only">선택</span></th>' + cols.map(function (i) { return '<th><button class="sorth" data-sort="' + i + '" title="눌러서 정렬 (오름차순 → 내림차순 → 원래 순서)">' + esc(H[i]) + mark(String(i)) + '</button></th>'; }).join('') +
      '<th class="chk"><button class="sorth" data-sort="result">점검결과' + mark('result') + '</button></th><th>처리</th>';
    var body = '';
    var shownTotal = 0;
    ['오전', '오후'].forEach(function (t) {
      S.data.classes.filter(function (c) { return c['시간대'] === t && (!S.f.cls || c['접수명'] === S.f.cls); }).forEach(function (c) {
        var rows = sortRows(S.data.rows.filter(function (r) { return r.cls === c['접수명']; }));
        var live = rows.filter(function (r) { return !r.cancelled; });
        var by = {};
        rows.forEach(function (r) { var k = r.cells[12] || '-'; by[k] = (by[k] || 0) + 1; });
        var stat = Object.keys(by).map(function (k) { return k + ' ' + by[k]; }).join(' · ');
        var allCount = rows.length;
        if (q) rows = rows.filter(function (r) { return [r.cells[9], r.cells[2], r.cells[3]].join(' ').indexOf(q) >= 0; });
        rows = rows.filter(passFilter);
        shownTotal += rows.length;
        body += '<tr class="group"><td colspan="' + (cols.length + 3) + '">' + t + ' · ' + esc(c['접수명']) + ' <span class="muted small" style="font-weight:400">신청 ' + live.length + ' / 정원 ' + esc(c.cap) + (stat ? ' · ' + esc(stat) : '') +
          ' · ' + (c.lastAt ? '최종 업로드 ' + esc(c.lastAt.slice(5, 16)) + ' ' + esc(c.lastBy) : '아직 올린 명단 없음') + (rows.length !== allCount ? ' · <b>표시 ' + rows.length + '명</b>' : '') + '</span></td></tr>';
        rows.forEach(function (r) {
          var active = !r.cancelled && r.level && !r.status;
          var hl = {};
          if (active) r.issues.forEach(function (i) { i.cells.forEach(function (ci) { if (!hl[ci] || i.level === 'red') hl[ci] = 'hl-' + i.level; }); });
          var trc = r.cancelled ? 'cancel' : (active ? 'lv-' + r.level : '');
          var result = r.cancelled ? '예약취소 · 점검 제외' : (r.issues.length ? r.issues.map(function (i) { return i.label; }).filter(function (x, k, a) { return a.indexOf(x) === k; }).join(', ') : '');
          var resultHtml = (r.isNew ? '<span class="badge new">새로 들어옴</span> ' : '') + (!r.cancelled && !r.issues.length ? '<span class="badge ok">이상 없음</span>' : '<b>' + esc(result) + '</b>');
          var act = active ? '<button class="btn sm" data-expand="' + esc(r.no) + '">' + (S.open === r.no ? '닫기' : '처리') + '</button>' :
            (r.status ? '<span class="small muted">' + (r.status.s === 'ok' ? '문제없음' : '완료') + ' · ' + esc(r.status.who) + '</span>' : '');
          if (r.cancelled) act = '';
          act += ' <button class="btn sm' + (absNos[r.no] ? ' absent-on' : '') + '" data-keepabs="' + esc(r.no) + '" title="' + (absNos[r.no] ? '결석 표시 해제' : '결석으로 표시하고 결석 기록에 넣습니다') + '">' + (absNos[r.no] ? '결석 ✓' : '결석') + '</button>';
          var lt = letters[r.no] ? { 9: '<span class="badge link">🔗' + esc(letters[r.no]) + '</span>' } : null;
          body += '<tr class="' + trc + '"><td><input type="checkbox" class="selbox" data-sel="' + esc(r.no) + '" aria-label="선택"' + (S.sel[r.no] ? ' checked' : '') + ' style="width:18px;height:18px"></td>' + dataCells(r, cols, hl, lt) + '<td class="chk" title="' + esc(r.issues.map(function (i) { return i.detail; }).join(' / ')) + '">' + resultHtml + '</td><td>' + act + '</td></tr>';
          if (active && S.open === r.no) {
            body += '<tr class="expand"><td colspan="' + (cols.length + 3) + '"><div class="row">' + issueBadges(r) + '<span>' + issueDetail(r) + '</span>' + actionCell(r) + '</div></td></tr>';
          }
        });
      });
    });
    if (!shownTotal && (q || filterOn())) body += '<tr><td colspan="' + (cols.length + 3) + '" class="muted" style="padding:16px">조건에 맞는 신청이 없습니다.</td></tr>';
    return '<div class="tbox tall"><table class="grid fixed" style="min-width:' + total + 'px">' + colgroup + '<thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  /* ───────── 정렬·빠른 필터 ───────── */

  function resultCat(r) {
    if (r.cancelled) return 'cancel';
    if (r.status) return 'done';
    if (r.level === 'red') return 'red';
    if (r.level === 'amber') return 'amber';
    return 'clean';
  }
  function filterOn() { return S.f.result.length || S.f.state.length || S.f.isNew || S.f.cls; }
  function passFilter(r) {
    if (S.f.result.length && S.f.result.indexOf(resultCat(r)) < 0) return false;
    if (S.f.state.length && S.f.state.indexOf(r.cells[12]) < 0) return false;
    if (S.f.isNew && !r.isNew) return false;
    return true;
  }
  var RANK = { red: 0, amber: 1, done: 2, clean: 3, cancel: 4 };
  function sortKey(r, col) {
    if (col === 'result') return RANK[resultCat(r)];
    var v = r.cells[+col] || '';
    if (col === '0') return +v || 0;
    if (col === '10') return Core.schoolKey(v) + '\u0001' + v;
    if (col === '11') { var m = /(\d)/.exec(v); return m ? +m[1] : 99; }
    return v;
  }
  function sortRows(rows) {
    var col = S.sort.col, dir = S.sort.dir;
    return rows.slice().sort(function (a, b) {
      if (col !== null && dir) {
        var x = sortKey(a, col), y = sortKey(b, col);
        var c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko');
        if (c) return c * dir;
      }
      return (a.cancelled - b.cancelled) || (a.seq - b.seq);
    });
  }
  function saveView() {
    try { localStorage.setItem('full-view', JSON.stringify({ f: { result: S.f.result, state: S.f.state, isNew: S.f.isNew }, sort: S.sort })); } catch (e) { /* 무시 */ }
  }
  function restoreView() {
    try {
      var v = JSON.parse(localStorage.getItem('full-view') || 'null');
      if (v) { S.f.result = v.f.result || []; S.f.state = v.f.state || []; S.f.isNew = !!v.f.isNew; S.sort = v.sort || S.sort; }
    } catch (e) { /* 무시 */ }
  }
  function chip(group, value, label, tipText) {
    var on = group === 'isNew' ? S.f.isNew : S.f[group].indexOf(value) >= 0;
    return '<button class="fchip' + (on ? ' on' : '') + '" data-fq="' + group + ':' + value + '" aria-pressed="' + on + '"' + (tipText ? ' title="' + esc(tipText) + '"' : '') + '>' + label + '</button>';
  }
  function filterBar() {
    var opts = '<option value="">전체 반</option>' + S.data.classes.map(function (c) {
      return '<option value="' + esc(c['접수명']) + '"' + (S.f.cls === c['접수명'] ? ' selected' : '') + '>' + esc(c['시간대'] + ' · ' + c['접수명']) + '</option>';
    }).join('');
    return '<div class="row small" style="gap:6px">' +
      '<span class="muted">점검결과</span>' + chip('result', 'red', '취소 대상') + chip('result', 'amber', '확인 필요') + chip('result', 'clean', '이상 없음') + chip('result', 'done', '처리 완료') +
      '<span class="muted" style="margin-left:8px">대기여부</span>' + chip('state', '승인', '승인') + chip('state', '대기', '대기') + chip('state', '추가대기', '추가대기') + chip('state', '예약취소', '예약취소') +
      '<span style="margin-left:8px"></span>' + chip('isNew', '1', '새로 들어옴', '가장 최근 업로드에서 처음 나타난 신청') +
      '<select id="fcls" aria-label="반 고르기" style="margin-left:8px">' + opts + '</select>' +
      ((filterOn() || S.sort.dir) ? '<button class="btn sm" data-act="clear-filter">필터·정렬 모두 해제</button>' : '') + '</div>';
  }

  function viewFull() {
    return '<section class="card pad row between"><div class="row">' +
      '<input type="search" id="q" value="' + esc(S.query) + '" placeholder="학생명 · 신청자명 · 연락처" aria-label="검색" style="width:220px">' + colsToolbar() + '</div>' +
      '<div class="row small muted"><span class="badge" style="background:var(--red-bg);color:var(--red)">취소 대상</span><span class="badge" style="background:var(--amber-bg);color:var(--amber)">확인 필요</span><span class="badge" style="background:var(--red-cell);color:#fff">문제 칸</span>' + tip('열 제목을 누르면 반 안에서 정렬됩니다 (오름차순 → 내림차순 → 원래 엑셀 순서). 학교명은 앞 두 글자, 학반은 학년 숫자 기준입니다. 아래 버튼으로 원하는 신청만 골라 볼 수 있고, 같은 줄의 버튼은 하나라도 맞으면 보입니다.') + '</div>' +
      '<div id="fbar" style="flex-basis:100%">' + filterBar() + '</div>' +
      '<div class="row" style="flex-basis:100%;gap:8px"><button class="btn sm" data-act="links">🔗 같은 반 요청 목록 (' + dateLinks().length + ')</button>' +
      '<button class="btn sm" data-act="raw-export" title="정렬·필터 없이 반별 원본 엑셀 순서 그대로, 모든 열을 내려받습니다">전체 명단 엑셀 내려받기 (원본 그대로)</button>' +
      tip('학생 줄 앞 칸을 체크해 2명 이상 고르면 「같은 반 요청으로 묶기」가 나타납니다. 묶은 요청은 출석부 분반 때 적용됩니다.') + '</div></section>' +
      '<div id="selbar">' + selBar() + '</div>' +
      '<section class="card" id="full-table" style="overflow:hidden">' + fullTableHtml() + '</section>';
  }

  /* 검색: 입력칸은 그대로 두고 표만 다시 그립니다 (한글 조합 중에는 기다림) */
  function applySearch(value) {
    S.query = value;
    refreshFull();
  }
  function refreshFull() {
    var box = document.getElementById('full-table');
    if (box) box.innerHTML = fullTableHtml();
    var bar = document.getElementById('fbar');
    if (bar) bar.innerHTML = filterBar();
    var sb = document.getElementById('selbar');
    if (sb) sb.innerHTML = selBar();
  }

  function viewUploads() {
    var list = S.data.uploads || [];
    return '<section class="card pad row"><span class="muted small">이 회차와 접수 기간에 올린 기록</span></section><section class="card" style="overflow:hidden"><div class="tbox"><table class="grid"><thead><tr><th>올린 시각</th><th>올린 사람</th><th>접수명</th><th>인원</th><th>파일</th><th>파일 받은 시각</th></tr></thead><tbody>' +
      (list.length ? list.map(function (u) {
        return '<tr><td>' + esc(u.at) + '</td><td>' + esc(u.by) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.count) + '</td><td>' + esc(u.file) + '</td><td>' + esc(u.fileTs.replace('T', ' ').slice(0, 16)) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">기록이 없습니다.</td></tr>') + '</tbody></table></div></section>';
  }

  /* ───────── 설정 (구글 시트 대신 웹앱에서) ───────── */

  var GRADES = ['초1', '초2', '초3', '초4', '초5', '초6', '중1', '중2', '중3', '고1', '고2', '고3'];
  function setSpec(tab) {
    var s = S.settings || {};
    var clsNames = ((s.edit && s.edit.classes) || []).map(function (r) { return r[2] || r[1]; }).filter(Boolean);
    return {
      dates: { title: '수업일', help: '회차와 수업일입니다. 수업이 없는 주는 빼면 됩니다. 저장하면 날짜순으로 정렬됩니다.',
        cols: [{ h: '회차', w: 70 }, { h: '수업일', t: 'date', w: 170 }, { h: '비고 (예: 마스터 2기 시작)', w: 280 }] },
      classes: { title: '반 (접수 단위)', help: '통합예약 예약명 하나가 접수명 하나입니다. 한 수업반을 학년별로 따로 받으면 줄을 나눠 같은 수업반 이름을 적습니다. 운영 회차를 비우면 처음부터 끝까지입니다.',
        cols: [{ h: '시간대', t: 'sel', o: ['오전', '오후'], w: 80 }, { h: '수업반', w: 120 }, { h: '접수명', w: 170, ph: '비우면 수업반과 같음' }, { h: '예약명 키워드', w: 150 },
          { h: '대상 시작', t: 'sel', o: GRADES, w: 80 }, { h: '대상 끝', t: 'sel', o: [''].concat(GRADES), w: 80 }, { h: '정원', w: 60 }, { h: '시작 회차', w: 70 }, { h: '끝 회차', w: 70 }, { h: '비고', w: 180 }] },
      users: { title: '점검자', help: '이 웹앱에 로그인할 수 있는 사람입니다. 구글 계정 이메일을 적습니다. 점검자는 누구나 설정을 바꿀 수 있습니다.',
        cols: [{ h: '구글 계정 이메일', w: 280 }, { h: '이름', w: 140 }] },
      restrict: { title: '신청제한 명단 (직접 적는 것)', help: '결석 메뉴에 기록한 학생은 여기 적지 않아도 자동으로 제한됩니다. 그 밖에 따로 제한할 학생만 적습니다. 제한 수업일을 비우면 결석 수업일 다음 수업일입니다.',
        cols: [{ h: '결석 수업일', t: 'date', w: 160 }, { h: '학생명', w: 100 }, { h: '학교', w: 140 }, { h: '사유', w: 120 }, { h: '제한 수업일', t: 'date', w: 160 }, { h: '메모', w: 180 }, { h: '등록자', ro: true, w: 90 }] },
      map: { title: '예약명 연결', help: '설정된 반과 이름이 다른 예약명을 어느 반으로 받을지 기억해 둔 것입니다. 잘못 연결했으면 접수명을 바꾸거나 줄을 지웁니다.', noAdd: true,
        cols: [{ h: '예약명 (날짜 제외)', ro: true, w: 340 }, { h: '접수명', t: 'sel', o: clsNames, w: 180 }, { h: '등록자', ro: true, w: 90 }, { h: '등록시각', ro: true, w: 150 }] },
      rooms: { title: '교실', help: '출석부 반 설정에서 고르는 교실 목록입니다.', cols: [{ h: '교실 이름', w: 200 }] }
    }[tab];
  }
  var SET_TABS = ['dates', 'classes', 'users', 'rooms', 'restrict', 'map'];
  S.setDraft = {}; S.setErr = {};

  function setRows(tab) { return S.setDraft[tab] || (S.settings.edit && S.settings.edit[tab]) || []; }

  function setEditor(tab) {
    var sp = setSpec(tab), rows = setRows(tab), dirty = !!S.setDraft[tab];
    var html = '<section class="card pad set-sec" id="set-' + tab + '" style="display:flex;flex-direction:column;gap:8px"><div class="row between"><h2 style="margin:0">' + esc(sp.title) +
      (dirty ? ' <span class="badge warn">저장 안 됨</span>' : '') + '</h2><div class="row">' +
      (dirty ? '<button class="btn sm" data-x="set-reset" data-tab="' + tab + '">되돌리기</button>' : '') +
      '<button class="btn sm' + (dirty ? ' primary' : '') + '" data-x="set-save" data-tab="' + tab + '">저장</button></div></div>' +
      '<p class="muted small" style="margin:0">' + esc(sp.help) + '</p>' +
      (S.setErr[tab] ? '<div class="small" style="color:var(--red);white-space:pre-line;background:var(--red-bg);padding:8px;border-radius:6px">' + esc(S.setErr[tab]) + '</div>' : '') +
      '<div class="tbox"><table class="grid set-tbl"><thead><tr>' + sp.cols.map(function (c) { return '<th style="min-width:' + (c.w || 120) + 'px">' + esc(c.h) + '</th>'; }).join('') + '<th></th></tr></thead><tbody>';
    html += rows.map(function (r, ri) {
      return '<tr>' + sp.cols.map(function (c, ci) {
        var v = r[ci] === undefined ? '' : String(r[ci]);
        var attr = ' data-sf="' + tab + '" data-c="' + ci + '" aria-label="' + esc(c.h) + '"';
        if (c.ro) return '<td class="muted small">' + esc(v) + '<input type="hidden"' + attr + ' value="' + esc(v) + '"></td>';
        if (c.t === 'sel') {
          var opts = c.o.indexOf(v) < 0 && v ? c.o.concat([v]) : c.o;
          return '<td><select' + attr + '>' + opts.map(function (o) { return '<option' + (o === v ? ' selected' : '') + ' value="' + esc(o) + '">' + esc(o || '—') + '</option>'; }).join('') + '</select></td>';
        }
        return '<td><input type="' + (c.t === 'date' ? 'date' : 'text') + '"' + attr + ' value="' + esc(v) + '"' + (c.ph ? ' placeholder="' + esc(c.ph) + '"' : '') + '></td>';
      }).join('') + '<td><button class="btn sm" data-x="set-del" data-tab="' + tab + '" data-r="' + ri + '" title="줄 지우기" aria-label="줄 지우기">✕</button></td></tr>';
    }).join('') || '<tr><td colspan="' + (sp.cols.length + 1) + '" class="muted">없음</td></tr>';
    html += '</tbody></table></div>' + (sp.noAdd ? '' : '<div><button class="btn sm" data-x="set-add" data-tab="' + tab + '">＋ 줄 추가</button></div>') + '</section>';
    return html;
  }

  /** 화면의 입력값을 초안으로 (다시 그려도 입력한 것이 남도록) */
  function setCapture(tab) {
    var sec = document.getElementById('set-' + tab);
    if (!sec) return;
    var rows = [];
    sec.querySelectorAll('tbody tr').forEach(function (tr) {
      var cells = tr.querySelectorAll('[data-sf]');
      if (!cells.length) return;
      var r = [];
      cells.forEach(function (el) { r[+el.getAttribute('data-c')] = el.value; });
      rows.push(r);
    });
    S.setDraft[tab] = rows;
  }

  function setSave(tab) {
    setCapture(tab);
    setBusy(true);
    api('settingsSave', { tab: tab, rows: S.setDraft[tab] }).then(function (res) {
      S.setDraft[tab] = null; S.setErr[tab] = '';
      if (res.rev) S.rev = res.rev;
      toast(setSpec(tab).title + ' 설정을 저장했습니다.', 2500);
      S.settings = null;
      return load(S.date);
    }).catch(function (er) {
      S.setErr[tab] = /알 수 없는 요청/.test(er.message) ? 'Apps Script(Code.gs)를 새 버전으로 바꿔야 웹앱에서 저장할 수 있습니다.' : er.message;
      render();
    }).then(function () { setBusy(false); });
  }

  function viewSettings() {
    var s = S.settings;
    if (!s) { loadSettings(); return '<div class="card pad muted">설정을 불러오는 중…</div>'; }
    if (!s.edit) return '<div class="card pad">Apps Script(Code.gs)를 새 버전으로 바꾸면 여기에서 설정을 고칠 수 있습니다. <a href="' + esc(s.sheetUrl) + '" target="_blank" rel="noopener">구글 시트 열기</a></div>';
    var r = s.cancelRule || cancelRule();
    var html = '<section class="card pad row between"><div><b>설정</b><div class="muted small">고친 뒤 표마다 [저장]을 누르면 점검자 모두에게 바로 적용됩니다. 바꾼 기록은 맨 아래에 남습니다.</div></div>' +
      '<div class="row"><a class="btn sm" href="' + esc(s.sheetUrl) + '" target="_blank" rel="noopener">구글 시트 열기</a><button class="btn sm" data-act="reload-settings">새로고침</button></div></section>';
    // 운영 시기 이름
    html += '<section class="card pad" style="display:flex;flex-direction:column;gap:8px"><h2 style="margin:0">운영 시기 이름</h2>' +
      '<p class="muted small" style="margin:0">맨 위 「작업 기준」 줄 앞에 나오는 이름입니다. (나중에 방학 프로그램이 생기면 여기서 시기를 고르게 됩니다)</p>' +
      '<div class="row"><input type="text" id="term" value="' + esc(S.data.termName || '2026 하반기 주말') + '" style="width:220px" aria-label="운영 시기 이름"><button class="btn sm primary" data-x="term-save">저장</button></div></section>';
    // 접수 시작
    var o = s.openRule || openRule();
    html += '<section class="card pad" style="display:flex;flex-direction:column;gap:8px"><h2 style="margin:0">접수 시작</h2>' +
      '<p class="muted small" style="margin:0">맨 위 안내줄의 「접수」 단계가 시작되는 시각입니다. 주말 프로그램: 수업 주 화요일 10:00 = 수업 4일 전.</p>' +
      '<div class="row" style="gap:8px">수업일 <select id="od">' + [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14].map(function (d) { return '<option value="' + d + '"' + (d === o.days ? ' selected' : '') + '>' + (d === 0 ? '당일' : d + '일 전') + '</option>'; }).join('') +
      '</select><input type="time" id="ot" value="' + esc(o.time) + '" aria-label="시각"> 부터 접수 <button class="btn sm primary" data-x="open-save">저장</button>' +
      (o.by ? '<span class="muted small">' + esc(o.by) + ' · ' + esc(String(o.at).slice(5, 16)) + '</span>' : '') + '</div></section>';
    // 취소 기한
    html += '<section class="card pad" style="display:flex;flex-direction:column;gap:8px"><h2 style="margin:0">취소 기한</h2>' +
      '<p class="muted small" style="margin:0">이 시각 이후에 예약취소한 학생은 결석 메뉴에 「기한 후 취소」 후보로 나옵니다. 지금 운영 규정: 수업 2일 전(목) 16:00까지 취소.</p>' +
      '<div class="row" style="gap:8px">수업일 <select id="ld">' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (d) { return '<option value="' + d + '"' + (d === r.days ? ' selected' : '') + '>' + (d === 0 ? '당일' : d + '일 전') + '</option>'; }).join('') +
      '</select><input type="time" id="lt" value="' + esc(r.time) + '" aria-label="시각"> 이후 취소 = 기한 후 취소 <button class="btn sm primary" data-x="rule-save">저장</button>' +
      (r.by ? '<span class="muted small">' + esc(r.by) + ' · ' + esc(String(r.at).slice(5, 16)) + '</span>' : '') + '</div></section>';
    SET_TABS.forEach(function (t) { html += setEditor(t); });
    // 학교
    html += '<section class="card pad" style="display:flex;flex-direction:column;gap:8px"><h2 style="margin:0">학교 목록 <span class="muted small" style="font-weight:400">' + s.schoolCount + '곳</span></h2>' +
      '<p class="muted small" style="margin:0">관외 학교·학교명 확인에 씁니다. 목록에 없는 울산 학교는 정식 이름으로 추가합니다(예: 가온초등학교).</p>' +
      '<div class="row"><input type="text" id="sch-add" placeholder="학교 정식 이름" style="width:220px" aria-label="추가할 학교"><button class="btn sm" data-x="school-add">추가</button>' +
      (s.hasNeisKey ? '<button class="btn sm" data-act="neis">NEIS에서 학교 목록 새로 가져오기</button>' : '') + '</div></section>';
    // 기록
    html += '<section class="card pad"><h2 style="margin:0 0 8px">최근 바꾼 기록</h2><div class="tbox"><table class="grid"><thead><tr><th>시각</th><th>변경자</th><th>항목</th><th>내용</th></tr></thead><tbody>' +
      ((s.log || []).map(function (l) { return '<tr><td>' + esc(String(l[0]).slice(5, 16)) + '</td><td>' + esc(l[1]) + '</td><td>' + esc(l[2]) + '</td><td>' + esc(l[3]) + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="muted">없음</td></tr>') +
      '</tbody></table></div></section>';
    return html;
  }

  function loadSettings() {
    api('settings').then(function (res) { S.settings = res; if (S.view === 'settings') render(); }).catch(function (e) { toast(e.message); });
  }

  function showGuide() { S.view = 'guide'; render(); window.scrollTo(0, 0); }

  /* ───────── 사용 안내 (시점별) ───────── */

  /** 지금이 한 주 흐름의 어느 단계인지 (수업일·접수 시작·취소 기한으로 판단) */
  function guideStage() {
    if (!S.date) return 'ready';
    return { before: 'ready', open: 'open', late: 'late', work: 'closed', day: 'day', after: 'after' }[flowStage()];
  }

  function viewGuide() {
    var st = guideStage();
    var rule = ruleText().replace(' 이후 취소', '');
    var go = function (view, label) { return '<button class="btn sm" data-view="' + view + '">' + label + ' →</button>'; };
    var stage = function (key, when, title, steps, extra) {
      var on = st === key;
      return '<section class="card pad guide-st' + (on ? ' now' : '') + '" id="g-' + key + '"><div class="row between"><div><span class="badge ' + (on ? 'warn' : '') + '">' + esc(when) + '</span> <b style="font-size:17px">' + title + '</b></div>' +
        (on ? '<b style="color:#B45309">◀ 지금 여기</b>' : '') + '</div><ol class="guide-ol">' + steps.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' + (extra || '') + '</section>';
    };
    var NOW = { open: '접수 기간입니다. 명단을 받아 올리고 점검 목록을 처리하세요.', late: '취소 기한(' + rule + ')이 지났습니다. 기한 후 취소 학생을 등록하세요.',
      closed: '출석부 작업일입니다. 출석부 작업을 시작하고 인쇄하세요.', day: '수업 당일입니다. 밤사이 취소를 확인하고 대기자에게 연락하세요.', after: '수업이 끝났습니다. 결석 기록을 정리하세요.', ready: '다음 접수 전입니다. 지난 수업 결석 정리가 남았는지 확인하세요.' };
    var html = '<section class="card pad row between guide-top"><div><h2 style="margin:0">사용 안내</h2><div class="muted small">한 주 흐름을 시점별로 정리했습니다. 처음 오셨거나 급하게 맡으셨으면 <b>「지금 여기」</b> 표시된 칸부터 하면 됩니다.</div></div>' +
      '<div class="row"><button class="btn sm" data-x="guide-print">인쇄</button><button class="btn sm primary" data-view="home">홈으로</button></div></section>' +
      '<section class="card pad" style="border:2px solid #F59E0B;background:#FFFBEB"><b style="font-size:17px">지금 할 일</b> <span class="muted small">(' + esc(md(S.date)) + ' 수업 기준)</span><div style="margin-top:6px">' + esc(NOW[st]) +
      ' <a href="#g-' + st + '">아래 안내 보기</a></div></section>';

    html += stage('ready', '처음 한 번', '준비', [
      '<b>로그인</b>: 구글 계정으로 로그인합니다. 「점검자로 등록되어 있지 않습니다」가 나오면, 이미 쓰는 선생님에게 <b>설정 → 점검자</b>에 내 이메일을 넣어 달라고 합니다.',
      '<b>즐겨찾기 버튼 설치</b>: <a href="https://xleesjx.github.io/excel-down/" target="_blank" rel="noopener">설치 안내 페이지</a>에서 「통합예약 엑셀 일괄 받기」 버튼을 크롬 즐겨찾기바로 끌어다 놓습니다.',
      '<b>팝업 허용</b>: 처음 창이 열릴 때 크롬이 막으면, 주소창 오른쪽 표시를 눌러 「항상 허용」을 고릅니다.'
    ]);
    html += stage('open', '월~목 · 접수 기간', '명단 받기와 점검', [
      '아침에 이 웹앱 위쪽 <b>[통합예약 관리자 ↗]</b>를 눌러 관리자 화면을 엽니다 (로그인). 두 창이 연결되어 하루 종일 씁니다.',
      '관리자 <b>통합예약 목록</b> 화면에서 즐겨찾기 버튼 → <b>[○개 점검 웹앱으로 보내기]</b> → 웹앱에 뜬 창에서 회차를 확인하고 <b>[올리기]</b>. 자주 해도 됩니다 (해 둔 작업은 사라지지 않습니다).',
      '<b>점검 목록</b>의 <span class="badge red">취소 대상</span>(중복·단체·학년·관외·신청 제한)은 보호자에게 연락하고 관리자 화면에서 취소한 뒤 <b>[완료]</b>.',
      '<span class="badge amber">확인 필요</span>(학교명·학반 오류, 학부모 연락처)는 연락해 확인하고 <b>관리자 화면에서 원본을 고친 뒤</b> [완료]. 정상이면 [문제없음].',
      '같은 반을 원하는 학생은 <b>전체 명단</b>에서 두 명 이상 체크하고 <b>[🔗 같은 반 요청으로 묶기]</b>.'
    ], '<div class="row" style="gap:6px">' + go('review', '점검 목록') + go('full', '전체 명단') + '<button class="btn sm" data-act="cms">통합예약 관리자 ↗</button></div>');
    var dl = cancelDeadline(), wd = '일월화수목금토'.charAt(new Date(dl.slice(0, 10) + 'T00:00:00Z').getUTCDay());
    html += stage('late', wd + ' ' + esc(dl.slice(11)) + ' 이후 · 취소 기한 뒤', '기한 후 취소 정리', [
      '명단을 한 번 더 받아 올립니다 (취소 시각이 같이 들어옵니다).',
      '<b>결석</b> 메뉴의 <b>「기한 후 취소 자동 후보」</b>에서 [등록] 또는 [모두 등록]. 봐 줄 학생은 [제외].',
      '후보에 없는데 기한 뒤에 취소 연락이 온 학생은 <b>직접 등록</b> 칸에 학생명·학교·학년반만 적고 [모두 등록].'
    ], '<div class="row" style="gap:6px">' + go('abs', '결석') + '</div>');
    html += stage('closed', '금 · 출석부 작업', '출석부 작업 시작 → 반 설정 → 인쇄', [
      '<b>명단을 마지막으로 한 번 더 받아</b> 올립니다. 출석부 메뉴에는 그때까지 <b>자동으로 나눈 미리보기</b>가 보입니다.',
      '<b>[참가 신청 최종 확정 · 출석부 작업 시작]</b>을 누릅니다. 이때 분반이 <b>고정</b>됩니다 (다시 나누려면 [처음부터 다시 만들기]).',
      '반마다 <b>[반 설정]</b>에서 반 이름·교실·교구를 정하고, 주황 칸(학교명·학반)을 고치고, 필요하면 [⇄]로 반을 옮긴 뒤 <b>[저장]</b>.',
      '<b>[전체 인쇄]</b> → 크롬 인쇄 창에서 [인쇄]. 센터 입구·교실 입구·강사용. <b>[연락처 명렬표 인쇄]</b>는 담당자용 (연락처·대기자).',
      '그 뒤 들어오는 취소·새 승인은 「변동 사항」에 뜹니다. <b>[교체]·[이 반에 추가]</b>로 그 학생만 바꾸고 [저장] → <b>[아직 인쇄 안 한 바뀐 반]</b>만 다시 인쇄.'
    ], '<div class="row" style="gap:6px">' + go('att', '출석부') + '</div>');
    html += stage('day', '토 · 수업 당일 아침', '밤사이 취소 → 대기자 연락 → 교체', [
      '출근하면 <b>명단을 받아</b> 올립니다. 밤사이 취소자가 있으면 출석부 화면 위 「변동 사항」에 뜹니다.',
      '취소자 아래 <b>[대기자 연락 순서]</b>를 펼쳐 차례대로 전화합니다 (대기 먼저, 신청 시각순). 결과를 [참석 확정]·[불참]·[연락 안 됨]으로 표시하면 다른 선생님 화면에도 보입니다.',
      '참석 확정한 학생은 <b>통합예약에서 승인</b> → 명단 다시 보내기 → [교체]에서 ★ 학생을 골라 교체 → [저장] → 바뀐 반만 인쇄해서 바꿔 붙입니다. (급하면 승인 전에도 교체 가능, 「통합예약 승인 필요」 표시가 남음)',
      '수업이 시작되면 오지 않은 학생은 출석부에서 <b>[결석]</b> 체크 (출석부는 그대로, 결석 기록만 남음).'
    ], '<div class="row" style="gap:6px">' + go('att', '출석부') + '</div>');
    html += stage('after', '수업 뒤', '결석 정리', [
      '<b>결석</b> 메뉴에서 사유(질병·대회 등)와 메모를 적습니다.',
      '봐 줄 학생은 <b>「출석 인정」</b>에 체크합니다. 체크하지 않은 학생은 <b>다음 수업일에 신청 제한</b>으로 자동 표시됩니다.'
    ], '<div class="row" style="gap:6px">' + go('abs', '결석') + '</div>');

    html += '<section class="card pad"><b style="font-size:17px">문제가 생겼을 때</b><table class="grid" style="margin-top:8px"><tbody>' + [
      ['화면이 예전 그대로이거나 이상함', '<b>Ctrl + Shift + R</b> (새 버전 불러오기)'],
      ['「점검자로 등록되어 있지 않습니다」', '다른 점검자에게 <b>설정 → 점검자</b>에 내 이메일 추가 요청'],
      ['버튼을 눌러도 웹앱 창이 안 열림', '크롬 팝업 차단 → 주소창 오른쪽 표시에서 「항상 허용」'],
      ['올리기 결과가 「건너뜀」', '접수 기간 밖이거나 이미 더 최근 명단이 올라가 있는 것 (정상)'],
      ['올리기 결과가 「연결 필요」', '처음 보는 예약명 → 어느 반인지 골라 주면 다음부터 자동'],
      ['수업일·반·교실·취소 기한을 바꿔야 함', '<b>설정</b> 메뉴에서 고치고 [저장]'],
      ['관리자 화면 버튼이 안 보임', '<a href="https://xleesjx.github.io/excel-down/" target="_blank" rel="noopener">설치 안내</a>에서 다시 끌어다 놓기 (비상용 버튼도 있음)']
    ].map(function (r) { return '<tr><td style="width:40%"><b>' + r[0] + '</b></td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table></section>';
    html += '<section class="card pad small muted" style="line-height:1.8"><b>말 뜻</b><br>· <b>회차</b>: 수업일 한 번 (예: 6회차 = 11/7)<br>· <b>취소 대상 / 확인 필요</b>: 점검 결과 빨강(취소해야 함) / 노랑(연락해서 확인)<br>' +
      '· <b>출석부 작업 시작</b>: 참가 신청을 최종 확정하고 분반을 고정한 때. 이후 바뀌는 것은 사람이 승인해야 반영<br>· <b>차수</b>: 출석부를 저장한 순서 (1차 = 작업 시작)</section>';
    return html;
  }

  /* ───────── 공통: 대화상자 ───────── */

  function modal(html, onClick) {
    var w = document.createElement('div');
    w.innerHTML = '<div class="modal-bg"><div class="modal" role="dialog">' + html + '</div></div>';
    document.body.appendChild(w);
    var close = function () { w.remove(); };
    w.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-m]');
      if (b) onClick(b.getAttribute('data-m'), b, w, close);
    });
    return w;
  }
  /** '2026-11-06 19:16:58' → '11/6 19:16' */
  function shortTs(t) {
    var m = /^\d{4}-(\d{2})-(\d{2})[ T](\d{2}:\d{2})/.exec(String(t || ''));
    return m ? (+m[1]) + '/' + (+m[2]) + ' ' + m[3] : String(t || '');
  }
  function roomList(cur) { var l = (S.data && S.data.rooms && S.data.rooms.length ? S.data.rooms : Roster.ROOMS).slice(); if (cur && l.indexOf(cur) < 0) l.push(cur); return l; }
  /** 같은 학교일 수 있으면 true (정식 학교 이름 기준, 다른 학교로 확정되면 false) */
  var schMemo = {};
  function sameSch(a, b) { return Core.sameSchool(a, b, (S.data && S.data.schools) || [], schMemo) !== 'diff'; }
  function mmdd(date) { return date.slice(5, 7) + date.slice(8, 10); }
  function md(date) { return (+date.slice(5, 7)) + '월 ' + (+date.slice(8, 10)) + '일'; }

  /* ───────── 같은 반 요청 ───────── */

  /** 이번 회차에 해당하는 묶음: 이번 회차 요청 + 다른 회차의 '계속' 요청 중 이번에도 2명 이상 있는 것 */
  function dateLinks() {
    var rows = S.data.rows || [];
    var has = function (m) { return rows.some(function (r) { return Core.str(r.cells[9]) === m.name && sameSch(r.cells[10], m.school); }); };
    return (S.data.links || []).filter(function (g) {
      if (g.date === S.date) return true;
      return g.scope === '계속' && g.members.filter(has).length >= 2;
    }).map(function (g) { return { g: g, applied: g.date === S.date }; });
  }

  function linkLetters() {
    var out = {}, rows = S.data.rows || [];
    dateLinks().forEach(function (x, k) {
      var letter = String.fromCharCode(65 + (k % 26));
      x.g.members.forEach(function (m) {
        rows.forEach(function (r) {
          if ((x.applied && m.no && r.no === m.no) || (Core.str(r.cells[9]) === m.name && sameSch(r.cells[10], m.school))) out[r.no] = letter;
        });
      });
    });
    return out;
  }

  function selRows() { return Object.keys(S.sel).map(rowByNo).filter(Boolean); }

  function selBar() {
    var list = selRows();
    if (!list.length) return '';
    var names = list.slice(0, 4).map(function (r) { return esc(r.cells[9]) + '(' + esc(r.cells[10]) + ')'; }).join(', ') + (list.length > 4 ? ' 외 ' + (list.length - 4) + '명' : '');
    return '<div class="selbar"><b>' + list.length + '명 선택 · ' + names + '</b><div class="row"><button class="btn sm" data-x="sel-clear">선택 해제</button>' +
      '<button class="btn sm" data-x="sel-link"' + (list.length < 2 ? ' disabled title="2명 이상 골라 주세요"' : '') + '>🔗 같은 반 요청으로 묶기</button></div></div>';
  }

  function linkDialog() {
    var list = selRows();
    var html = '<h2 style="margin:0">🔗 같은 반 요청으로 묶기</h2>' +
      '<div class="card pad small">' + list.map(function (r) { return esc(r.cells[9]) + ' (' + esc(r.cells[10]) + ' ' + esc(r.cells[11]) + ' · ' + esc(r.cls) + ')'; }).join('<br>') + '</div>' +
      '<div><b class="small">적용 범위</b><label class="opt"><input type="radio" name="lscope" value="once" checked><span>이번 회차만 (' + esc(Core.shortDate(S.date)) + ')</span></label>' +
      '<label class="opt"><input type="radio" name="lscope" value="keep"><span>계속 적용 — 다음 회차에도 두 학생이 모두 있으면 출석부 만들 때 <b>적용할지 물어봄</b></span></label></div>' +
      '<label class="small"><b>메모</b><input type="text" id="lmemo" placeholder="예: 어머니 전화 요청" style="width:100%;margin-top:4px"></label>' +
      '<details class="small"><summary style="cursor:pointer;min-height:32px">아직 신청하지 않은 친구도 함께 묶기</summary><div class="row" style="margin-top:6px"><input type="text" id="lfname" placeholder="학생명"><input type="text" id="lfschool" placeholder="학교"></div>' +
      '<p class="muted" style="margin:6px 0 0">나중에 그 학생이 신청하면 이름·학교로 자동으로 이어집니다.</p></details>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn" data-m="cancel">취소</button><button class="btn primary" data-m="ok">묶기</button></div>';
    modal(html, function (m, b, w, close) {
      if (m === 'cancel') return close();
      var members = list.map(function (r) { return { no: r.no, name: Core.str(r.cells[9]), school: Core.str(r.cells[10]) }; });
      var fn = w.querySelector('#lfname').value.trim(), fs = w.querySelector('#lfschool').value.trim();
      if (fn) members.push({ no: '', name: fn, school: fs });
      var scope = w.querySelector('input[name=lscope]:checked').value;
      setBusy(true);
      api('linkAdd', { date: S.date, scope: scope, memo: w.querySelector('#lmemo').value, members: members })
        .then(function (res) {
          close(); S.sel = {}; toast('같은 반 요청을 저장했습니다.');
          if (res.group) { S.data.links = (S.data.links || []).concat([res.group]); if (res.rev) S.rev = res.rev; render(); } else return load(S.date);
        })
        .catch(function (er) { toast(er.message); }).then(function () { setBusy(false); });
    });
  }

  function showLinks() {
    var list = dateLinks();
    var html = '<h2 style="margin:0">🔗 같은 반 요청 (' + esc(Core.shortDate(S.date)) + ')</h2>' +
      (list.length ? list.map(function (x, k) {
        var g = x.g;
        return '<div class="card pad small" style="display:flex;flex-direction:column;gap:4px"><div class="row between"><b><span class="badge link">🔗' + String.fromCharCode(65 + (k % 26)) + '</span> ' +
          g.members.map(function (m) { return esc(m.name) + '(' + esc(m.school) + ')'; }).join(' + ') + '</b><button class="btn sm" data-m="rm" data-id="' + esc(g.id) + '">해제</button></div>' +
          '<span class="muted">' + (x.applied ? '이번 회차 요청' : esc(Core.shortDate(g.date)) + '부터 계속 적용 (출석부 만들 때 확인)') + ' · ' + esc(g.by) + ' ' + esc(String(g.at).slice(5, 16)) + (g.memo ? ' · ' + esc(g.memo) : '') + '</span></div>';
      }).join('') : '<p class="muted">이번 회차에 묶인 요청이 없습니다. 전체 명단에서 학생 앞 칸을 체크해 묶을 수 있습니다.</p>') +
      '<div class="row" style="justify-content:flex-end"><button class="btn primary" data-m="close">닫기</button></div>';
    modal(html, function (m, b, w, close) {
      if (m === 'close') return close();
      if (m === 'rm' && confirm('이 같은 반 요청을 해제할까요?')) {
        var lid = b.getAttribute('data-id');
        api('linkRemove', { id: lid }).then(function (res) {
          close(); toast('해제했습니다.');
          S.data.links = (S.data.links || []).filter(function (g) { return g.id !== lid; });
          if (res.rev) S.rev = res.rev;
          render();
        }).catch(function (er) { toast(er.message); });
      }
    });
  }

  /* ───────── 전체 명단 원본 그대로 내려받기 ───────── */

  function rawExport() {
    var aoa = [H.concat(['수업반', '접수명', '점검결과', '처리상태'])];
    var done = {};
    var push = function (r) {
      var c = clsInfo(r.cls);
      var result = r.cancelled ? '예약취소' : (r.issues.length ? r.issues.map(function (i) { return i.label; }).filter(function (x, k, a) { return a.indexOf(x) === k; }).join(', ') : '이상 없음');
      aoa.push(r.cells.map(String).concat([c ? c['수업반'] : '', r.cls, result, r.status ? (r.status.s === 'ok' ? '문제없음' : '완료') : '']));
      done[r.no] = true;
    };
    (S.data.classes || []).forEach(function (c) {
      S.data.rows.filter(function (r) { return r.cls === c['접수명']; }).sort(function (a, b) { return a.seq - b.seq; }).forEach(push);
    });
    S.data.rows.filter(function (r) { return !done[r.no]; }).forEach(push);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, mmdd(S.date));
    XLSX.writeFile(wb, '전체명단_' + mmdd(S.date) + '.xlsx');
  }

  /* ───────── 결석 기록 ───────── */

  var REASONS = ['기한 후 취소', '당일 무단결석', '질병', '대회·행사', '연락 두절'];

  /*
   * 결석 기록은 화면에 바로 반영하고, 구글 시트 저장은 뒤에서 차례대로 보냅니다 (누를 때마다 기다리지 않도록).
   * 새 기록은 임시 번호(tmp…)로 먼저 보이고, 저장이 끝나면 진짜 번호로 바뀝니다.
   */
  var absQ = Promise.resolve();
  S.absPending = 0;
  function absIndicator() {
    var el = document.getElementById('abs-sync');
    if (el) el.textContent = S.absPending ? '구글 시트에 저장 중… (' + S.absPending + ')' : '모두 저장됨 ✔';
    if (el) el.className = 'small ' + (S.absPending ? 'sync-on' : 'sync-ok');
  }
  function absQueue(job) {
    S.absPending++; absIndicator();
    absQ = absQ.then(job).then(function (res) {
      if (res && res.rev && S.absPending === 1) S.rev = res.rev;  // 내가 바꾼 것 때문에 전체를 다시 불러오지 않도록
    }).catch(function (er) {
      toast('결석 기록을 구글 시트에 저장하지 못했습니다: ' + er.message + ' — 화면을 새로 불러옵니다.', 5000);
      S.absPending = 1; return load(S.date);
    }).then(function () { S.absPending = Math.max(0, S.absPending - 1); absIndicator(); });
    return absQ;
  }
  function absList() { S.data.absences = S.data.absences || []; return S.data.absences; }

  /** rec 저장 (새 기록이면 추가). 화면은 바로 다시 그립니다. */
  function saveAbs(rec, quiet) {
    var list = absList();
    var cur = rec.id ? absById(rec.id) : (rec.no ? list.filter(function (a) { return a.date === rec.date && a.no === rec.no; })[0] : null);
    if (cur) Object.assign(cur, rec);
    else { cur = Object.assign({ id: 'tmp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), by: (S.user && S.user.name) || '', at: '' }, rec); list.push(cur); }
    cur.at = cur.at || nowText();
    if (!quiet) render();
    absQueue(function () {
      var send = Object.assign({}, cur);
      if (/^tmp/.test(send.id)) delete send.id;
      if (cur.deleted) return null;
      return api('absSave', { rec: send }).then(function (res) { cur.id = res.id; return res; });
    });
    return Promise.resolve(cur);
  }

  function deleteAbs(a) {
    if (!a) return;
    a.deleted = true;
    S.data.absences = absList().filter(function (x) { return x !== a; });
    render();
    absQueue(function () { return /^tmp/.test(a.id) ? null : api('absDelete', { id: a.id }); });
  }

  function nowText() {
    var d = new Date(Date.now() + 9 * 3600000);
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }

  function absOf(no) { return (S.data.absences || []).filter(function (a) { return a.no === no; })[0]; }

  /** 전체 명단의 [결석] 버튼: 표시하면 결석 기록에 넣고, 다시 누르면 해제합니다 */
  function toggleAbsence(no) {
    var r = rowByNo(no);
    if (!r) return;
    var a = absOf(no);
    if (a) {
      if (a.memo && !confirm(r.cells[9] + ' 학생의 결석 표시를 해제할까요? 적어 둔 메모도 함께 지워집니다.')) return;
      deleteAbs(a);
      return;
    }
    saveAbs({ date: S.date, no: r.no, name: r.cells[9], school: r.cells[10], ban: r.cells[11], cls: r.cls, phone: r.cells[3], cancelAt: r.cancelAt ? shortTs(r.cancelAt) : '',
      src: r.cancelled ? '예약취소' : '당일 결석', reason: r.cancelled ? '기한 후 취소' : '당일 무단결석' })
      .then(function () { toast(r.cells[9] + ' 학생을 결석으로 표시했습니다. 사유는 결석 메뉴에서 고칠 수 있습니다.', 2500); });
  }

  var ABS_SORTS = [['cls', '반 순서'], ['name', '이름'], ['reason', '사유'], ['at', '등록 순']];

  /** 결석 기록 → 출석부의 반 (순서·이름). 출석부에 없으면 신청한 수업의 첫 반, 그것도 없으면 맨 뒤 */
  function absClass(a) {
    var blocks = (S.data.att && S.data.att.data && S.data.att.data.blocks) || [];
    var nameOf = function (b) { return b.name || ((Roster.parseTitle(b.title) || {}).name) || b.tag || ''; };
    for (var i = 0; i < blocks.length; i++) {
      var hit = (blocks[i].students || []).some(function (s) { return (a.no && s.no === a.no) || (!a.no && s.name === a.name && sameSch(s.school, a.school)); });
      if (hit) return { order: i, label: nameOf(blocks[i]) };
    }
    var r = a.no ? rowByNo(a.no) : null;
    var cls = a.cls || (r && r.cls) || '';
    if (cls) {
      var c = clsInfo(cls), g = c ? (c['수업반'] || c['접수명']) : cls;
      var same = [];
      for (i = 0; i < blocks.length; i++) if (String(blocks[i].key || '').split('#')[0] === g) same.push(i);
      // 출석부에 없는 학생(취소 등): 한 반이면 그 반 이름, 나눈 반이면 수업반 이름(예: 기초 1,2반)으로 그 반들 바로 뒤에
      if (same.length) return { order: same[same.length - 1] + 0.5, label: same.length === 1 ? nameOf(blocks[same[0]]) : g };
      var k = (S.data.classes || []).map(function (x) { return x['수업반'] || x['접수명']; }).indexOf(g);
      return { order: 1000 + (k < 0 ? 999 : k), label: g };
    }
    return { order: 9999, label: '반 미확인' };
  }

  function viewAbs() {
    var recs = (S.data.absences || []).slice();
    var limited = recs.filter(function (a) { return !a.excused; }).length;
    var next = Core.nextClassDate(S.data.dates || [], S.date);
    var key = S.absSort || 'cls';
    recs.forEach(function (a) { a._c = absClass(a); });
    var prevLabel = null;
    var ko = function (a, b) { return String(a || '').localeCompare(String(b || ''), 'ko'); };
    recs.sort(function (a, b) {
      if (key === 'name') return ko(a.name, b.name) || ko(a.school, b.school);
      if (key === 'reason') return ko(a.reason, b.reason) || ko(a.name, b.name);
      if (key === 'at') return ko(a.at, b.at);
      return (a._c.order - b._c.order) || ko(a.name, b.name);
    });
    var html = '<section class="card pad row between"><b>' + esc(md(S.date)) + ' 수업 결석·취소</b><span class="muted small">결석·취소 <b>' + recs.length + '</b>명 · 다음 수업일' + (next ? '(' + Core.shortDate(next) + ')' : '') + ' 신청 제한 <b>' + limited + '</b>명 · 출석 인정 ' + (recs.length - limited) + '명 · <span id="abs-sync"></span></span></section>' +
      '<section class="card pad small" style="line-height:1.8;background:#F8FAFF;border-color:#BFD0F5"><b>결석자 처리 방법</b> ' + tip('출석 인정이 아닌 학생은 다음 수업일 점검에서 「신청 제한 학생」으로 표시됩니다.') + '<br>' +
      '· 수업 당일 결석: <b>출석부</b> 화면에서 학생 옆 <b>[결석]</b> 체크 (또는 전체 명단의 [결석])<br>' +
      '· 기한 후 취소: 아래 <b>자동 후보</b>(기준 시각 이후에 예약취소한 학생)에서 [등록] · 후보에 없는 학생은 <b>직접 등록</b> 칸에 학생명·학교·학년반만 적고 [모두 등록]<br>' +
      '· 사유·메모를 고치고, 질병·대회 등으로 봐 줄 학생은 <b>출석 인정</b>에 체크하면 신청 제한이 풀립니다.</section>' +
      lateCancelCard() +
      '<section class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="row between"><b>기한 후 취소 학생 직접 등록</b><span class="muted small">여러 명을 적은 뒤 한 번에 등록합니다 · 빈 줄은 건너뜁니다</span></div>' +
      '<div id="abs-new">' + absNewRow() + absNewRow() + absNewRow() + '</div>' +
      '<div class="row"><button class="btn" data-x="abs-addrow">＋ 줄 추가</button><button class="btn primary" data-x="abs-add">모두 등록</button></div></section>';
    html += '<section class="card" style="overflow:hidden"><div class="pad row" style="gap:6px;padding-bottom:0"><span class="muted small">정렬</span>' +
      ABS_SORTS.map(function (x) { return '<button class="chipbtn' + (key === x[0] ? ' on' : '') + '" data-x="abs-sort" data-v="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>' +
      (recs.length ? '<div class="tbox"><table class="grid abs-tbl"><thead><tr><th>반</th><th>학생명</th><th>학교</th><th>학년반</th><th>사유</th><th>출석 인정</th><th>메모</th><th>연락처</th><th>구분</th><th></th></tr></thead><tbody>' +
        recs.map(function (a) {
          var reasons = REASONS.indexOf(a.reason) < 0 && a.reason ? REASONS.concat([a.reason]) : REASONS;
          var newGroup = key === 'cls' && a._c.label !== prevLabel; prevLabel = a._c.label;
          return '<tr class="' + (a.excused ? 'ex' : '') + (newGroup ? ' grp' : '') + '"><td class="cls-name">' + esc(a._c.label) + '</td><td><b>' + esc(a.name) + '</b></td><td>' + esc(a.school) + '</td><td>' + esc(a.ban) + '</td>' +
            '<td><select data-xc="abs-reason2" data-id="' + esc(a.id) + '" aria-label="사유">' + reasons.map(function (rs) { return '<option' + (a.reason === rs ? ' selected' : '') + '>' + esc(rs) + '</option>'; }).join('') + '</select></td>' +
            '<td style="text-align:center"><input type="checkbox" data-xc="abs-ex" data-id="' + esc(a.id) + '"' + (a.excused ? ' checked' : '') + ' aria-label="출석 인정" style="width:20px;height:20px"></td>' +
            '<td><input type="text" value="' + esc(a.memo) + '" placeholder="메모" data-xc="abs-field" data-id="' + esc(a.id) + '" data-f="memo" aria-label="메모" style="min-width:160px;width:100%"></td>' +
            '<td>' + (a.phone ? '<a href="tel:' + esc(String(a.phone).replace(/[^0-9]/g, '')) + '">' + esc(a.phone) + '</a>' : '') + '</td>' +
            '<td class="muted small">' + esc(a.src || '') + (absCancelAt(a) ? '<br><b style="color:var(--red)">' + esc(absCancelAt(a)) + ' 취소</b>' : '') + '</td><td><button class="btn sm" data-x="abs-del" data-id="' + esc(a.id) + '" title="기록 삭제" aria-label="기록 삭제">✕</button></td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="pad muted">이 수업일의 결석·취소 기록이 없습니다.</div>') + '</section>';
    setTimeout(absIndicator, 0);
    return html;
  }

  function absNewRow() {
    return '<div class="row abs-new" style="gap:8px;flex-wrap:nowrap;margin-bottom:6px"><input type="text" class="an" placeholder="학생명" style="width:110px" aria-label="학생명">' +
      '<input type="text" class="as" placeholder="학교 (예: 가온초)" style="width:160px" aria-label="학교"><input type="text" class="ab" placeholder="학년반 (예: 3-2)" style="width:130px" aria-label="학년반"></div>';
  }

  /* ───────── 맨 위 「이번 주 흐름」 안내줄 ───────── */

  function openRule() { return (S.data && S.data.openRule) || { days: 4, time: '10:00', isDefault: true }; }
  function wdOf(date) { return '일월화수목금토'.charAt(new Date(date + 'T00:00:00Z').getUTCDay()); }
  function dayText(date) { return (+date.slice(5, 7)) + '/' + (+date.slice(8, 10)) + '(' + wdOf(date) + ')'; }
  function nowKst() { return Core.tsFromMillis(Date.now()).replace('T', ' ').slice(0, 16); }
  /** 이번 회차 일정: 접수 시작·취소 기한·출석부 작업일·수업일 */
  function schedule() {
    var o = openRule();
    return { open: Core.addDays(S.date, -o.days) + ' ' + o.time, deadline: cancelDeadline(), work: Core.addDays(S.date, -1), day: S.date };
  }
  function flowStage() {
    var now = nowKst(), sc = schedule(), d = now.slice(0, 10);
    if (d === sc.day) return 'day';
    if (d > sc.day) return 'after';
    if (d === sc.work) return 'work';
    if (now >= sc.deadline) return 'late';
    if (now >= sc.open) return 'open';
    return 'before';
  }

  /** 반별 남은 자리와 대기 (추가 승인 확인용) */
  function seatInfo() {
    return (S.data.classes || []).map(function (c) {
      var live = S.data.rows.filter(function (r) { return r.cls === c['접수명'] && !r.cancelled; });
      var approved = live.filter(function (r) { return r.cells[12] === '승인'; }).length;
      var wait = live.filter(function (r) { return r.cells[12] === '대기' || r.cells[12] === '추가대기'; }).length;
      return { name: c['접수명'], left: Math.max(0, (+c.cap || 0) - approved), wait: wait };
    }).filter(function (x) { return x.left > 0 && x.wait > 0; });
  }

  function flowBar(counts) {
    var st = flowStage(), sc = schedule(), now = nowKst();
    var steps = [['open', '접수', dayText(sc.open.slice(0, 10)) + ' ' + sc.open.slice(11) + ' ~'], ['late', '취소 기한 뒤', dayText(sc.deadline.slice(0, 10)) + ' ' + sc.deadline.slice(11) + ' ~'],
      ['work', '출석부 작업', dayText(sc.work)], ['day', '수업 당일', dayText(sc.day)]];
    var order = ['before', 'open', 'late', 'work', 'day', 'after'], cur = order.indexOf(st);
    var chips = steps.map(function (x) {
      var k = order.indexOf(x[0]), cls = k === cur ? 'now' : (k < cur ? 'past' : '');
      return '<span class="fb-step ' + cls + '"><b>' + x[1] + '</b> <span class="small">' + x[2] + '</span></span>';
    }).join('<span class="fb-arrow" aria-hidden="true">→</span>');
    var tasks = [], btn = function (attr, label) { return '<button class="btn sm" ' + attr + '>' + label + '</button>'; };
    var red = counts.red, amber = counts.amber, att = S.data.att;
    var checks = function () { if (red + amber) tasks.push('점검 목록 미처리 <b>' + (red + amber) + '건</b> ' + btn('data-view="review"', '점검 목록 →')); };
    var seats = function (prefix) {
      var si = seatInfo();
      if (si.length) tasks.push(prefix + si.map(function (x) { return btn('data-go="wait" data-cls="' + esc(x.name) + '"', esc(x.name) + ' 남은 ' + x.left + ' · 대기 ' + x.wait); }).join(' '));
    };
    var restrictTask = function () {
      var rm = restrictMatches(), y = rm.filter(function (q) { return q.state === 'yes'; }).length, m = rm.filter(function (q) { return q.state === 'maybe'; }).length;
      if (y + m) tasks.push('신청 제한 학생 중 <b style="color:var(--red)">' + y + '명 신청함</b>' + (m ? ' · 학교 확인 ' + m + '명' : '') + ' ' + btn('data-view="review"', '점검 목록 →'));
    };
    var title = '';
    if (st === 'before') {
      title = '접수 전 · 다음 접수는 ' + dayText(sc.open.slice(0, 10)) + ' ' + sc.open.slice(11) + '부터';
      tasks.push('지난 수업 결석 정리가 남았으면 결석 메뉴에서 회차를 바꿔 확인 ' + btn('data-view="abs"', '결석 →'));
    } else if (st === 'open') {
      var firstDay = now.slice(0, 10) === sc.open.slice(0, 10) && now.slice(11) < '13:00';
      title = firstDay ? '접수 첫날 · 첫 승인 점검' : '접수 기간 · 추가 승인 확인';
      tasks.push((firstDay ? '명단 받기 → 취소 대상·확인 필요 처리 → 통합예약에서 승인 ' : '명단을 받아 새 신청 점검 ') + btn('data-act="cms"', '통합예약 관리자 ↗'));
      checks();
      restrictTask();
      seats('추가 승인 가능: ');
      if (now.slice(0, 10) === sc.deadline.slice(0, 10)) tasks.push('오늘 ' + sc.deadline.slice(11) + ' 취소 기한 · 오전에 <b>승인 학생 보호자에게 취소 기한 안내 문자</b>');
      tasks.push('같은 반 요청은 나올 때마다 묶기 ' + btn('data-view="full"', '전체 명단 →'));
    } else if (st === 'late') {
      title = '취소 기한 뒤 · 이제부터 취소는 기한 후 취소(신청 제한)';
      var lc = lateCancels().length;
      tasks.push('기한 후 취소 후보 <b>' + lc + '명</b> ' + btn('data-view="abs"', '결석 →'));
      checks();
      restrictTask();
      seats('정원이 안 찬 반 (추가 접수 중이면 추가 승인): ');
    } else if (st === 'work') {
      title = '출석부 작업일';
      if (!att) tasks.push('명단을 마지막으로 받은 뒤 <b>[참가 신청 최종 확정 · 출석부 작업 시작]</b> ' + btn('data-view="att"', '출석부 →'));
      else {
        var chW = attChanges(att.data).count;
        tasks.push((chW ? '출석부 변동 사항 <b>' + chW + '건</b> 확인 · ' : '출석부 작업 중 · ') + '반 설정을 마치면 인쇄 ' + btn('data-view="att"', '출석부 →'));
      }
      var lc2 = lateCancels().length;
      if (lc2) tasks.push('기한 후 취소 후보 <b>' + lc2 + '명</b> ' + btn('data-view="abs"', '결석 →'));
      checks();
    } else if (st === 'day') {
      title = '수업 당일';
      var chD = att ? attChanges(att.data).count : 0;
      tasks.push('밤사이 취소 확인: 명단 받기 ' + btn('data-act="cms"', '통합예약 관리자 ↗') + (chD ? ' → 변동 사항 <b>' + chD + '건</b> · 대기자 연락 → 교체 → 바뀐 반 인쇄 ' + btn('data-view="att"', '출석부 →') : ''));
      tasks.push('오지 않은 학생은 출석부에서 [결석] 체크 ' + btn('data-view="att"', '출석부 →'));
    } else {
      title = '수업이 끝났습니다';
      tasks.push('결석 사유·출석 인정 정리 ' + btn('data-view="abs"', '결석 →'));
    }
    return '<div class="wrap"><section class="flowbar" aria-label="이번 주 흐름"><div class="fb-steps">' + chips + '<button class="btn sm fb-help" data-act="guide">자세히</button></div>' +
      '<div class="fb-now"><b class="fb-title">▶ ' + esc(title) + '</b>' + tasks.map(function (t) { return '<div class="fb-task">' + t + '</div>'; }).join('') + '</div></section></div>';
  }

  /* ───────── 기한 후 취소 자동 후보 ───────── */

  function cancelRule() { return (S.data && S.data.cancelRule) || { days: 2, time: '16:00', isDefault: true }; }
  /** 기한 시각 'YYYY-MM-DD HH:MM' (수업일 days일 전 time) */
  function cancelDeadline() { var r = cancelRule(); return Core.addDays(S.date, -r.days) + ' ' + r.time; }
  function ruleText() {
    var r = cancelRule();
    return (r.days === 0 ? '수업 당일' : r.days === 1 ? '수업 전날' : '수업 ' + r.days + '일 전') + ' ' + r.time + ' 이후 취소';
  }
  /** 점검자끼리 공유하는 확인 표시 (keep: 변동 사항 그대로 두기·나중에 / skip: 기한 후 취소 후보 제외) */
  function marksOf(kind) { var o = {}; (S.data.marks || []).forEach(function (m) { if (m.kind === kind) o[m.no] = m.by || 1; }); return o; }
  function setMark(kind, no, on) {
    var list = (S.data.marks || []).filter(function (m) { return !(m.kind === kind && (no === '*' || m.no === no)); });
    if (on) list.push({ kind: kind, no: no, by: (S.user && S.user.name) || '' });
    S.data.marks = list;
    render();
    api('mark', { date: S.date, kind: kind, no: no, on: !!on }).then(function (res) { if (res.rev) S.rev = res.rev; })
      .catch(function (er) { toast(/알 수 없는 요청/.test(er.message) ? 'Apps Script(Code.gs)를 새 버전으로 바꿔야 다른 선생님과 공유됩니다.' : er.message, 5000); });
  }
  function lateSkips() { return marksOf('skip'); }

  /** 예약취소 중 기한 뒤에 취소했고 아직 결석 기록에 없는 신청 */
  function lateCancels() {
    var dl = cancelDeadline(), end = S.date + ' 23:59:59', skip = lateSkips();
    var absNos = {};
    (S.data.absences || []).forEach(function (a) { if (a.no) absNos[a.no] = true; });
    return (S.data.rows || []).filter(function (r) {
      return Core.str(r.cells[12]) === '예약취소' && r.cancelAt && r.cancelAt >= dl && r.cancelAt <= end && !absNos[r.no] && !skip[r.no];
    }).sort(function (a, b) { return a.cancelAt < b.cancelAt ? -1 : 1; });
  }

  function lateCancelCard() {
    var list = lateCancels();
    var unknown = (S.data.rows || []).filter(function (r) { return Core.str(r.cells[12]) === '예약취소' && !r.cancelAt && !absOf(r.no); }).length;
    var nSkip = Object.keys(lateSkips()).length;
    var html = '<section class="card pad" style="display:flex;flex-direction:column;gap:8px;border:2px solid ' + (list.length ? '#F59E0B' : 'var(--line)') + '">' +
      '<div class="row between"><div><b>기한 후 취소 자동 후보 ' + list.length + '명</b> <span class="muted small">기준: <b>' + esc(ruleText()) + '</b> (' + esc(shortTs(cancelDeadline())) + '부터)' +
      '</span></div><div class="row"><button class="btn sm" data-x="late-rule" title="설정 메뉴에서 바꿉니다">기준 바꾸기</button>' +
      (list.length > 1 ? '<button class="btn sm primary" data-x="late-all">모두 등록</button>' : '') + '</div></div>';
    if (list.length) {
      html += '<div class="tbox"><table class="grid"><thead><tr><th>반</th><th>학생명</th><th>학교</th><th>학년반</th><th>취소 시각</th><th></th></tr></thead><tbody>' + list.map(function (r) {
        return '<tr><td>' + esc(absClass({ no: r.no, cls: r.cls }).label) + '</td><td><b>' + esc(r.cells[9]) + '</b></td><td>' + esc(r.cells[10]) + '</td><td>' + esc(r.cells[11]) + '</td>' +
          '<td><b style="color:var(--red)">' + esc(shortTs(r.cancelAt)) + '</b></td>' +
          '<td><button class="btn sm primary" data-x="late-add" data-no="' + esc(r.no) + '">등록</button> <button class="btn sm" data-x="late-skip" data-no="' + esc(r.no) + '" title="결석으로 보지 않음 (다른 선생님 화면에서도 빠짐)">제외</button></td></tr>';
      }).join('') + '</tbody></table></div>';
    } else html += '<span class="muted small">기준 시각 이후에 취소한 학생이 없거나 모두 처리했습니다.</span>';
    if (unknown || nSkip) html += '<span class="muted small">' + (unknown ? '취소 시각을 모르는 예약취소 ' + unknown + '명은 후보에서 빠집니다 (즐겨찾기 버튼의 [점검 웹앱으로 보내기]로 올리면 시각이 들어옵니다). ' : '') +
      (nSkip ? '제외한 학생 ' + nSkip + '명 <button class="btn sm" data-x="late-unskip">다시 보이기</button>' : '') + '</span>';
    return html + '</section>';
  }

  function lateRecord(r) {
    return { date: S.date, no: r.no, name: Core.str(r.cells[9]), school: Core.str(r.cells[10]), ban: Core.str(r.cells[11]), cls: r.cls, phone: Core.str(r.cells[3]),
      cancelAt: shortTs(r.cancelAt), src: '기한 후 취소 (자동 후보)', reason: '기한 후 취소' };
  }

  function markDirty(tab) {
    var b = document.querySelector('[data-x=set-save][data-tab="' + tab + '"]');
    if (b && !b.classList.contains('primary')) { b.classList.add('primary'); var h = b.closest('section').querySelector('h2'); if (h && !h.querySelector('.badge')) h.insertAdjacentHTML('beforeend', ' <span class="badge warn">저장 안 됨</span>'); }
  }

  function saveRule(days, time) {
    if (!/^\d{2}:\d{2}$/.test(time)) { toast('시각을 골라 주세요.'); return; }
    setBusy(true);
    api('cancelRule', { days: days, time: time }).then(function (res) {
      S.data.cancelRule = res.rule; if (S.settings) S.settings.cancelRule = res.rule; if (res.rev) S.rev = res.rev;
      S.settings = null; render(); toast('취소 기한을 「' + ruleText() + '」으로 바꿨습니다.');
    }).catch(function (er) { toast(/알 수 없는 요청/.test(er.message) ? 'Apps Script(Code.gs)를 새 버전으로 바꿔야 저장할 수 있습니다.' : er.message, 5000); })
      .then(function () { setBusy(false); });
  }

  /** 결석 기록의 취소 시각 (기록에 없으면 이번 명단에서) */
  function absCancelAt(a) {
    if (a.cancelAt) return a.cancelAt;
    var r = a.no ? rowByNo(a.no) : null;
    return r && r.cancelAt ? shortTs(r.cancelAt) : '';
  }

  /** 결석 메뉴에서 여러 명 직접 등록 (학생명·학교·학년반) → 모두 기한 후 취소. 화면은 한 번만 다시 그립니다. */
  function absAddManual() {
    var lines = Array.prototype.map.call(document.querySelectorAll('#abs-new .abs-new'), function (el) {
      return { el: el, n: el.querySelector('.an').value.trim(), sc: el.querySelector('.as').value.trim(), bn: el.querySelector('.ab').value.trim() };
    }).filter(function (x) { return x.n || x.sc || x.bn; });
    if (!lines.length) { toast('등록할 학생을 적어 주세요.'); return; }
    var bad = lines.filter(function (x) { return !x.n || !x.sc || !x.bn; });
    document.querySelectorAll('#abs-new .abs-new').forEach(function (el) { el.classList.remove('bad'); });
    if (bad.length) { bad.forEach(function (x) { x.el.classList.add('bad'); }); toast('빨간 줄에 학생명·학교·학년반을 모두 적어 주세요.'); return; }
    var added = [], skipped = [], nomatch = 0;
    lines.forEach(function (x) {
      var r = addManualOne(x.n, x.sc, x.bn);
      if (r === 'dup') skipped.push(x.n); else { added.push(x.n); if (r === 'nomatch') nomatch++; }
    });
    render();
    toast((added.length ? added.length + '명을 「기한 후 취소」로 등록했습니다.' : '') + (skipped.length ? ' 이미 있는 학생 ' + skipped.length + '명은 건너뛰었습니다.' : '') + (nomatch ? ' (' + nomatch + '명은 이번 회차 명단에서 찾지 못해 반·연락처가 비어 있습니다)' : ''), 4000);
  }

  function addManualOne(n, sc, bn) {
    var schools = S.data.schools || [];
    var off = Core.officialSchool(sc, schools);
    // 이번 회차 명단에 같은 학생이 있으면 신청번호·반·연락처를 이어 붙입니다
    var r = (S.data.rows || []).filter(function (x) { return Core.str(x.cells[9]) === n && sameSch(x.cells[10], sc); })[0];
    if (r && absOf(r.no)) return 'dup';
    if ((S.data.absences || []).some(function (a) { return a.name === n && sameSch(a.school, sc); })) return 'dup';
    saveAbs({ date: S.date, no: r ? r.no : '', name: n, school: off.ok ? off.name : sc, ban: Core.normalizeBan(bn).ban, cls: r ? r.cls : '', phone: r ? r.cells[3] : '', cancelAt: r && r.cancelAt ? shortTs(r.cancelAt) : '',
      src: '수기 입력', reason: '기한 후 취소' }, true);
    return r ? 'ok' : 'nomatch';
  }

  function absById(id) { return (S.data.absences || []).filter(function (a) { return a.id === id; })[0]; }
  function absPatch(id, patch) {
    var a = absById(id);
    if (!a) return;
    saveAbs(Object.assign({}, a, patch));
  }

  /* ───────── 출석부 ───────── */

  function attStudents() {
    var list = Roster.students(S.data.rows, S.data.schools || []);
    var ed = (S.att && S.att.edits) || {};
    list.forEach(function (s) {
      var e = ed[s.no];
      if (!e) return;
      if (e.school !== undefined) { s.school = e.school; s.schoolOk = true; }
      if (e.ban !== undefined) { s.ban = e.ban; s.banOk = /^\d-\d+$/.test(e.ban); }
    });
    return list;
  }

  function attGroups() {
    var map = {}, order = [];
    (S.data.classes || []).forEach(function (c) {
      var g = c['수업반'] || c['접수명'];
      if (!map[g]) { map[g] = { name: g, recvs: [], students: [] }; order.push(g); }
      map[g].recvs.push(c['접수명']);
    });
    attStudents().forEach(function (s) {
      var c = clsInfo(s.cls);
      var g = c ? (c['수업반'] || c['접수명']) : s.cls;
      if (!map[g]) { map[g] = { name: g, recvs: [s.cls], students: [] }; order.push(g); }
      map[g].students.push(s);
    });
    return order.map(function (g) { return map[g]; }).filter(function (g) { return g.students.length; });
  }

  function computeParts() {
    var A = S.att;
    A.sources = []; A.errors = [];
    A.sets = Roster.linkSets(S.data.links, attStudents(), S.date, A.acceptKeep, S.data.schools || []);
    attGroups().forEach(function (g) {
      var parts;
      if (g.students.length > Roster.CAP) {
        var res = Roster.split(g.students, A.sets, { balanceGrade1: g.recvs.length > 1 });
        if (res.error) {
          A.errors.push(g.name + ': ' + res.error + (res.units.length ? ' (' + res.units.map(function (u) { return u[0].school + ' ' + u.length + '명'; }).join(', ') + ')' : '') + ' — 아래에서 [⇄]로 직접 옮겨 주세요.');
          var srt = Roster.sortStudents(g.students), h = Math.ceil(srt.length / 2);
          parts = [srt.slice(0, h), srt.slice(h)];
        } else parts = res.parts;
      } else parts = [Roster.sortStudents(g.students)];
      parts.forEach(function (p, i) {
        A.sources.push({ key: g.name + '#' + i, group: g.name, multi: g.recvs.length > 1, part: i, parts: parts.length, label: g.name + (parts.length > 1 ? ' · ' + (i + 1) + '반' : ''), students: p });
      });
    });
  }

  function srcByKey(k) { return (S.att.sources || []).filter(function (s) { return s.key === k; })[0]; }

  function groupTime(g) {
    var c = (S.data.classes || []).filter(function (x) { return (x['수업반'] || x['접수명']) === g; })[0];
    return c ? c['시간대'] : '';
  }

  var BLOCK_FIELDS = ['program', 'name', 'same', 'room1', 'room2', 'tool1', 'tool2', 'tag', 'tagEdited'];

  /** 이 PC에서 마지막으로 입력한 반 설정 (저장하기 전에 다시 만들어도 남도록) */
  function draftKey() { return 'att-blocks:' + S.date; }
  function saveDraftBlocks() {
    try {
      localStorage.setItem(draftKey(), JSON.stringify(S.att.blocks.map(function (b) {
        var o = { key: b.key };
        BLOCK_FIELDS.forEach(function (f) { o[f] = b[f]; });
        return o;
      })));
    } catch (e) { /* 무시 */ }
  }
  function loadDraftBlocks() {
    try { return JSON.parse(localStorage.getItem(draftKey()) || 'null') || []; } catch (e) { return []; }
  }

  /** 예전 저장본(제목·문구만 있는 것)도 칸별 값으로 읽기 */
  function blockFields(p) {
    var o = {};
    BLOCK_FIELDS.forEach(function (f) { if (p[f] !== undefined) o[f] = p[f]; });
    if (!o.name && p.title) { var pt = Roster.parseTitle(p.title); if (pt) { o.program = pt.program; o.name = pt.name; } }
    if (!o.room1 && p.line) { var pl = Roster.parseLine(p.line); if (pl) Object.assign(o, pl); }
    return o;
  }

  /**
   * 반 설정 기본값 (가까운 것부터):
   * ① 이 PC에서 이 수업일에 입력하던 값 ② 이 수업일에 확정 저장한 출석부 ③ 지난 회차 출석부(교구는 비움) ④ 기본값
   */
  function makeBlocks() {
    var A = S.att;
    var local = loadDraftBlocks();
    var same = (S.data.att && S.data.att.data && S.data.att.data.blocks) || [];
    var prev = (S.data.attPrev && S.data.attPrev.blocks) || [];
    var find = function (list, key) { return list.filter(function (x) { return x.key === key; })[0]; };
    var seq = {};
    A.from = local.length ? '이 PC에서 입력하던 반 설정' : (same.length ? S.data.att.version + '차 출석부의 반 설정' : (prev.length ? '지난 회차(' + Core.shortDate(S.data.attPrev.date) + ') 반 설정' : ''));
    A.blocks = A.sources.map(function (src) {
      var time = groupTime(src.group);
      seq[time] = (seq[time] || 0) + 1;
      var d = Roster.defaultBlock(src.group, src.part, src.parts, time, seq[time]);
      var b = { key: src.key, src: src.key, group: src.group, time: time, label: src.label };
      Object.assign(b, d);
      var hit = find(local, src.key) || find(same, src.key);
      var p = find(prev, src.key);
      if (hit) Object.assign(b, blockFields(hit));
      else if (p) { Object.assign(b, blockFields(p)); b.tool1 = ''; b.tool2 = ''; }
      b.same = !!b.same;
      if (!b.tagEdited) b.tag = Roster.autoTag(b.name);
      return b;
    });
    saveDraftBlocks();
  }

  /** 학생 구성이 바뀌었는지 보는 값 (승인 학생·학교·학반) */
  window.addEventListener('beforeunload', function (e) { if (S.att && S.att.mode === 'edit' && S.att.dirty) { e.preventDefault(); e.returnValue = ''; } });

  function draftSig() {
    return attStudents().map(function (s) { return s.no + ':' + s.school + ':' + s.ban; }).sort().join('|');
  }
  /** 출석부 작업 시작 전에는 새 명단이 오면 자동으로 다시 분반·정렬합니다. 반 설정(이름·교실·교구)은 그대로 */
  function draftRefresh() {
    var A = S.att;
    if (!A || A.mode !== 'draft' || A.date !== S.date) return;
    var sig = draftSig();
    if (sig === A.sig) return;
    computeParts(); makeBlocks();
    A.sig = sig;
    toast('새 명단이 들어와서 분반을 다시 했습니다. 반 설정은 그대로입니다.', 3500);
  }

  function initDraft() {
    var old = S.att || {};
    S.att = { mode: 'draft', date: S.date, step: 1, acceptKeep: old.acceptKeep || {}, edits: old.edits || {} };
    computeParts(); makeBlocks();
    S.att.sig = draftSig();
  }

  function buildDraft() {
    var old = S.att || {};
    S.att = { mode: 'draft', date: S.date, step: 1, acceptKeep: old.acceptKeep || {}, edits: old.edits || {} };
    computeParts();
    makeBlocks();
    S.att.sig = draftSig();
    render();
    window.scrollTo(0, 0);
  }

  function blockChecks() { return Roster.checkBlocks(S.att.blocks); }

  function splitProblems() {
    var A = S.att, out = [];
    A.sources.forEach(function (s) { if (s.students.length > Roster.CAP) out.push('「' + s.label + '」이 ' + s.students.length + '명입니다. 한 반은 16명 이하여야 합니다.'); });
    (A.sets || []).forEach(function (set) {
      var where = {};
      A.sources.forEach(function (s) { s.students.forEach(function (st) { if (set.nos.indexOf(st.no) >= 0) where[s.key] = true; }); });
      if (Object.keys(where).length > 1) out.push('같은 반 요청 묶음이 두 반으로 나뉘어 있습니다.');
    });
    return out;
  }

  function roomSelect(i, f, v) {
    return '<select data-xc="att-b" data-i="' + i + '" data-f="' + f + '" aria-label="교실"><option value="">교실 선택</option>' +
      roomList(v).map(function (r) { return '<option' + (r === v ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join('') + '</select>';
  }

  function blockCard(b, i, ck) {
    var errs = ck.errors.filter(function (e) { return e.i === i; }), warns = ck.warns.filter(function (e) { return e.i === i; });
    var head = '<div class="xl-t1"><span>' + esc(md(S.date)) + ' 주말</span><select data-xc="att-b" data-i="' + i + '" data-f="program" aria-label="프로그램"><option' + (b.program === 'SW' ? ' selected' : '') + '>SW</option><option' + (b.program === '창의' ? ' selected' : '') + '>창의</option></select>' +
      '<span>프로그램</span><input type="text" value="' + esc(b.name) + '" data-xi="att-b" data-i="' + i + '" data-f="name" aria-label="반 이름" placeholder="예: 기초코딩 오전1반" style="width:220px"><span>수강생 명단</span></div>';
    var line = '<div class="xl-t2">' + (b.same ? '<span>1-4교시</span>' + roomSelect(i, 'room1', b.room1) : '<span>1-2교시</span>' + roomSelect(i, 'room1', b.room1) + '<span>, 3-4교시</span>' + roomSelect(i, 'room2', b.room2)) +
      '<span>(</span><input type="text" value="' + esc(b.tool1) + '" data-xi="att-b" data-i="' + i + '" data-f="tool1" aria-label="' + (b.same ? '교구' : '1-2교시 교구') + '" placeholder="' + (b.same ? '교구' : '1-2교시 교구') + '" style="width:170px">' +
      (b.same ? '' : '<span>/</span><input type="text" value="' + esc(b.tool2) + '" data-xi="att-b" data-i="' + i + '" data-f="tool2" aria-label="3-4교시 교구" placeholder="3-4교시 교구" style="width:170px">') + '<span>)</span></div>';
    return '<section class="card pad" style="display:flex;flex-direction:column;gap:10px' + (errs.length ? ';border-color:var(--red)' : '') + '"><div class="row between"><b>' + (i + 1) + '. ' + esc(b.label) + '</b><span class="muted small">' + esc(b.time) + ' · ' + (srcByKey(b.src) ? srcByKey(b.src).students.length : 0) + '명</span></div>' +
      '<div class="xl">' + head + line + '</div>' +
      '<div class="row small"><label class="row" style="gap:6px;min-height:36px"><input type="checkbox" data-xc="att-b" data-i="' + i + '" data-f="same"' + (b.same ? ' checked' : '') + ' style="width:18px;height:18px">1~4교시 같은 교실</label>' +
      '<span class="muted">신청반 표기</span><input type="text" value="' + esc(b.tag) + '" data-xi="att-b" data-i="' + i + '" data-f="tag" aria-label="신청반 표기" style="width:90px"><span class="muted">(반 이름에서 자동)</span></div>' +
      '<div class="small muted">인쇄될 내용: <span id="pv-' + i + '">' + esc(Roster.makeTitle(S.date, b)) + ' / ' + esc(Roster.makeLine(b)) + '</span></div>' +
      '<div id="ck-' + i + '">' + checkMsgs(errs, warns) + '</div></section>';
  }

  function checkMsgs(errs, warns) {
    return (errs.length ? '<div class="small" style="color:var(--red)">' + errs.map(function (e) { return '⚠ ' + esc(e.msg); }).join('<br>') + '</div>' : '') +
      (warns.length ? '<div class="small" style="color:var(--amber)">' + warns.map(function (e) { return '확인: ' + esc(e.msg); }).join('<br>') + '</div>' : '');
  }

  /** 작업 시작 전: 지금 명단으로 자동 분반한 미리보기. 새 명단이 오면 저절로 다시 나눔 */
  function viewAttDraft() {
    var A = S.att, saved = S.data.att;
    var lastAt = (S.data.classes || []).map(function (c) { return c.lastAt ? c.lastAt + ' · ' + c.lastBy : ''; }).filter(Boolean).sort().pop() || '';
    var red = openRows('red').length;
    var waiting = S.data.rows.filter(function (r) { return !r.cancelled && (r.cells[12] === '대기' || r.cells[12] === '추가대기'); }).length;
    var total = A.sources.reduce(function (n, x) { return n + x.students.length; }, 0);
    var html = '<section class="card pad" style="display:flex;flex-direction:column;gap:10px;border:2px solid #F59E0B"><b style="font-size:17px">' + esc(md(S.date)) + ' 출석부 · ' + (saved ? '처음부터 다시 만들기' : '작업 시작 전 미리보기') + '</b>' +
      '<div style="line-height:1.9">· 마지막 명단: <b>' + esc(lastAt ? lastAt.slice(5) : '아직 없음') + '</b> — 작업 시작 직전에 <b>명단을 한 번 더 받아</b> 주세요.<br>' +
      '· 아직 처리하지 않은 <b style="color:var(--red)">취소 대상 ' + red + '건</b> · 승인 안 된 대기 ' + waiting + '명 (출석부에서 빠짐)<br>' +
      '· 출석부에 들어갈 <b>승인</b> 신청자 <b>' + total + '명</b> · 지금은 새 명단이 올 때마다 <b>자동으로 다시 분반</b>합니다.</div>' +
      '<div class="small" style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:10px 12px;line-height:1.8"><b>[참가 신청 최종 확정 · 출석부 작업 시작]</b>을 누르면 이 분반이 <b>고정</b>됩니다.<br>' +
      '· 그다음 반 이름·교실·교구를 정하고, 학교명·학반을 고치고, 필요하면 [⇄]로 반을 옮긴 뒤 인쇄합니다.<br>· 그 뒤에 생기는 취소·새 승인은 「변동 사항」에서 <b>그 학생만</b> 교체·추가합니다. 다시 나누려면 [처음부터 다시 만들기].</div>' +
      '<div class="row">' + (saved ? '<button class="btn" data-x="att-cancel-rebuild">취소 (기존 출석부로)</button>' : '') +
      '<button class="btn primary" data-x="att-start-work" style="font-size:16px">' + (saved ? '이 분반으로 다시 시작 (기존 작업 대체)' : '참가 신청 최종 확정 · 출석부 작업 시작') + '</button></div></section>';
    var dl = dateLinks();
    if (dl.length) html += '<section class="card pad small" style="display:flex;flex-direction:column;gap:6px;background:#FAF7FF;border-color:#DDD6FE"><b>같은 반 요청</b>' + dl.map(function (x) {
      var g = x.g, label = g.members.map(function (m) { return esc(m.name) + '(' + esc(m.school) + ')'; }).join(' + ');
      if (x.applied) return '<span>✔ ' + label + ' · 이번 회차 요청' + (g.memo ? ' · ' + esc(g.memo) : '') + '</span>';
      return '<label class="row" style="gap:8px"><input type="checkbox" data-xc="att-keep" data-id="' + esc(g.id) + '"' + (A.acceptKeep[g.id] ? ' checked' : '') + ' style="width:18px;height:18px"><span>' + label + ' · <b>지난 요청 다시 적용?</b> (' + esc(Core.shortDate(g.date)) + '부터 계속 적용)</span></label>';
    }).join('') + '</section>';
    var probs = A.errors.concat(splitProblems());
    if (probs.length) html += '<section class="card pad small" style="border-color:#FECDCA;background:var(--red-bg)">' + probs.map(esc).join('<br>') + '<br><span class="muted">작업 시작 뒤 [⇄]로 옮겨 맞출 수 있습니다.</span></section>';
    html += '<section class="card pad"><b>분반 미리보기</b> <span class="muted small">같은 반 요청 → 같은 학교 → 한 반 16명 이하 → 인원 균등 (창의 1,2반은 1학년도 균등)</span><div class="tbox" style="margin-top:8px"><table class="grid"><thead><tr><th>반</th><th>인원</th><th>학생 (이름순)</th></tr></thead><tbody>' +
      A.sources.map(function (x) {
        var over = x.students.length > Roster.CAP;
        return '<tr><td><b>' + esc(x.label) + '</b></td><td style="color:' + (over ? 'var(--red)' : 'inherit') + '">' + x.students.length + '명' + (x.multi && x.parts > 1 ? ' · 1학년 ' + x.students.filter(function (z) { return z.grade1; }).length : '') + '</td>' +
          '<td class="small">' + Roster.byName(x.students).map(function (z) { return esc(z.name); }).join(', ') + '</td></tr>';
      }).join('') + '</tbody></table></div></section>';
    return html;
  }

  function draftData() {
    var A = S.att;
    return {
      acceptKeep: A.acceptKeep,
      blocks: A.blocks.map(function (b) {
        var s = srcByKey(b.src);
        return { key: b.key, group: b.group, time: b.time, label: b.label, v: 1, program: b.program, name: b.name, same: !!b.same, room1: b.room1, room2: b.room2, tool1: b.tool1, tool2: b.tool2,
          tag: b.tag, tagEdited: !!b.tagEdited, title: Roster.makeTitle(S.date, b), line: Roster.makeLine(b),
          students: Roster.byName(s.students).map(function (st) { return { no: st.no, name: st.name, school: st.school, ban: st.ban, status: '' }; }) };
      })
    };
  }

  function viewAtt() {
    var saved = S.data.att;
    if (S.att && S.att.date !== S.date) S.att = null;
    if (S.att && S.att.mode === 'draft') return viewAttDraft();
    if (saved) return viewAttSaved(saved);
    initDraft();
    return viewAttDraft();
  }

  /** only: 이 반(key)만 출력 */
  function downloadExcel(data, version, only, name) {
    var blocks = (data.blocks || []).filter(function (b) { return !only || only.indexOf(b.key) >= 0; }).map(function (b) {
      return { title: b.title, line: b.line, tag: b.tag, students: (b.students || []).filter(function (s) { return s.status !== '취소'; }) };
    });
    var wb = Roster.buildWorkbook(ExcelJS, blocks, mmdd(S.date));
    return wb.xlsx.writeBuffer().then(function (buf) { saveBlob(buf, name || Roster.fileName(S.date, version).replace(/\.xlsx$/, only ? '_바뀐반.xlsx' : '.xlsx')); });
  }

  /** 학생 → 명렬표 줄 (학부모 이름·연락처는 원본 명단에서) */
  function contactOf(s) {
    var r = s.no ? rowByNo(s.no) : null;
    return { school: s.school, ban: s.ban, name: s.name, parent: r ? Core.str(r.cells[2]) : '', phone: r ? Core.str(r.cells[3]) : '' };
  }
  function groupOfRow(r) { var c = clsInfo(r.cls); return c ? (c['수업반'] || c['접수명']) : r.cls; }

  /** 연락처 명렬표: 출석부와 같은 반·같은 순서 + 반마다 추가대기(최신 명단 기준, 신청 순서) */
  function downloadContacts(data, version, only) {
    var wb = Roster.buildContactBook(ExcelJS, contactBlocks(data, only), mmdd(S.date));
    return wb.xlsx.writeBuffer().then(function (buf) { saveBlob(buf, Roster.contactFileName(S.date, version).replace(/\.xlsx$/, only ? '_바뀐반.xlsx' : '.xlsx')); });
  }

  function contactBlocks(data, only) {
    var schools = S.data.schools || [], idx = Core.buildSchoolIndex(schools);
    var waitsBy = {};
    var rank = { '대기': 0, '추가대기': 1 };
    S.data.rows.filter(function (r) { return !r.cancelled && rank[Core.str(r.cells[12])] !== undefined; })
      .sort(function (a, b) { return (rank[a.cells[12]] - rank[b.cells[12]]) || (a.appliedAt && b.appliedAt && a.appliedAt !== b.appliedAt ? (a.appliedAt < b.appliedAt ? -1 : 1) : 0) || (a.seq - b.seq) || (+a.no - +b.no); })
      .forEach(function (r) {
        var it = Core.interpret(r.cells, idx), g = groupOfRow(r);
        (waitsBy[g] = waitsBy[g] || []).push({ state: Core.str(r.cells[12]),
          school: Core.officialSchool(it.school || it.home || r.cells[10], schools).name, ban: Core.normalizeBan(it.grade || r.cells[11]).ban,
          name: it.name || Core.str(r.cells[9]), parent: Core.str(r.cells[2]), phone: Core.str(r.cells[3]) });
      });
    var all = (data.blocks || []).filter(function (b) { return !only || only.indexOf(b.key) >= 0; });
    var gOf = function (b) { return String(b.key || '').split('#')[0]; };
    var lastOf = {};
    all.forEach(function (b, i) { lastOf[gOf(b)] = i; });
    var blocks = all.map(function (b, i) {
      var g = gOf(b);
      var parts = all.filter(function (x) { return gOf(x) === g; }).length;
      return { title: b.title, line: b.line,
        students: (b.students || []).filter(function (s) { return s.status !== '취소'; }).map(contactOf),
        waits: lastOf[g] === i ? (waitsBy[g] || []) : [], waitLabel: parts > 1 ? g + ' 공통' : '' };
    });
    // 승인 학생이 없어 출석부에 없는 반도 추가대기는 따로 붙입니다 (전체 출력일 때만)
    if (!only) Object.keys(waitsBy).forEach(function (g) {
      if (lastOf[g] === undefined) blocks.push({ title: md(S.date) + ' ' + g, line: '출석부에 없는 반 (승인된 학생 없음)', students: [], waitsOnly: true, waits: waitsBy[g], waitLabel: '' });
    });
    return blocks;
  }

  function saveBlob(buf, name) {
    var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  /**
   * 출석부 저장. base: 고치기 시작한 차수(작업 시작은 0) — 그사이 다른 점검자가 먼저 저장했으면 서버가 막습니다.
   * changed: 이번에 바꾼 반(key) — 인쇄 안 한 바뀐 반을 알기 위해 기록
   */
  function saveAtt(data, base, changed, msg) {
    setBusy(true);
    if (changed) data.changed = changed;
    return api('attSave', { date: S.date, data: data, baseVersion: base }).then(function (res) {
      try { localStorage.removeItem(draftKey()); } catch (e) { /* 무시 */ }
      toast(msg || (res.version + '차로 저장했습니다.'), 3500);
      S.att = null;
      return load(S.date).then(function () { return res; });
    }).catch(function (er) {
      if (er.code === 'CONFLICT') { toast(er.message, 6000); S.att = null; return load(S.date); }
      toast('저장하지 못했습니다: ' + er.message);
    }).then(function () { setBusy(false); });
  }

  /* ───────── 출석부 작업 시작 뒤 변동 사항 (사용자 승인으로만 바꿈) ───────── */

  function attAcks() { return marksOf('keep'); }
  function attAck(no) { setMark('keep', no, true); }
  function gOfKey(k) { return String(k || '').split('#')[0]; }

  /**
   * 고정한 출석부와 지금 명단 비교 (신청일련번호 기준)
   * out: 출석부 학생 중 예약취소·승인 아님·명단에서 사라짐 / add: 승인인데 출석부 어디에도 없음
   */
  function attChanges(data) {
    var ack = attAcks(), inRoster = {}, out = [], add = [];
    (data.blocks || []).forEach(function (b, bi) {
      (b.students || []).forEach(function (st, j) {
        if (st.no) inRoster[st.no] = true;
        if (st.status === '취소' || !st.no || ack[st.no]) return;
        var r = rowByNo(st.no);
        var kind = !r ? 'gone' : (r.cancelled || Core.str(r.cells[12]) === '예약취소' ? 'cancel' : (Core.str(r.cells[12]) !== '승인' ? 'unapproved' : ''));
        if (kind) out.push({ kind: kind, bi: bi, j: j, st: st, row: r });
      });
    });
    (S.data.rows || []).forEach(function (r) {
      if (r.cancelled || Core.str(r.cells[12]) !== '승인' || inRoster[r.no] || ack[r.no]) return;
      add.push({ row: r, group: groupOfRow(r) });
    });
    add.sort(function (a, b) { return (a.row.appliedAt || a.row.no) < (b.row.appliedAt || b.row.no) ? -1 : 1; });
    return { out: out, add: add, count: out.length + add.length };
  }

  function studentFromRow(r) {
    var it = Core.interpret(r.cells, Core.buildSchoolIndex(S.data.schools || []));
    return { no: r.no, name: it.name || Core.str(r.cells[9]), school: Roster.officialSchool(it.school || it.home || r.cells[10], S.data.schools || []).name,
      ban: Roster.normalizeBan(it.grade || r.cells[11]).ban, status: '' };
  }

  function changesCard(A) {
    var ch = attChanges(A.data), blocks = A.data.blocks || [];
    if (!ch.count) return '<section class="card pad small" style="border-color:#86EFAC">✔ 작업 시작 뒤 바뀐 신청이 없습니다. 새 명단이 올라오면 여기에서 알려 드립니다.</section>';
    var KIND = { cancel: '예약취소', unapproved: '승인 아님', gone: '명단에서 사라짐' };
    var live = function (b) { return (b.students || []).filter(function (x) { return x.status !== '취소'; }).length; };
    var html = '<section class="card pad" style="display:flex;flex-direction:column;gap:10px;border:2px solid #F59E0B"><div class="row between"><b style="font-size:17px">⚠ 변동 사항 ' + ch.count + '건</b>' +
      '<span class="muted small">자동으로 바꾸지 않습니다. 하나씩 확인하고 버튼을 눌러 주세요. 바꾼 뒤 [저장] → <b>[아직 인쇄 안 한 바뀐 반]</b>으로 그 반만 인쇄합니다.</span></div>';
    var used = {};
    ch.out.forEach(function (o) {
      var b = blocks[o.bi], g = gOfKey(b.key);
      var cands = ch.add.filter(function (a) { return a.group === g && !used[a.row.no]; });
      // 전화로 참석 확정한 대기자(아직 승인 전)도 맨 아래에 (선택하면 「통합예약 승인 필요」 표시)
      waitList(g).forEach(function (r) { if (waitResult(r.no) === '참석 확정') cands.push({ row: r, group: g, pending: true }); });
      cands.sort(function (a, b) { return (waitResult(b.row.no) === '참석 확정') - (waitResult(a.row.no) === '참석 확정'); });
      var r = o.row;
      html += '<div class="chg"><div><span class="badge red">' + KIND[o.kind] + '</span> <b>' + esc(o.st.name) + '</b> <span class="muted small">' + esc(o.st.school) + ' ' + esc(o.st.ban) + ' · ' + esc(b.name || b.title) +
        (r && r.cancelAt ? ' · ' + esc(shortTs(r.cancelAt)) + ' 취소' : '') + '</span></div><div class="row" style="gap:6px">' +
        (cands.length ? '<select id="rep-' + o.bi + '-' + o.j + '" aria-label="교체할 학생">' + cands.map(function (a) {
          return '<option value="' + esc(a.row.no) + '">' + (waitResult(a.row.no) === '참석 확정' ? '★ ' : '') + esc(a.row.cells[9]) + ' · ' + esc(a.row.cells[10]) + ' ' + esc(a.row.cells[11]) + (a.pending ? ' (승인 전)' : '') + (a.row.level === 'red' ? ' ⚠' + esc(issueText(a.row)) : '') + '</option>';
        }).join('') + '</select><button class="btn sm primary" data-x="chg-replace" data-i="' + o.bi + '" data-j="' + o.j + '">교체</button>' : '<span class="muted small">같은 수업에 새 학생 없음</span>') +
        '<button class="btn sm" data-x="chg-remove" data-i="' + o.bi + '" data-j="' + o.j + '">출석부에서 빼기</button>' +
        '<button class="btn sm" data-x="chg-keep" data-no="' + esc(o.st.no) + '" title="출석부를 그대로 두고 이 알림만 지웁니다 (강사가 결석 처리)">그대로 두기</button></div>' + waitTable(g, o) + '</div>';
    });
    ch.add.forEach(function (a) {
      var targets = blocks.map(function (b, bi) { return { b: b, bi: bi }; }).filter(function (x) { return gOfKey(x.b.key) === a.group && live(x.b) < Roster.CAP; });
      var r = a.row;
      html += '<div class="chg"><div><span class="badge new">새로 승인</span> <b>' + esc(r.cells[9]) + '</b> <span class="muted small">' + esc(r.cells[10]) + ' ' + esc(r.cells[11]) + ' · ' + esc(a.group) +
        (r.appliedAt ? ' · ' + esc(shortTs(r.appliedAt)) + ' 신청' : '') + '</span>' + (r.level ? ' <span class="badge ' + (r.level === 'red' ? 'red' : 'amber') + '">' + esc(issueText(r)) + '</span>' : '') + '</div><div class="row" style="gap:6px">' +
        (targets.length ? '<select id="add-' + esc(r.no) + '" aria-label="추가할 반">' + targets.map(function (x) { return '<option value="' + x.bi + '">' + esc(x.b.name || x.b.title) + ' (' + live(x.b) + '명)</option>'; }).join('') + '</select>' +
          '<button class="btn sm primary" data-x="chg-add" data-no="' + esc(r.no) + '">이 반에 추가</button>' : '<span class="muted small">' + (blocks.some(function (b) { return gOfKey(b.key) === a.group; }) ? '빈자리가 있는 반 없음 (16명)' : '출석부에 없는 반') + '</span>') +
        '<button class="btn sm" data-x="chg-keep" data-no="' + esc(r.no) + '">나중에</button></div></div>';
    });
    return html + '</section>';
  }

  /** 같은 수업의 대기자: 대기 먼저, 그다음 추가대기, 각각 신청 시각순 */
  function waitList(g) {
    var inRoster = {};
    ((S.att && S.att.data && S.att.data.blocks) || []).forEach(function (b) { (b.students || []).forEach(function (x) { if (x.no) inRoster[x.no] = 1; }); });
    var rank = { '대기': 0, '추가대기': 1 };
    return (S.data.rows || []).filter(function (r) { return !r.cancelled && rank[Core.str(r.cells[12])] !== undefined && groupOfRow(r) === g && !inRoster[r.no]; })
      .sort(function (a, b) { return (rank[a.cells[12]] - rank[b.cells[12]]) || ((a.appliedAt || '') < (b.appliedAt || '') ? -1 : (a.appliedAt || '') > (b.appliedAt || '') ? 1 : a.seq - b.seq); });
  }
  function waitResult(no) { var l = (S.data.waitLogs || []).filter(function (x) { return x.no === no; })[0]; return l ? l.result : ''; }

  function waitTable(g, o) {
    var list = waitList(g).slice(0, 12);
    if (!list.length) return '';
    var anyLog = list.some(function (r) { return waitResult(r.no); });
    return '<details class="wl"' + (anyLog || flowStage() === 'day' ? ' open' : '') + '><summary>대기자 연락 순서 (' + list.length + '명) — 대기 먼저, 신청 시각순</summary><table class="grid"><tbody>' + list.map(function (r, k) {
      var res = waitResult(r.no);
      var b = function (v, cls) { return '<button class="btn sm' + (res === v ? ' ' + cls : '') + '" data-x="wl" data-no="' + esc(r.no) + '" data-r="' + v + '">' + v + '</button>'; };
      return '<tr class="' + (res === '불참' || res === '연락 안 됨' ? 'cut' : '') + '"><td>' + (k + 1) + '</td><td><span class="badge">' + esc(r.cells[12]) + '</span></td><td><b>' + esc(r.cells[9]) + '</b> <span class="muted small">' + esc(r.cells[10]) + ' ' + esc(r.cells[11]) + '</span></td>' +
        '<td>' + esc(r.cells[2]) + ' <a href="tel:' + esc(String(r.cells[3]).replace(/[^0-9]/g, '')) + '">' + esc(r.cells[3]) + '</a></td><td class="small muted">' + esc(shortTs(r.appliedAt)) + '</td>' +
        '<td style="white-space:nowrap">' + b('참석 확정', 'primary') + b('불참', 'absent-on') + b('연락 안 됨', 'absent-on') + '</td></tr>';
    }).join('') + '</tbody></table><div class="small muted">참석 확정 → <b>통합예약에서 승인</b> → 명단 다시 보내기 → 위 [교체]에서 ★ 학생 선택 (급하면 승인 전에도 교체 가능)</div></details>';
  }

  function issueText(r) { return (r.issues || []).map(function (x) { return x.label; }).join(', '); }

  /** 빼거나 교체한 학생: 기한 뒤 취소면 결석 기록(기한 후 취소) */
  function lateAbsenceFor(st, b) {
    var r = st.no ? rowByNo(st.no) : null;
    if (!r || !r.cancelAt || r.cancelAt < cancelDeadline() || absOf(st.no)) return false;
    saveAbs(absForStudent(st, b), true);
    return true;
  }

  function printedOf(data) { return data.printed || {}; }
  /** 아직 인쇄하지 않은 바뀐 반 (반마다 마지막으로 바뀐 차수 > 인쇄한 차수) */
  function unprinted(data) {
    var pr = printedOf(data);
    return (data.blocks || []).filter(function (b) { return (+b.v || 1) > (+pr[b.key] || 0); }).map(function (b) { return b.key; });
  }

  function viewAttSaved(saved) {
    // 저장 안 한 변경이 있는데 다른 점검자가 새 차수를 저장했으면, 내 변경을 말없이 지우지 않고 알립니다
    if (S.att && S.att.mode === 'edit' && S.att.dirty && S.att.date === S.date && S.att.version !== saved.version) S.att.newer = saved;
    else if (!S.att || S.att.mode !== 'edit' || S.att.version !== saved.version) {
      S.att = { mode: 'edit', date: S.date, version: saved.version, data: JSON.parse(JSON.stringify(saved.data)), dirty: false, changed: {}, openSet: (S.att && S.att.openSet) || {} };
      (S.att.data.blocks || []).forEach(function (b) {
        b.students = Roster.byName(b.students);
        if (!b.time) b.time = groupTime(gOfKey(b.key));
        if (!b.group) b.group = gOfKey(b.key);
        if (!b.name) { var pt = Roster.parseTitle(b.title) || {}; b.program = b.program || pt.program; b.name = pt.name || ''; }
      });
    }
    var A = S.att, blocks = A.data.blocks || [];
    A.blocks = blocks;  // 반 설정 카드가 같은 자료를 고치도록
    var nChanged = Object.keys(A.changed || {}).length, up = unprinted(saved.data), ck = Roster.checkBlocks(blocks);
    var newer = A.newer ? '<section class="card pad row between" style="border:2px solid var(--red);background:var(--red-bg)"><div><b>⚠ ' + esc(A.newer.by) + ' 선생님이 ' + esc(String(A.newer.at).slice(5, 16)) + '에 ' + A.newer.version + '차를 먼저 저장했습니다.</b>' +
      '<div class="small">내가 고친 내용(저장 안 함)은 아직 화면에 남아 있지만, 이대로는 저장할 수 없습니다. 고친 내용을 적어 두고 새로 불러온 뒤 다시 해 주세요.</div></div>' +
      '<button class="btn primary" data-x="att-reload">내 변경 버리고 새로 불러오기</button></section>' : '';
    var html = newer + '<section class="card pad" style="display:flex;flex-direction:column;gap:10px;border-color:#86EFAC"><div class="row between"><div><b style="font-size:17px">✔ 출석부 작업 중 · ' + saved.version + '차 저장 · ' + esc(String(saved.at).slice(5, 16)) + ' · ' + esc(saved.by) + '</b> ' +
      tip('분반이 고정되어 있습니다. 새 명단이 와도 바뀌지 않고, 바뀐 신청은 「변동 사항」에서 승인해야 반영됩니다. [결석]: 출석부에 남기고 결석 기록(당일 무단결석)만 남김. [출석부에서 빼기]: 출석부에서 빼고 결석 기록(기한 후 취소)을 남김 — 저장 후 그 반을 다시 인쇄.') + '</div>' +
      '<div class="row" style="gap:6px"><button class="btn primary" data-x="att-save2"' + (A.dirty && !A.newer ? '' : ' disabled') + '>' + (A.dirty ? '저장' + (nChanged ? ' (바뀐 반 ' + nChanged + '개)' : '') : '저장됨 ✔') + '</button>' +
      '<button class="btn" data-x="att-print" data-what="all">전체 인쇄</button>' +
      '<button class="btn' + (up.length && up.length < blocks.length ? ' primary' : '') + '" data-x="att-print" data-what="changed"' + (up.length ? '' : ' disabled') + '>바뀐 반 인쇄 (' + up.length + ')</button>' +
      '<button class="btn" data-x="att-print" data-what="contacts">명렬표 인쇄</button></div></div>' +
      '<details class="more"><summary class="small">더 보기 (엑셀 내려받기 · 처음부터 다시 만들기)</summary><div class="row" style="gap:6px;margin-top:6px">' +
      '<button class="btn sm" data-x="att-redl">출석부 엑셀</button><button class="btn sm" data-x="att-contacts">명렬표 엑셀</button>' +
      '<button class="btn sm" data-x="att-rebuild">처음부터 다시 만들기</button></div></details></section>' + changesCard(A);
    blocks.forEach(function (b, i) {
      var all = b.students || [];
      var liveList = all.filter(function (s) { return s.status !== '취소'; });
      var cut = all.filter(function (s) { return s.status === '취소'; });
      var live = liveList.length;
      var idx = function (s) { return all.indexOf(s); };
      var sib = blocks.filter(function (x) { return x !== b && gOfKey(x.key) === gOfKey(b.key); });
      var isUp = up.indexOf(b.key) >= 0 && saved.version > 1, isCh = A.changed && A.changed[b.key];
      var sheet = Roster.sheetHtml({ title: b.title, line: b.line, tag: b.tag, students: liveList }, { cell: function (t, c, v, s) {
        if (t === 4 && c === 10) return '<span class="xk-h">' + (sib.length ? '반 옮기기 · ' : '') + '결석 · 빼기</span> ' + tip('결석: 출석부에 남고 결석 기록만 남깁니다. 출석부에서 빼기: 출석부에서 빼고 기한 후 취소로 기록합니다.');
        if (!s) return;
        if (c === 1) return '<input type="text" class="cellin' + (Roster.officialSchool(s.school, S.data.schools || []).ok ? '' : ' warn') + '" value="' + esc(s.school) + '" data-xi="att-e2" data-i="' + i + '" data-j="' + idx(s) + '" data-f="school" aria-label="학교명">';
        if (c === 2) return '<input type="text" class="cellin' + (/^\d-\d+$/.test(s.ban) ? '' : ' warn') + '" value="' + esc(s.ban) + '" data-xi="att-e2" data-i="' + i + '" data-j="' + idx(s) + '" data-f="ban" aria-label="학반">';
        if (c === 10) {
          var ab = absForAtt(s);
          return (sib.length ? '<button class="btn sm" data-x="att-move2" data-i="' + i + '" data-j="' + idx(s) + '" title="같은 수업의 다른 반으로 옮기기" aria-label="다른 반으로 옮기기">⇄</button>' : '') +
            '<label class="abs-chk' + (ab ? ' on' : '') + '"><input type="checkbox" data-xc="att-absent" data-i="' + i + '" data-j="' + idx(s) + '"' + (ab ? ' checked' : '') + '>결석</label>' +
            (s.replaced ? '<span class="badge new" title="' + esc(s.replaced) + ' 대신">' + esc(s.ver || '') + '차 교체</span>' : (s.added ? '<span class="badge new">' + (s.ver ? esc(s.ver) + '차 ' : '') + '추가</span>' : '')) +
            (s.needApproval ? '<span class="badge red" title="통합예약에서 승인한 뒤 명단을 다시 보내 주세요">통합예약 승인 필요</span>' : '') +
            '<button class="btn sm" data-x="att-cancel" data-i="' + i + '" data-j="' + idx(s) + '" title="출석부에서 빼고 결석 기록(기한 후 취소)을 남깁니다">출석부에서 빼기</button>';
        }
      } });
      var open = A.openSet[b.key];
      html += '<section class="card pad" style="display:flex;flex-direction:column;gap:8px' + (isCh ? ';border:2px solid var(--blue)' : (isUp ? ';border:2px solid #F59E0B' : '')) + '"><div class="row between"><b>' + esc(b.name || b.label || (i + 1) + '번째 반') +
        (isCh ? ' <span class="badge new">바뀜 · 저장 필요</span>' : (isUp ? ' <span class="badge warn">바뀜 · 아직 인쇄 안 함</span>' : '')) + '</b>' +
        '<div class="row" style="gap:6px"><span style="font-weight:700;color:' + (live > Roster.CAP ? 'var(--red)' : 'inherit') + '">' + live + '명' + (live > Roster.CAP ? ' ⚠ 16명 초과' : '') + '</span>' +
        '<button class="btn sm" data-x="att-setopen" data-key="' + esc(b.key) + '">' + (open ? '반 설정 닫기' : '반 설정 (이름·교실·교구)') + '</button>' +
        '<button class="btn sm" data-x="att-print" data-what="one" data-i="' + i + '">이 반 인쇄</button></div></div>' +
        (open ? blockCard(b, i, ck) : '') +
        '<div class="tbox">' + sheet + '</div>' +
        (cut.length ? '<div class="small" style="display:flex;flex-direction:column;gap:6px"><b>빠진 학생 (인쇄에 안 나옴)</b>' + cut.map(function (s) {
          return '<div class="row" style="gap:8px"><span class="badge done">' + esc(s.cut || '취소') + '</span><span>' + esc(s.name) + ' · ' + esc(s.school) + ' ' + esc(s.ban) + '</span><button class="btn sm" data-x="att-uncancel" data-i="' + i + '" data-j="' + idx(s) + '">되돌리기</button></div>';
        }).join('') + '</div>' : '') +
        '<div><button class="btn sm" data-x="att-addstu" data-i="' + i + '" title="명단에 없거나 아직 승인 전인 학생을 이 반에 직접 넣습니다">학생 직접 추가</button></div></section>';
    });
    return html;
  }

  /* ───────── 인쇄 (웹앱에서 바로) ───────── */

  function printHtml(html, label) {
    var box = document.getElementById('print-area');
    if (!box) { box = document.createElement('div'); box.id = 'print-area'; document.body.appendChild(box); }
    box.innerHTML = html;
    document.body.classList.add('printing');
    var done = function () { document.body.classList.remove('printing'); box.innerHTML = ''; window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); setTimeout(done, 1000); }, 50);
    if (label) toast(label, 2500);
  }

  function printSheets(blocks) {
    printHtml(blocks.map(function (b) {
      return '<div class="pa-page">' + Roster.sheetHtml({ title: b.title, line: b.line, tag: b.tag, students: (b.students || []).filter(function (x) { return x.status !== '취소'; }) }, { cell: function (t, c) { if (c === 10) return ''; } }) + '</div>';
    }).join(''));
  }

  /** 인쇄한 반 기록 (점검자끼리 공유) */
  function markPrinted(keys) {
    var saved = S.data.att;
    if (!saved || !keys.length) return;
    var pr = printedOf(saved.data);
    keys.forEach(function (k) { pr[k] = saved.version; });
    saved.data.printed = pr;
    if (S.att && S.att.data) S.att.data.printed = pr;
    api('attPrinted', { date: S.date, version: saved.version, keys: keys }).then(function (res) { if (res && res.rev) S.rev = res.rev; render(); }).catch(function () { /* 다음에 다시 */ });
  }

  function doPrint(what, i) {
    var saved = S.data.att, data = saved.data, blocks = data.blocks || [], list;
    if (what === 'contacts') { printHtml(Roster.contactHtml(contactBlocks(data, null))); return; }
    if (what === 'all') list = blocks;
    else if (what === 'changed') { var up = unprinted(data); list = blocks.filter(function (b) { return up.indexOf(b.key) >= 0; }); }
    else list = [blocks[i]];
    if (!list.length) { toast('인쇄할 반이 없습니다.'); return; }
    printSheets(list);
    markPrinted(list.map(function (b) { return b.key; }));
  }

  /** 저장 안 한 변경이 있으면 저장부터 */
  function printAfterSave(what, i) {
    var A = S.att;
    if (A && A.dirty) {
      if (!confirm('저장하지 않은 변경이 있습니다. 저장하고 인쇄할까요?')) return;
      attSaveEdit().then(function (res) { if (res) doPrint(what, i); });
      return;
    }
    doPrint(what, i);
  }

  function attSaveEdit() {
    var A = S.att, keys = Object.keys(A.changed || {});
    var data = JSON.parse(JSON.stringify(A.data));
    data.printed = (S.data.att && S.data.att.data.printed) || data.printed || {};  // 그사이 인쇄한 기록 이어 가기
    data.blocks.forEach(function (b) { if (keys.indexOf(b.key) >= 0) b.v = A.version + 1; });
    return saveAtt(data, A.version, keys.length ? keys : null, (A.version + 1) + '차로 저장했습니다.' + (keys.length ? ' 바뀐 반 ' + keys.length + '개는 다시 인쇄해 주세요.' : ''));
  }

  function attAddStudent(i) {
    var A = S.att, inRoster = {};
    A.data.blocks.forEach(function (b) { (b.students || []).forEach(function (s) { if (s.no) inRoster[s.no] = true; }); });
    var cands = S.data.rows.filter(function (r) { return !r.cancelled && !inRoster[r.no]; });
    var html = '<h2 style="margin:0">학생 추가 · ' + esc(A.data.blocks[i].title) + '</h2>' +
      '<p class="muted small" style="margin:0">출석부에 없는 신청자(대기·추가대기 등) 중에서 고르거나 직접 입력합니다.</p>' +
      '<div style="max-height:320px;overflow:auto;display:flex;flex-direction:column;gap:6px">' + (cands.length ? cands.map(function (r, k) {
        return '<button class="btn" style="text-align:left" data-m="pick" data-k="' + k + '">' + esc(r.cells[9]) + ' · ' + esc(r.cells[10]) + ' ' + esc(r.cells[11]) + ' · ' + esc(r.cls) + ' · <b>' + esc(r.cells[12]) + '</b></button>';
      }).join('') : '<span class="muted small">고를 수 있는 신청자가 없습니다.</span>') + '</div>' +
      '<div class="row"><input type="text" id="mn" placeholder="학생명"><input type="text" id="ms" placeholder="학교"><input type="text" id="mb" placeholder="학반 (예: 3-2)" style="width:110px"><button class="btn" data-m="manual">직접 추가</button></div>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn" data-m="close">닫기</button></div>';
    modal(html, function (m, b, w, close) {
      var st = null;
      if (m === 'close') return close();
      if (m === 'pick') {
        var r = cands[+b.getAttribute('data-k')];
        var it = Core.interpret(r.cells, Core.buildSchoolIndex(S.data.schools || []));
        st = { no: r.no, name: it.name || r.cells[9], school: Roster.officialSchool(it.school || r.cells[10], S.data.schools || []).name, ban: Roster.normalizeBan(it.grade || r.cells[11]).ban };
      } else if (m === 'manual') {
        var n = w.querySelector('#mn').value.trim();
        if (!n) { toast('학생명을 적어 주세요.'); return; }
        st = { no: '', name: n, school: Roster.officialSchool(w.querySelector('#ms').value, S.data.schools || []).name, ban: Roster.normalizeBan(w.querySelector('#mb').value).ban };
      }
      if (st) {
        st.status = ''; st.added = true;
        st.ver = A.version + 1;
        A.data.blocks[i].students = Roster.byName(A.data.blocks[i].students.concat([st]));
        A.dirty = true; A.changed[A.data.blocks[i].key] = true;
        close(); render();
      }
    });
  }

  /** 출석부 학생의 이 수업일 결석 기록 */
  function absForAtt(s) {
    return (S.data.absences || []).filter(function (a) { return a.date === S.date && ((s.no && a.no === s.no) || (!s.no && !a.no && a.name === s.name)); })[0];
  }

  function absForStudent(s, b) {
    var r = s.no ? rowByNo(s.no) : null;
    return { date: S.date, no: s.no, name: s.name, school: s.school, ban: s.ban, cls: b.tag, phone: r ? r.cells[3] : '', cancelAt: r && r.cancelAt ? shortTs(r.cancelAt) : '', src: '출석부에서 뺌', reason: '기한 후 취소' };
  }

  /* ───────── 새 기능 이벤트 ───────── */

  function extraClick(t) {
    var x = t.getAttribute('data-x');
    var i = +t.getAttribute('data-i'), j = +t.getAttribute('data-j');
    var A = S.att;
    if (x === 'sel-clear') { S.sel = {}; refreshFull(); }
    else if (x === 'sel-link') linkDialog();
    else if (x === 'abs-del') {
      var da = absById(t.getAttribute('data-id'));
      if (da && confirm(da.name + ' 학생의 결석 기록을 삭제할까요?')) deleteAbs(da);
    }
    else if (x === 'abs-add') absAddManual();
    else if (x === 'round-now') {
      if (S.att && S.att.mode === 'edit' && S.att.dirty && !confirm('출석부에 저장하지 않은 변경이 있습니다. 회차를 바꾸면 사라집니다. 바꿀까요?')) return;
      S.lastUpload = null; load(currentRoundDate());
    }
    else if (x === 'r-find') { S.query = t.getAttribute('data-name'); S.view = 'full'; render(); window.scrollTo(0, 0); }
    else if (x === 'guide-print') window.print();
    else if (x === 'set-add') { var ta = t.getAttribute('data-tab'); setCapture(ta); S.setDraft[ta].push([]); render(); }
    else if (x === 'set-del') { var td = t.getAttribute('data-tab'); setCapture(td); S.setDraft[td].splice(+t.getAttribute('data-r'), 1); render(); }
    else if (x === 'set-reset') { S.setDraft[t.getAttribute('data-tab')] = null; S.setErr[t.getAttribute('data-tab')] = ''; render(); }
    else if (x === 'set-save') setSave(t.getAttribute('data-tab'));
    else if (x === 'school-add') {
      var nm = (document.getElementById('sch-add').value || '').trim();
      if (!nm) { toast('학교 이름을 적어 주세요.'); return; }
      setBusy(true);
      api('settingsSave', { tab: 'schoolAdd', rows: [[nm]] }).then(function () { toast(nm + '을(를) 추가했습니다.'); S.settings = null; return load(S.date); })
        .catch(function (er) { toast(er.message, 5000); }).then(function () { setBusy(false); });
    }
    else if (x === 'rule-save') saveRule(+document.getElementById('ld').value, document.getElementById('lt').value);
    else if (x === 'term-save') {
      var tn = (document.getElementById('term').value || '').trim();
      if (!tn) { toast('이름을 적어 주세요.'); return; }
      setBusy(true);
      api('termName', { name: tn }).then(function (res) { S.data.termName = res.name; if (res.rev) S.rev = res.rev; render(); toast('운영 시기 이름을 「' + res.name + '」로 바꿨습니다.'); })
        .catch(function (er) { toast(/알 수 없는 요청/.test(er.message) ? 'Apps Script(Code.gs)를 새 버전으로 바꿔야 저장할 수 있습니다.' : er.message, 5000); }).then(function () { setBusy(false); });
    }
    else if (x === 'open-save') {
      var od = +document.getElementById('od').value, ot = document.getElementById('ot').value;
      setBusy(true);
      api('openRule', { days: od, time: ot }).then(function (res) { S.data.openRule = res.rule; if (res.rev) S.rev = res.rev; S.settings = null; render(); toast('접수 시작을 수업 ' + od + '일 전 ' + ot + '로 바꿨습니다.'); })
        .catch(function (er) { toast(/알 수 없는 요청/.test(er.message) ? 'Apps Script(Code.gs)를 새 버전으로 바꿔야 저장할 수 있습니다.' : er.message, 5000); }).then(function () { setBusy(false); });
    }
    else if (x === 'late-rule') { S.view = 'settings'; render(); window.scrollTo(0, 0); }
    else if (x === 'late-add') { var lr = rowByNo(t.getAttribute('data-no')); if (lr) { saveAbs(lateRecord(lr)); toast(Core.str(lr.cells[9]) + ' 학생을 「기한 후 취소」로 등록했습니다.', 2000); } }
    else if (x === 'late-all') { var la = lateCancels(); la.forEach(function (r) { saveAbs(lateRecord(r), true); }); render(); toast(la.length + '명을 「기한 후 취소」로 등록했습니다.', 2500); }
    else if (x === 'late-skip') setMark('skip', t.getAttribute('data-no'), true);
    else if (x === 'late-unskip') setMark('skip', '*', false);
    else if (x === 'abs-addrow') { var box = document.getElementById('abs-new'); box.insertAdjacentHTML('beforeend', absNewRow()); box.lastElementChild.querySelector('.an').focus(); }
    else if (x === 'abs-sort') { S.absSort = t.getAttribute('data-v'); render(); }
    else if (x === 'att-redl') downloadExcel(S.data.att.data, S.data.att.version);
    else if (x === 'att-contacts') downloadContacts(S.data.att.data, S.data.att.version).then(function () { toast('연락처 명렬표를 내려받았습니다. 추가대기는 지금 올라와 있는 최신 명단 기준입니다.'); });
    else if (x === 'att-save2') attSaveEdit();
    else if (x === 'att-print') printAfterSave(t.getAttribute('data-what'), i);
    else if (x === 'att-start-work') {
      var base = S.data.att ? S.data.att.version : 0;
      if (!confirm(base ? '지금 명단으로 처음부터 다시 나눈 출석부로 바꿀까요?\n\n지금까지 한 교체·옮기기는 사라지고, 반 이름·교실·교구는 이어집니다.' : '참가 신청을 최종 확정하고 출석부 작업을 시작할까요?\n\n이 분반이 고정되고, 이후 취소·새 승인은 「변동 사항」에서 그 학생만 바꿉니다.')) return;
      computeParts(); makeBlocks();
      var wd = draftData();
      if (base) wd.blocks.forEach(function (b) { b.v = base + 1; });
      saveAtt(wd, base, null, base ? '새로 나눈 출석부로 바꿨습니다.' : '출석부 작업을 시작했습니다. 반 설정을 하고 인쇄하세요.').then(function () { window.scrollTo(0, 0); });
    }
    else if (x === 'att-cancel-rebuild') { S.att = null; render(); }
    else if (x === 'att-reload') { if (confirm('저장하지 않은 내 변경을 버리고 새로 불러올까요?')) { S.att = null; render(); } }
    else if (x === 'att-setopen') { var k = t.getAttribute('data-key'); A.openSet[k] = !A.openSet[k]; render(); }
    else if (x === 'att-move2') {
      var mb = A.data.blocks[i], ms = mb.students[j];
      var sibs = A.data.blocks.filter(function (z) { return z !== mb && gOfKey(z.key) === gOfKey(mb.key); });
      if (!sibs.length || !ms) return;
      var to = sibs[0];
      mb.students.splice(j, 1);
      to.students = Roster.byName(to.students.concat([ms]));
      A.dirty = true; A.changed[mb.key] = true; A.changed[to.key] = true;
      render(); toast(ms.name + ' 학생을 ' + (to.name || '다른 반') + '으로 옮겼습니다.', 2000);
    }
    else if (x === 'wl') {
      var wno = t.getAttribute('data-no'), wr = t.getAttribute('data-r');
      var nr2 = waitResult(wno) === wr ? '' : wr;
      S.data.waitLogs = (S.data.waitLogs || []).filter(function (z) { return z.no !== wno; });
      if (nr2) S.data.waitLogs.push({ no: wno, result: nr2, by: (S.user && S.user.name) || '', at: nowKst() });
      render();
      api('waitLog', { date: S.date, no: wno, result: nr2 }).then(function (res) { if (res.rev) S.rev = res.rev; })
        .catch(function (er) { toast(/알 수 없는 요청/.test(er.message) ? 'Apps Script(Code.gs)를 새 버전으로 바꿔야 연락 결과가 저장됩니다.' : er.message, 5000); });
      if (nr2 === '참석 확정') toast('통합예약에서 승인한 뒤 명단을 다시 보내 주세요. 그러면 교체 후보 맨 위(★)에 나옵니다.', 4500);
    }
    else if (x === 'att-rebuild') { if (confirm('처음부터 다시 분반한 미리보기를 엽니다. [이 분반으로 다시 시작]을 누르기 전까지 지금 출석부는 그대로입니다. 계속할까요?')) buildDraft(); }
    else if (x === 'chg-replace' || x === 'chg-remove') {
      var cb = A.data.blocks[i], cs = cb.students[j];
      var nst = null;
      if (x === 'chg-replace') {
        var sel = document.getElementById('rep-' + i + '-' + j), nr = sel && rowByNo(sel.value);
        if (!nr) return;
        nst = studentFromRow(nr); nst.added = true; nst.replaced = cs.name; nst.ver = A.version + 1;
        if (Core.str(nr.cells[12]) !== '승인') nst.needApproval = true;
      }
      cs.status = '취소'; cs.cut = x === 'chg-replace' ? '교체' : '빼기';
      if (nst) cb.students = Roster.byName(cb.students.concat([nst]));
      A.dirty = true; A.changed[cb.key] = true;
      var late = lateAbsenceFor(cs, cb);
      render();
      toast((nst ? cs.name + ' → ' + nst.name + ' 교체했습니다.' : cs.name + ' 학생을 출석부에서 뺐습니다.') + (late ? ' 기한 뒤 취소라 결석 기록(기한 후 취소)에도 넣었습니다.' : '') + ' [저장]을 눌러야 저장됩니다.', 4000);
    }
    else if (x === 'chg-add') {
      var no = t.getAttribute('data-no'), ar = rowByNo(no), asel = document.getElementById('add-' + no);
      if (!ar || !asel) return;
      var ab2 = A.data.blocks[+asel.value], ns = studentFromRow(ar);
      ns.added = true; ns.ver = A.version + 1;
      ab2.students = Roster.byName(ab2.students.concat([ns]));
      A.dirty = true; A.changed[ab2.key] = true; render();
      toast(ns.name + ' 학생을 ' + (ab2.name || '반') + '에 추가했습니다. [저장]을 눌러야 저장됩니다.', 3000);
    }
    else if (x === 'chg-keep') attAck(t.getAttribute('data-no'));
    else if (x === 'att-cancel') {
      var b = A.data.blocks[i], st = b.students[j];
      st.status = '취소'; A.dirty = true; A.changed[b.key] = true; render();
      saveAbs(absForStudent(st, b)).then(function () { toast(st.name + ' 학생을 취소자로 표시하고 결석 기록에 넣었습니다.'); });
    } else if (x === 'att-uncancel') {
      var b2 = A.data.blocks[i], st2 = b2.students[j];
      st2.status = ''; A.dirty = true; A.changed[b2.key] = true; render();
      var rec = (S.data.absences || []).filter(function (a) { return (a.src === '출석부에서 뺌' || a.src === '출석부 취소 처리') && ((st2.no && a.no === st2.no) || (!st2.no && a.name === st2.name)); })[0];
      if (rec) deleteAbs(rec);
    } else if (x === 'att-addstu') attAddStudent(i);
  }

  function extraChange(el) {
    var x = el.getAttribute('data-xc'), A = S.att;
    if (x === 'att-absent') {
      var ab = A.data.blocks[+el.getAttribute('data-i')], sa = ab.students[+el.getAttribute('data-j')];
      var ex = absForAtt(sa);
      if (el.checked && !ex) saveAbs(Object.assign(absForStudent(sa, ab), { src: '출석부 결석 체크', reason: '당일 무단결석' }));
      else if (!el.checked && ex) {
        if (ex.memo && !confirm(sa.name + ' 학생의 결석 체크를 해제할까요? 적어 둔 메모도 지워집니다.')) { el.checked = true; return; }
        deleteAbs(ex);
      }
      return;
    }
    if (x === 'abs-reason2') { absPatch(el.getAttribute('data-id'), { reason: el.value }); return; }
    if (x === 'abs-ex') absPatch(el.getAttribute('data-id'), { excused: el.checked });
    else if (x === 'abs-field') { var p = {}; p[el.getAttribute('data-f')] = el.value; absPatch(el.getAttribute('data-id'), p); }
    else if (x === 'att-keep') { if (el.checked) A.acceptKeep[el.getAttribute('data-id')] = true; else delete A.acceptKeep[el.getAttribute('data-id')]; computeParts(); render(); }
    else if (x === 'att-b') {
      var b = A.blocks[+el.getAttribute('data-i')], f = el.getAttribute('data-f');
      b[f] = el.type === 'checkbox' ? el.checked : el.value;
      if (A.mode === 'edit') editBlockChanged(b); else saveDraftBlocks();
      render();
    }
  }

  /** 고정된 출석부에서 반 설정을 고치면 제목·교실 줄을 다시 만들고 「바뀜」 표시 */
  function editBlockChanged(b) {
    var A = S.att;
    b.title = Roster.makeTitle(S.date, b); b.line = Roster.makeLine(b);
    A.changed[b.key] = true;
    if (!A.dirty) { A.dirty = true; var bt = document.querySelector('[data-x=att-save2]'); if (bt) { bt.disabled = false; bt.textContent = '저장'; } }
  }

  function updatePreview(i) {
    var b = S.att.blocks[i], pv = document.getElementById('pv-' + i);
    if (pv) pv.textContent = Roster.makeTitle(S.date, b) + ' / ' + Roster.makeLine(b);
    // 입력할 때마다 반 설정 검사 문구도 바로 고칩니다
    var ck = blockChecks();
    S.att.blocks.forEach(function (_, k) {
      var box = document.getElementById('ck-' + k);
      if (box) box.innerHTML = checkMsgs(ck.errors.filter(function (e) { return e.i === k; }), ck.warns.filter(function (e) { return e.i === k; }));
    });
  }

  function extraInput(el) {
    var x = el.getAttribute('data-xi'), A = S.att;
    if (x === 'att-b') {
      var i = +el.getAttribute('data-i'), b = A.blocks[i], f2 = el.getAttribute('data-f');
      b[f2] = el.value;
      if (f2 === 'tag') b.tagEdited = true;
      if (f2 === 'name' && !b.tagEdited) {
        b.tag = Roster.autoTag(b.name);
        var card = el.closest('section');
        var ti = card && card.querySelector('[data-f=tag]');
        if (ti) ti.value = b.tag;
      }
      updatePreview(i);
      if (A.mode === 'edit') editBlockChanged(b);
      else saveDraftBlocks();
    } else if (x === 'att-e2') {
      var e2b = A.data.blocks[+el.getAttribute('data-i')], e2s = e2b.students[+el.getAttribute('data-j')], ef = el.getAttribute('data-f');
      e2s[ef] = el.value;
      el.classList.toggle('warn', ef === 'ban' ? !/^\d-\d+$/.test(el.value) : !Roster.officialSchool(el.value, S.data.schools || []).ok);
      A.changed[e2b.key] = true;
      if (!A.dirty) { A.dirty = true; var bt2 = document.querySelector('[data-x=att-save2]'); if (bt2) { bt2.disabled = false; bt2.textContent = '저장'; } }
    }
  }

  /* ───────── 이벤트 ───────── */

  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-view],[data-act],[data-done],[data-ok],[data-undo],[data-expand],[data-sort],[data-fq],[data-go],[data-keepabs],[data-x]');
    if (!t) return;
    if (t.hasAttribute('data-x')) return extraClick(t, e);
    if (t.hasAttribute('data-keepabs')) return toggleAbsence(t.getAttribute('data-keepabs'));
    if (t.hasAttribute('data-view')) { S.view = t.getAttribute('data-view'); render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-sort')) {
      var col = t.getAttribute('data-sort');
      if (S.sort.col !== col) S.sort = { col: col, dir: 1 };
      else if (S.sort.dir === 1) S.sort.dir = -1;
      else S.sort = { col: null, dir: 0 };
      saveView(); refreshFull(); return;
    }
    if (t.hasAttribute('data-fq')) {
      var fq = t.getAttribute('data-fq').split(':');
      if (fq[0] === 'isNew') S.f.isNew = !S.f.isNew;
      else { var arr = S.f[fq[0]], k = arr.indexOf(fq[1]); if (k >= 0) arr.splice(k, 1); else arr.push(fq[1]); }
      saveView(); refreshFull(); return;
    }
    if (t.hasAttribute('data-go')) {
      var kind = t.getAttribute('data-go');
      S.f = { result: [], state: kind === 'wait' ? ['대기'] : [], isNew: kind === 'new', cls: t.getAttribute('data-cls') };
      S.sort = { col: null, dir: 0 }; S.query = '';
      S.view = 'full'; render(); window.scrollTo(0, 0); return;
    }
    // 메모는 누른 버튼과 같은 줄(또는 카드)의 입력칸에서 읽습니다 (PC 표와 휴대폰 카드가 함께 있으므로)
    var memoOf = function () { var box = t.closest('tr, .mcard, .row'); var m = box && box.querySelector('.memo'); return m ? m.value : ''; };
    if (t.hasAttribute('data-done')) return setStatus(t.getAttribute('data-done'), 'done', memoOf());
    if (t.hasAttribute('data-ok')) return setStatus(t.getAttribute('data-ok'), 'ok', memoOf());
    if (t.hasAttribute('data-undo')) return setStatus(t.getAttribute('data-undo'), null);
    if (t.hasAttribute('data-expand')) { var no = t.getAttribute('data-expand'); S.open = S.open === no ? null : no; render(); return; }
    var act = t.getAttribute('data-act');
    if (act === 'upload') uploadFromFolder();
    else if (act === 'folder') changeFolder();
    else if (act === 'guide') showGuide();
    else if (act === 'cms') openCms();
    else if (act === 'refresh') { var rt = Date.now(); S.settings = null; checkVersion(); load(S.date).then(function () { if (!(S.toastAt >= rt)) toast('최신 내용으로 새로고침했습니다.', 2000); }); }
    else if (act === 'update') { location.replace(location.pathname + '?v=' + Date.now()); }
    else if (act === 'close-result') { S.lastUpload = null; render(); }
    else if (act === 'links') showLinks();
    else if (act === 'raw-export') rawExport();
    else if (act === 'clear-filter') { S.f = { result: [], state: [], isNew: false, cls: '' }; S.sort = { col: null, dir: 0 }; saveView(); refreshFull(); }
    else if (act === 'reload-settings') { S.settings = null; render(); }
    else if (act === 'neis') {
      setBusy(true);
      api('neis').then(function (r) { toast('학교 ' + r.count + '곳을 가져왔습니다.'); S.settings = null; render(); })
        .catch(function (er) { toast(er.message); }).then(function () { setBusy(false); });
    }
  });

  root.addEventListener('change', function (e) {
    if (e.target.classList.contains('round-sel')) {
      if (S.att && S.att.mode === 'edit' && S.att.dirty && !confirm('출석부에 저장하지 않은 변경이 있습니다. 회차를 바꾸면 사라집니다. 바꿀까요?')) { e.target.value = S.date; return; }
      S.lastUpload = null; load(e.target.value);
    }
    else if (e.target.getAttribute('data-act') === 'cols') { S.showAll = e.target.checked; render(); }
    else if (e.target.id === 'fcls') { S.f.cls = e.target.value; refreshFull(); }
    else if (e.target.id === 'pick') { uploadFromFiles(e.target.files); e.target.value = ''; }
    else if (e.target.hasAttribute('data-sel')) {
      var sn = e.target.getAttribute('data-sel');
      if (e.target.checked) S.sel[sn] = true; else delete S.sel[sn];
      var sb = document.getElementById('selbar'); if (sb) sb.innerHTML = selBar();
    } else if (e.target.hasAttribute('data-sf')) { setCapture(e.target.getAttribute('data-sf')); markDirty(e.target.getAttribute('data-sf')); }
    else if (e.target.hasAttribute('data-xc')) extraChange(e.target);
  });

  root.addEventListener('input', function (e) {
    if (e.target.hasAttribute('data-sf')) { setCapture(e.target.getAttribute('data-sf')); markDirty(e.target.getAttribute('data-sf')); return; }
    if (e.target.id === 'q' && !e.isComposing) applySearch(e.target.value);
    else if (e.target.hasAttribute('data-xi')) extraInput(e.target);
  });
  root.addEventListener('compositionend', function (e) {
    if (e.target.id === 'q') applySearch(e.target.value);
  });

  root.addEventListener('dragover', function (e) { var d = e.target.closest('#drop'); if (d) { e.preventDefault(); d.classList.add('over'); } });
  root.addEventListener('dragleave', function (e) { var d = e.target.closest('#drop'); if (d) d.classList.remove('over'); });
  root.addEventListener('drop', function (e) {
    var d = e.target.closest('#drop');
    if (!d) return;
    e.preventDefault();
    uploadFromFiles(e.dataTransfer.files);
  });

  boot();
})();
