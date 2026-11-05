/* 주말 신청 점검 — 웹 화면 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var H = Core.HEADER;
  var POLL_MS = 20000;
  // 화면 코드 버전. docs/version.txt 와 같게 맞춥니다 (다르면 '새 버전' 안내)
  var APP_VERSION = '9';
  var S = {
    token: null, user: null, data: null, date: null, rev: null, view: 'home',
    showAll: false, open: null, query: '', busy: false, lastUpload: null, settings: null, loadedAt: null, newVersion: false,
    f: { result: [], state: [], isNew: false, cls: '' }, sort: { col: null, dir: 0 }
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
    t.textContent = msg; t.className = 'show';
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
    root.innerHTML = '<div class="card login"><div class="brand">주말 신청 점검</div>' +
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

  function start() {
    var p = jwtPayload(S.token) || {};
    S.user = { email: p.email, name: p.name };
    root.innerHTML = '<div class="center-msg">명단을 불러오는 중…</div>';
    load(null).then(function () {
      try { if (!localStorage.getItem('guide-v1')) { showGuide(); localStorage.setItem('guide-v1', '1'); } } catch (e) { /* 무시 */ }
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
      S.data = res; S.date = res.date; S.rev = res.rev; S.user = res.user || S.user;
      S.loadedAt = new Date();
      render();
    }).catch(function (e) { if (e.code !== 'AUTH' && e.code !== 'FORBIDDEN') toast(e.message); })
      .then(function () { setBusy(false); });
  }

  function poll() {
    if (S.busy || !S.token || document.visibilityState !== 'visible' || document.querySelector('.modal-bg')) return;
    // 메모를 쓰는 중이면 화면을 다시 그리지 않습니다
    var typing = Array.prototype.some.call(document.querySelectorAll('input.memo'), function (m) { return m.value || m === document.activeElement; });
    if (typing || (document.activeElement && document.activeElement.id === 'q')) return;
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

  async function uploadFromFiles(fileList) {
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
      await sendFiles(picked, stat);
    } catch (e) { toast(e.message); }
    setBusy(false);
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

  async function sendFiles(files, stat) {
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
    var res = await api('upload', { date: S.date, files: send });
    summary.results = res.results;
    S.lastUpload = summary;
    if (res.needMap && res.needMap.length) {
      var maps = await askMapping(res.needMap);
      if (maps) {
        var again = send.filter(function (f) { return res.needMap.some(function (n) { return n.file === f.fileName; }); });
        var res2 = await api('upload', { date: S.date, files: again, mappings: maps });
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

  function setStatus(no, status, memo) {
    if (S.busy) return;
    var r = rowByNo(no);
    if (!r) return;
    memo = memo || '';
    setBusy(true);
    api('status', { date: S.date, no: no, status: status, memo: memo, prevAt: r.status ? r.status.at : '' })
      .then(function (res) { if (res.conflict) toast(res.message); else S.open = null; })
      .catch(function (e) { toast(e.message); })
      .then(function () { setBusy(false); return load(S.date); });
  }

  /* ───────── 화면 ───────── */

  var VIEWS = [['home', '홈'], ['review', '점검 목록'], ['full', '전체 명단'], ['uploads', '업로드 기록'], ['settings', '설정']];

  function render() {
    if (!S.data) return;
    var counts = { red: openRows('red').length, amber: openRows('amber').length };
    var html = '<header class="top"><div class="wrap"><span class="brand">주말 신청 점검</span><nav class="menu" aria-label="메뉴">' +
      VIEWS.map(function (v) {
        var n = v[0] === 'review' && (counts.red + counts.amber) ? ' (' + (counts.red + counts.amber) + ')' : '';
        return '<button data-view="' + v[0] + '" class="' + (S.view === v[0] ? 'on' : '') + '">' + v[1] + n + '</button>';
      }).join('') + '</nav><div class="top-right"><span class="muted small">' + (S.loadedAt ? S.loadedAt.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' 기준' : '') + '</span>' +
      '<button class="btn sm" data-act="refresh" title="서버에서 최신 명단·처리 상태·설정을 다시 불러옵니다">새로고침</button><button class="btn sm" data-act="guide">? 도움말</button>' +
      '<a href="' + esc(S.data.sheetUrl) + '" target="_blank" rel="noopener">구글 시트</a><span class="chip">' + esc((S.data.user && S.data.user.name) || '') + ' 선생님</span></div></div><div id="busy" class="' + (S.busy ? 'busy-bar' : '') + '"></div></header>';
    if (S.newVersion) html += '<div class="wrap"><div class="card pad row between" style="margin-top:12px;border-color:#BFD0F5;background:#F0F5FF"><span>웹앱 새 버전이 나왔습니다.</span><button class="btn sm primary" data-act="update">지금 적용</button></div></div>';
    html += '<main class="wrap">';
    if (!S.date) html += '<div class="card pad">설정_수업일 탭에 수업일이 없습니다. 구글 시트에서 수업일을 먼저 입력해 주세요.</div>';
    else if (S.view === 'home') html += viewHome(counts);
    else if (S.view === 'review') html += viewReview();
    else if (S.view === 'full') html += viewFull();
    else if (S.view === 'uploads') html += viewUploads();
    else if (S.view === 'settings') html += viewSettings();
    html += '</main><input type="file" id="pick" accept=".xls" multiple hidden>';
    var y = window.scrollY;
    root.innerHTML = html;
    window.scrollTo(0, y);
  }

  function roundSelect() {
    return '<select id="round" aria-label="수업 회차" style="font-weight:700;font-size:16px">' + S.data.dates.map(function (d) {
      return '<option value="' + esc(d.date) + '"' + (d.date === S.date ? ' selected' : '') + '>' + esc(d.n) + '회차 · ' + esc(Core.shortDate(d.date)) + (d.note ? ' · ' + esc(d.note) : '') + '</option>';
    }).join('') + '</select>';
  }

  function viewHome(counts) {
    var from = Core.addDays(S.date, -Core.WINDOW_DAYS);
    var uploadedAny = S.data.classes.some(function (c) { return c.lastAt; });
    var html = '<section class="card pad row between"><div style="display:flex;flex-direction:column;gap:6px">' +
      '<div class="row">' + roundSelect() + tip('점검할 수업일입니다. 오늘 날짜에 맞춰 자동으로 골라지고, 다른 회차로 바꿀 수 있습니다.') + '</div>' +
      '<span class="muted small">접수 기간 ' + Core.shortDate(from) + ' ~ ' + Core.shortDate(S.date) + ' · 이 기간에 받은 파일만 올라갑니다</span></div>' +
      '<div class="row"><button class="btn" data-act="folder">폴더 변경</button>' + tip('통합예약 엑셀이 저장되는 폴더를 지정합니다. 크롬은 다운로드 폴더 자체는 열지 못하게 막으므로, 다운로드 폴더 안에 「주말명단」 같은 하위 폴더를 만들어 지정하세요. 계정과 PC마다 한 번만 지정하면 기억합니다.') +
      '<button class="btn primary" data-act="upload">명단 올리기</button>' + tip('지정한 폴더에서 이번 접수 기간에 받은 「통합예약신청자목록」 파일 중 아직 안 올린 것만 골라 올립니다. 같은 반 파일이 여러 개면 가장 최근 파일만 반영합니다.') + '</div>' +
      '<div class="drop" id="drop" style="flex-basis:100%">' + (window.showDirectoryPicker ? '크롬·엣지가 아니라면 여기에 엑셀 파일을 끌어다 놓으세요' : '이 기기에서는 폴더 지정이 안 되어 [명단 올리기]를 누르면 파일을 직접 고릅니다 (명단 올리기는 PC를 권장합니다)') + '</div></section>';

    if (S.lastUpload) html += uploadResult(S.lastUpload);

    var steps = [
      ['회차 확인', '수업일 ' + Core.shortDate(S.date), true],
      ['통합예약 엑셀 다운로드', '반별 신청명단 내려받기', uploadedAny],
      ['명단 올리기', uploadedAny ? '올린 반 ' + S.data.classes.filter(function (c) { return c.lastAt; }).length + '개' : '아직 없음', uploadedAny],
      ['취소 대상 처리', counts.red + '건 남음', uploadedAny && counts.red === 0],
      ['확인 필요 처리', counts.amber + '건 남음', uploadedAny && counts.amber === 0],
      ['점검 끝', '', uploadedAny && counts.red + counts.amber === 0]
    ];
    var nowIdx = steps.findIndex(function (s) { return !s[2]; });
    html += '<section class="steps" aria-label="작업 순서">' + steps.map(function (s, i) {
      var go = i === 2 ? 'data-act="upload"' : (i === 3 || i === 4 ? 'data-view="review"' : '');
      return '<button class="step ' + (s[2] ? 'done' : '') + (i === nowIdx ? ' now' : '') + '" ' + go + '><b>' + (i + 1) + '. ' + s[0] + '</b><span>' + esc(s[1]) + '</span></button>';
    }).join('') + '</section>';

    var done = doneRows().length;
    html += '<section class="tiles"><div class="card tile"><span class="muted small">취소 대상 · 미처리 ' + tip('중복 신청, 단체 신청, 대상 학년, 관외 학교, 신청 제한 학생. 연락 후 취소 처리할 대상입니다.') + '</span><strong style="color:var(--red)">' + counts.red + '건</strong></div>' +
      '<div class="card tile"><span class="muted small">확인 필요 · 미처리 ' + tip('입력 내용 오류, 학부모 연락처 필요. 연락해서 수정을 요청할 대상입니다.') + '</span><strong style="color:var(--amber)">' + counts.amber + '건</strong></div>' +
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

  function dataCells(r, cols, hl) {
    return cols.map(function (i) {
      var v = r.cells[i];
      var title = '';
      if (i === 1) { title = v; v = r.cls; }
      var cls = hl && hl[i] ? ' class="' + hl[i] + '"' : '';
      return '<td' + cls + ' title="' + esc(title || r.cells[i]) + '">' + esc(v) + '</td>';
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

  function viewReview() {
    var cols = visibleCols();
    var head = cols.map(function (i) { return '<th>' + (i === 1 ? '반' : esc(H[i])) + '</th>'; }).join('') + '<th class="chk">사유</th><th>자세한 내용</th><th>처리</th>';
    var sections = [
      ['red', '취소 대상 · 미처리', '중복 · 단체 · 대상 학년 · 관외 · 신청 제한 — 먼저 처리', openRows('red')],
      ['amber', '확인 필요 · 미처리', '입력 내용 오류 · 학부모 연락처 필요 — 연락 후 수정 요청', openRows('amber')],
      ['done', '처리 완료 · 문제없음', '최근 처리한 것이 위 · 잘못 누른 것은 되돌리기', doneRows()]
    ];
    var html = '<section class="card pad row between"><div class="row">' + roundSelect() + colsToolbar() + '</div>' +
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
    var colgroup = '<colgroup>' + cols.map(function (i) { return '<col style="width:' + WIDTH[i] + 'px">'; }).join('') + '<col style="width:210px"><col style="width:110px"></colgroup>';
    var total = cols.reduce(function (a, i) { return a + WIDTH[i]; }, 0) + 320;
    var mark = function (k) { return S.sort.col === k ? (S.sort.dir > 0 ? ' ▲' : ' ▼') : ''; };
    var head = cols.map(function (i) { return '<th><button class="sorth" data-sort="' + i + '" title="눌러서 정렬 (오름차순 → 내림차순 → 원래 순서)">' + esc(H[i]) + mark(String(i)) + '</button></th>'; }).join('') +
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
        body += '<tr class="group"><td colspan="' + (cols.length + 2) + '">' + t + ' · ' + esc(c['접수명']) + ' <span class="muted small" style="font-weight:400">신청 ' + live.length + ' / 정원 ' + esc(c.cap) + (stat ? ' · ' + esc(stat) : '') +
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
          body += '<tr class="' + trc + '">' + dataCells(r, cols, hl) + '<td class="chk" title="' + esc(r.issues.map(function (i) { return i.detail; }).join(' / ')) + '">' + resultHtml + '</td><td>' + act + '</td></tr>';
          if (active && S.open === r.no) {
            body += '<tr class="expand"><td colspan="' + (cols.length + 2) + '"><div class="row">' + issueBadges(r) + '<span>' + issueDetail(r) + '</span>' + actionCell(r) + '</div></td></tr>';
          }
        });
      });
    });
    if (!shownTotal && (q || filterOn())) body += '<tr><td colspan="' + (cols.length + 2) + '" class="muted" style="padding:16px">조건에 맞는 신청이 없습니다.</td></tr>';
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
    return '<section class="card pad row between"><div class="row">' + roundSelect() +
      '<input type="search" id="q" value="' + esc(S.query) + '" placeholder="학생명 · 신청자명 · 연락처" aria-label="검색" style="width:220px">' + colsToolbar() + '</div>' +
      '<div class="row small muted"><span class="badge" style="background:var(--red-bg);color:var(--red)">취소 대상</span><span class="badge" style="background:var(--amber-bg);color:var(--amber)">확인 필요</span><span class="badge" style="background:var(--red-cell);color:#fff">문제 칸</span>' + tip('열 제목을 누르면 반 안에서 정렬됩니다 (오름차순 → 내림차순 → 원래 엑셀 순서). 학교명은 앞 두 글자, 학반은 학년 숫자 기준입니다. 아래 버튼으로 원하는 신청만 골라 볼 수 있고, 같은 줄의 버튼은 하나라도 맞으면 보입니다.') + '</div>' +
      '<div id="fbar" style="flex-basis:100%">' + filterBar() + '</div></section>' +
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
  }

  function viewUploads() {
    var list = S.data.uploads || [];
    return '<section class="card pad row">' + roundSelect() + '<span class="muted small">이 회차와 접수 기간에 올린 기록</span></section><section class="card" style="overflow:hidden"><div class="tbox"><table class="grid"><thead><tr><th>올린 시각</th><th>올린 사람</th><th>접수명</th><th>인원</th><th>파일</th><th>파일 받은 시각</th></tr></thead><tbody>' +
      (list.length ? list.map(function (u) {
        return '<tr><td>' + esc(u.at) + '</td><td>' + esc(u.by) + '</td><td>' + esc(u.name) + '</td><td>' + esc(u.count) + '</td><td>' + esc(u.file) + '</td><td>' + esc(u.fileTs.replace('T', ' ').slice(0, 16)) + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="muted">기록이 없습니다.</td></tr>') + '</tbody></table></div></section>';
  }

  function viewSettings() {
    var s = S.settings;
    if (!s) { loadSettings(); return '<div class="card pad muted">설정을 불러오는 중…</div>'; }
    function table(head, rows) {
      return '<div class="tbox"><table class="grid"><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
        (rows.length ? rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') : '<tr><td colspan="' + head.length + '" class="muted">없음</td></tr>') + '</tbody></table></div>';
    }
    return '<section class="card pad row between"><div><b>설정은 구글 시트의 「설정_」 탭과 「신청제한」 탭에서 고칩니다</b><div class="muted small">고친 뒤 이 화면을 새로고침하면 바로 적용됩니다. 단계별 설정 화면은 다음 버전에서 제공합니다.</div></div>' +
      '<div class="row"><a class="btn" href="' + esc(s.sheetUrl) + '" target="_blank" rel="noopener">구글 시트 열기</a><button class="btn" data-act="reload-settings">새로고침</button></div></section>' +
      '<section class="card pad"><h2>수업일</h2>' + table(['회차', '수업일', '비고'], s.dates.map(function (d) { return [d.n, d.date, d.note]; })) + '</section>' +
      '<section class="card pad"><h2>반 (접수 단위)</h2>' + table(['시간대', '수업반', '접수명', '예약명 키워드', '대상', '정원', '운영 회차'], s.classes.map(function (c) { return [c['시간대'], c['수업반'], c['접수명'], c.keyword, c.rangeText, c.cap, (c.from || 1) + '~' + (c.to || '끝')]; })) + '</section>' +
      '<section class="card pad"><h2>신청제한 명단 ' + tip('결석 수업일·학생명·학교를 적으면 다음 수업일(제한 수업일)에 신청한 경우 「신청 제한 학생」으로 표시합니다. 학교는 앞 두 글자로 비교합니다.') + '</h2>' + table(['결석 수업일', '학생명', '학교', '사유', '제한 수업일', '메모'], s.restrictions.map(function (r) { return [r.absent, r.name, r.school, r.reason, r.date, r.memo]; })) + '</section>' +
      '<section class="card pad"><h2>예약명 연결</h2>' + table(['예약명(날짜 제외)', '접수명', '등록자', '등록시각'], s.mappings) + '</section>' +
      '<section class="card pad row between"><div><h2>학교 목록</h2><span class="muted small">' + s.schoolCount + '곳 등록 · 점검자 ' + esc(s.users.join(', ')) + '</span></div>' +
      (s.hasNeisKey ? '<button class="btn" data-act="neis">NEIS에서 학교 목록 새로 가져오기</button>' : '<span class="muted small">NEIS 인증키를 스크립트 속성에 넣으면 자동으로 가져올 수 있습니다</span>') + '</section>';
  }

  function loadSettings() {
    api('settings').then(function (res) { S.settings = res; if (S.view === 'settings') render(); }).catch(function (e) { toast(e.message); });
  }

  function showGuide() {
    var wrap = document.createElement('div');
    wrap.innerHTML = '<div class="modal-bg"><div class="modal" role="dialog" aria-labelledby="gt"><h2 id="gt" style="margin:0">처음 사용 안내</h2>' +
      '<ol style="margin:0;padding-left:20px;line-height:1.9">' +
      '<li><b>회차 확인</b> — 홈 위쪽에서 점검할 수업일을 확인합니다. 보통 자동으로 맞춰집니다.</li>' +
      '<li><b>통합예약 엑셀 다운로드</b> — 통합예약시스템에서 반별 신청명단을 내려받습니다. 파일 이름은 바꾸지 마세요.</li>' +
      '<li><b>명단 올리기</b> — 버튼 한 번이면 다운로드 폴더에서 새 명단만 골라 올립니다. 처음 한 번은 다운로드 폴더 안의 「주말명단」 같은 하위 폴더를 지정하고(다운로드 폴더 자체는 크롬이 막습니다) 「방문할 때마다 허용」을 고르세요. 크롬 설정의 다운로드 위치도 그 폴더로 바꿔 두면 편합니다. <b>파일 수정 허용 창은 절대 허용하지 마세요.</b></li>' +
      '<li><b>취소 대상 처리</b> — 점검 목록 빨간 구역부터 연락·취소하고 「완료」를 누릅니다.</li>' +
      '<li><b>확인 필요 처리</b> — 노란 구역을 연락·확인하고 「완료」 또는 「문제없음」을 누릅니다.</li>' +
      '<li><b>전체 명단</b>에서 반별 전체 신청자를 원본 엑셀 순서로 볼 수 있습니다.</li></ol>' +
      '<p class="muted small" style="margin:0">다른 선생님이 처리한 내용은 20초 안에 자동으로 반영됩니다. ? 표시에 마우스를 올리면 설명이 나옵니다.</p>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn primary" data-g="close">확인</button></div></div></div>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) { if (e.target.closest('[data-g]')) wrap.remove(); });
  }

  /* ───────── 이벤트 ───────── */

  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-view],[data-act],[data-done],[data-ok],[data-undo],[data-expand],[data-sort],[data-fq],[data-go]');
    if (!t) return;
    if (t.hasAttribute('data-view')) { S.view = t.getAttribute('data-view'); if (S.view === 'settings') S.settings = null; render(); window.scrollTo(0, 0); return; }
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
    else if (act === 'refresh') { S.settings = null; checkVersion(); load(S.date).then(function () { toast('최신 내용으로 새로고침했습니다.', 2000); }); }
    else if (act === 'update') { location.replace(location.pathname + '?v=' + Date.now()); }
    else if (act === 'close-result') { S.lastUpload = null; render(); }
    else if (act === 'clear-filter') { S.f = { result: [], state: [], isNew: false, cls: '' }; S.sort = { col: null, dir: 0 }; saveView(); refreshFull(); }
    else if (act === 'reload-settings') { S.settings = null; render(); }
    else if (act === 'neis') {
      setBusy(true);
      api('neis').then(function (r) { toast('학교 ' + r.count + '곳을 가져왔습니다.'); S.settings = null; render(); })
        .catch(function (er) { toast(er.message); }).then(function () { setBusy(false); });
    }
  });

  root.addEventListener('change', function (e) {
    if (e.target.id === 'round') { S.lastUpload = null; load(e.target.value); }
    else if (e.target.getAttribute('data-act') === 'cols') { S.showAll = e.target.checked; render(); }
    else if (e.target.id === 'fcls') { S.f.cls = e.target.value; refreshFull(); }
    else if (e.target.id === 'pick') { uploadFromFiles(e.target.files); e.target.value = ''; }
  });

  root.addEventListener('input', function (e) {
    if (e.target.id === 'q' && !e.isComposing) applySearch(e.target.value);
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
