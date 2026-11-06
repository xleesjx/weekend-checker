/* 주말 신청 점검 — 웹 화면 */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var H = Core.HEADER;
  var POLL_MS = 20000;
  // 화면 코드 버전. docs/version.txt 와 같게 맞춥니다 (다르면 '새 버전' 안내)
  var APP_VERSION = '11';
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
      if (S.date !== res.date) { S.att = null; S.sel = {}; }
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

  var VIEWS = [['home', '홈'], ['review', '점검 목록'], ['full', '전체 명단'], ['att', '출석부'], ['abs', '결석'], ['uploads', '업로드 기록'], ['settings', '설정']];

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
    else if (S.view === 'att') html += viewAtt();
    else if (S.view === 'abs') html += viewAbs();
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

  function dataCells(r, cols, hl, extra) {
    return cols.map(function (i) {
      var v = r.cells[i];
      var title = '';
      if (i === 1) { title = v; v = r.cls; }
      var cls = hl && hl[i] ? ' class="' + hl[i] + '"' : '';
      return '<td' + cls + ' title="' + esc(title || r.cells[i]) + '">' + esc(v) + (extra && extra[i] ? ' ' + extra[i] : '') + '</td>';
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
    return '<section class="card pad row between"><div class="row">' + roundSelect() +
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
  function mmdd(date) { return date.slice(5, 7) + date.slice(8, 10); }
  function md(date) { return (+date.slice(5, 7)) + '월 ' + (+date.slice(8, 10)) + '일'; }

  /* ───────── 같은 반 요청 ───────── */

  /** 이번 회차에 해당하는 묶음: 이번 회차 요청 + 다른 회차의 '계속' 요청 중 이번에도 2명 이상 있는 것 */
  function dateLinks() {
    var rows = S.data.rows || [];
    var has = function (m) { return rows.some(function (r) { return Core.str(r.cells[9]) === m.name && Core.schoolKey(r.cells[10]) === Core.schoolKey(m.school); }); };
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
          if ((x.applied && m.no && r.no === m.no) || (Core.str(r.cells[9]) === m.name && Core.schoolKey(r.cells[10]) === Core.schoolKey(m.school))) out[r.no] = letter;
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
        .then(function () { close(); S.sel = {}; toast('같은 반 요청을 저장했습니다.'); return load(S.date); })
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
        api('linkRemove', { id: b.getAttribute('data-id') }).then(function () { close(); toast('해제했습니다.'); return load(S.date); }).catch(function (er) { toast(er.message); });
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

  function saveAbs(rec) {
    setBusy(true);
    return api('absSave', { rec: rec }).then(function (r) { return load(S.date).then(function () { return r; }); })
      .catch(function (er) { toast(er.message); }).then(function (r) { setBusy(false); return r; });
  }

  function absOf(no) { return (S.data.absences || []).filter(function (a) { return a.no === no; })[0]; }

  /** 전체 명단의 [결석] 버튼: 표시하면 결석 기록에 넣고, 다시 누르면 해제합니다 */
  function toggleAbsence(no) {
    var r = rowByNo(no);
    if (!r) return;
    var a = absOf(no);
    if (a) {
      if (!confirm(r.cells[9] + ' 학생의 결석 표시를 해제할까요? 사유와 메모도 함께 지워집니다.')) return;
      setBusy(true);
      api('absDelete', { id: a.id }).then(function () { return load(S.date); }).catch(function (er) { toast(er.message); }).then(function () { setBusy(false); });
      return;
    }
    saveAbs({ date: S.date, no: r.no, name: r.cells[9], school: r.cells[10], ban: r.cells[11], cls: r.cls, phone: r.cells[3],
      src: r.cancelled ? '예약취소' : '당일 결석', reason: r.cancelled ? '기한 후 취소' : '당일 무단결석' })
      .then(function () { toast(r.cells[9] + ' 학생을 결석으로 표시했습니다. 사유는 결석 메뉴에서 고칠 수 있습니다.', 3000); });
  }

  function viewAbs() {
    var recs = S.data.absences || [];
    var limited = recs.filter(function (a) { return !a.excused; }).length;
    var next = Core.nextClassDate(S.data.dates || [], S.date);
    var html = '<section class="card pad row between"><div class="row">' + roundSelect() + '</div><span class="muted small">결석·취소 ' + recs.length + '건 · 다음 수업일' + (next ? '(' + Core.shortDate(next) + ')' : '') + ' 신청 제한 <b>' + limited + '</b>명 · 출석 인정 ' + (recs.length - limited) + '명</span></section>' +
      '<section class="card pad small" style="line-height:1.9;background:#F8FAFF;border-color:#BFD0F5"><b style="font-size:15px">결석자 처리 방법</b><br>' +
      '① <b>전체 명단</b>에서 빠른 필터 <b>예약취소</b>를 누르고, 기한 후 취소한 학생 줄의 <b>[결석]</b>을 누릅니다.<br>' +
      '② 수업 당일 결석한 학생도 <b>전체 명단</b>에서 그 학생 줄의 <b>[결석]</b>을 누릅니다. (출석부에서 [취소 처리]한 학생은 자동으로 들어옵니다)<br>' +
      '③ 여기서 <b>사유</b>를 고르고 연락한 내용을 <b>메모</b>합니다. 질병·대회 등으로 봐 줄 경우 <b>출석 인정</b>에 체크하면 다음 회차 신청 제한이 풀립니다.<br>' +
      '<span class="muted">출석 인정이 아닌 학생은 다음 수업일 점검에서 「신청 제한 학생」으로 표시됩니다.</span></section>';
    html += '<section class="card" style="overflow:hidden">' + (recs.length ? recs.map(function (a) {
      return '<div class="abs-card' + (a.excused ? ' ex' : '') + '"><div class="row"><b style="font-size:16px">' + esc(a.name) + '</b><span>' + esc(a.school) + ' · ' + esc(a.ban) + ' · ' + esc(a.cls) + '</span>' +
        '<span class="badge done">' + esc(a.src || '당일 결석') + '</span>' + (a.phone ? '<a href="tel:' + esc(String(a.phone).replace(/[^0-9]/g, '')) + '" style="margin-left:auto">' + esc(a.phone) + '</a>' : '') + '</div>' +
        '<div class="row" style="gap:6px">' + REASONS.map(function (rs) { return '<button class="chipbtn' + (a.reason === rs ? ' on' : '') + '" data-x="abs-reason" data-id="' + esc(a.id) + '" data-v="' + esc(rs) + '">' + esc(rs) + '</button>'; }).join('') + '</div>' +
        '<div class="row small"><label class="row" style="gap:6px">취소 시각 <input type="text" value="' + esc(a.cancelAt) + '" placeholder="예: 11/6 18:20" data-xc="abs-field" data-id="' + esc(a.id) + '" data-f="cancelAt" style="width:140px"></label>' +
        '<label class="row" style="gap:6px;margin-left:auto;font-weight:700;min-height:36px"><input type="checkbox" data-xc="abs-ex" data-id="' + esc(a.id) + '"' + (a.excused ? ' checked' : '') + ' style="width:18px;height:18px">출석 인정 (신청 제한 안 함)</label></div>' +
        '<div class="row"><input type="text" value="' + esc(a.memo) + '" placeholder="메모 (예: 오후 2시 통화, 독감)" data-xc="abs-field" data-id="' + esc(a.id) + '" data-f="memo" style="flex:1"><button class="btn sm" data-x="abs-del" data-id="' + esc(a.id) + '">기록 삭제</button></div>' +
        '<span class="muted small">' + esc(a.by) + ' · ' + esc(String(a.at).slice(5, 16)) + '</span></div>';
    }).join('') : '<div class="pad muted">이 수업일의 결석·취소 기록이 없습니다.</div>') + '</section>';
    return html;
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
    A.sets = Roster.linkSets(S.data.links, attStudents(), S.date, A.acceptKeep);
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

  function makeBlocks() {
    var A = S.att;
    var prev = (S.data.attPrev && S.data.attPrev.blocks) || [];
    var seq = {};
    A.blocks = A.sources.map(function (src) {
      var time = groupTime(src.group);
      seq[time] = (seq[time] || 0) + 1;
      var d = Roster.defaultBlock(src.group, src.part, src.parts, time, seq[time]);
      var p = prev.filter(function (b) { return b.key === src.key; })[0];
      var b = { key: src.key, src: src.key, group: src.group, time: time, label: src.label, tool1: '', tool2: '' };
      if (p) {
        var pt = p.program ? p : (Roster.parseTitle(p.title) || {});
        b.program = pt.program || d.program; b.name = pt.name || d.name;
        b.same = p.same !== undefined ? !!p.same : d.same;
        b.room1 = p.room1 || ''; b.room2 = p.room2 || '';
        b.tagEdited = !!p.tagEdited; b.tag = b.tagEdited ? p.tag : Roster.autoTag(b.name);
      } else {
        Object.assign(b, d);
        b.tag = Roster.autoTag(b.name); b.tagEdited = false;
      }
      return b;
    });
  }

  function buildDraft() {
    var old = S.att || {};
    S.att = { mode: 'draft', date: S.date, step: 1, acceptKeep: old.acceptKeep || {}, edits: old.edits || {} };
    computeParts();
    makeBlocks();
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

  var STEPS = ['최신 명단 확인', '반 설정', '분반·학교명 정리', '확인·내려받기'];

  function stepsBar(n, saved) {
    return '<section class="card pad row" style="gap:10px 22px">' + STEPS.map(function (t, i) {
      var k = i + 1, on = !saved && k === n, done = saved || k < n;
      var chip = '<span class="badge" style="background:' + (on ? 'var(--blue);color:#fff' : (done ? '#C7D7FB;color:#1E3A8A' : '#E2E8F0;color:#334155')) + '">' + k + '</span>' + (on ? '<b>' + t + '</b>' : t);
      return !saved && k < n ? '<button class="row small sorth" style="gap:6px" data-x="att-step" data-n="' + k + '">' + chip + '</button>' : '<span class="row small" style="gap:6px">' + chip + '</span>';
    }).join('') + (saved ? '<b class="small" style="color:#15803D">✔ 확정됨</b>' : '') + '</section>';
  }

  function navBar(prev, nextLabel, nextAct) {
    return '<div class="row" style="justify-content:space-between;margin-top:4px">' + (prev ? '<button class="btn" data-x="att-prev">← 이전</button>' : '<span></span>') +
      (nextLabel ? '<button class="btn primary" data-x="' + (nextAct || 'att-next') + '">' + nextLabel + '</button>' : '') + '</div>';
  }

  function roomSelect(i, f, v) {
    return '<select data-xc="att-b" data-i="' + i + '" data-f="' + f + '" aria-label="교실"><option value="">교실 선택</option>' +
      Roster.ROOMS.map(function (r) { return '<option' + (r === v ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select>';
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

  function sheetBlock(b, i, letters) {
    var src = srcByKey(b.src);
    var list = src ? src.students : [];
    var over = list.length > Roster.CAP;
    var html = '<section class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="row between"><b>' + esc(b.label) + '</b><span style="font-weight:700;color:' + (over ? 'var(--red)' : 'inherit') + '">' + list.length + '명' + (over ? ' ⚠ 16명 초과' : '') +
      (src && src.multi && src.parts > 1 ? ' · 1학년 ' + list.filter(function (s) { return s.grade1; }).length + '명' : '') + '</span></div>' +
      '<div class="tbox"><div class="xl" style="min-width:620px"><div class="xl-t1">' + esc(Roster.makeTitle(S.date, b)) + '</div><div class="xl-t2">' + esc(Roster.makeLine(b)) + '</div>' +
      '<table class="xl-tbl"><thead><tr><th style="width:52px">번호</th><th>기관(학교)</th><th style="width:90px">학년/반</th><th style="width:110px">신청자</th><th style="width:80px">신청반</th><th style="width:120px">비고</th>' + (src && src.parts > 1 ? '<th class="mv"></th>' : '') + '</tr></thead><tbody>';
    var prev = '';
    list.forEach(function (s, k) {
      html += '<tr' + (prev && prev !== s.school ? ' class="sep"' : '') + '><td>' + (k + 1) + '</td>' +
        '<td><input type="text" class="cellin' + (s.schoolOk ? '' : ' warn') + '" value="' + esc(s.school) + '" data-xi="att-edit" data-no="' + esc(s.no) + '" data-f="school" aria-label="학교명"></td>' +
        '<td><input type="text" class="cellin' + (s.banOk ? '' : ' warn') + '" value="' + esc(s.ban) + '" data-xi="att-edit" data-no="' + esc(s.no) + '" data-f="ban" aria-label="학반"></td>' +
        '<td>' + esc(s.name) + '</td><td>' + esc(b.tag) + '</td><td>' + (letters[s.no] ? '<span class="badge link">🔗' + letters[s.no] + '</span> ' : '') + (s.grade1 && src.multi ? '<span class="badge amber">1학년</span>' : '') + '</td>' +
        (src.parts > 1 ? '<td class="mv"><button class="btn sm" data-x="att-move" data-key="' + esc(src.key) + '" data-no="' + esc(s.no) + '" title="다른 반으로 옮기기" aria-label="다른 반으로 옮기기">⇄</button></td>' : '') + '</tr>';
      prev = s.school;
    });
    return html + '</tbody></table></div></div></section>';
  }

  function viewAttDraft() {
    var A = S.att;
    var html = stepsBar(A.step);
    if (A.step === 1) {
      var lastAt = (S.data.classes || []).map(function (c) { return c.lastAt ? c.lastAt + ' · ' + c.lastBy : ''; }).filter(Boolean).sort().pop() || '';
      var red = openRows('red').length;
      var waiting = S.data.rows.filter(function (r) { return !r.cancelled && r.cells[12] === '대기'; }).length;
      html += '<section class="card pad" style="display:flex;flex-direction:column;gap:12px;border:2px solid #F59E0B"><b style="font-size:17px">① 출석부를 만들기 전에 확인해 주세요</b><div style="line-height:2">' +
        '· 마지막 명단 업로드: <b>' + esc(lastAt ? lastAt.slice(5) : '아직 없음') + '</b><br>&nbsp;&nbsp;→ 통합예약시스템 관리자 페이지에서 <b>최신 명단을 받아 다시 올렸나요?</b><br>' +
        '· 아직 처리하지 않은 <b style="color:var(--red)">취소 대상 ' + red + '건</b><br>' +
        '· 승인 안 된 대기자 <b>' + waiting + '명</b> (출석부에서 빠집니다)<br>' +
        '· 출석부에는 <b>승인</b>된 신청자 ' + A.sources.reduce(function (n, s) { return n + s.students.length; }, 0) + '명이 들어갑니다.</div>' +
        '<div class="row"><button class="btn" data-x="att-gohome">명단 올리러 가기</button></div></section>' + navBar(false, '다음: 반 설정 →');
    } else if (A.step === 2) {
      var ck = blockChecks();
      html += '<section class="card pad small muted" style="line-height:1.8">② 출석부 맨 위 두 줄입니다. <b>파란 테두리 칸</b>만 고르거나 입력하면 됩니다. 날짜는 자동으로 들어가고, 신청반 표기는 반 이름에서 자동으로 만들어집니다. 교구는 수업 사이를 <b>/</b>, 같은 수업 안의 여러 교구를 <b>,</b> 로 나눕니다(예: <b>핏츠, 코너드/펑펑 눈내리는 마을</b>).</section>' +
        A.blocks.map(function (b, i) { return blockCard(b, i, ck); }).join('') + navBar(true, '다음: 분반·학교명 정리 →');
    } else if (A.step === 3) {
      var letters = {};
      (A.sets || []).forEach(function (set, k) { set.nos.forEach(function (no) { letters[no] = String.fromCharCode(65 + (k % 26)); }); });
      var dl = dateLinks();
      html += '<section class="card pad small" style="display:flex;flex-direction:column;gap:6px;background:#FAF7FF;border-color:#DDD6FE"><b>같은 반 요청</b>' + (dl.length ? dl.map(function (x) {
        var g = x.g, label = g.members.map(function (m) { return esc(m.name) + '(' + esc(m.school) + ')'; }).join(' + ');
        if (x.applied) return '<span>✔ ' + label + ' · 이번 회차 요청' + (g.memo ? ' · ' + esc(g.memo) : '') + '</span>';
        return '<label class="row" style="gap:8px"><input type="checkbox" data-xc="att-keep" data-id="' + esc(g.id) + '"' + (A.acceptKeep[g.id] ? ' checked' : '') + ' style="width:18px;height:18px"><span>' + label + ' · <b>지난 요청 다시 적용?</b> (' + esc(Core.shortDate(g.date)) + '부터 계속 적용)</span></label>';
      }).join('') : '<span class="muted">이번 회차 요청이 없습니다. 전체 명단에서 묶을 수 있습니다.</span>') + '</section>';
      if (A.errors.length) html += '<section class="card pad" style="border-color:#FECDCA;background:var(--red-bg)">' + A.errors.map(esc).join('<br>') + '</section>';
      html += '<section class="card pad row between small"><span class="muted">③ 출석부와 같은 모양입니다. 학교는 정식 이름으로 바꾼 결과이고, <b>노란 칸</b>은 자동으로 정하지 못한 곳이니 눌러서 고쳐 주세요. [⇄]로 다른 반으로 옮깁니다. 규칙: 같은 반 요청 → 같은 학교 → 한 반 16명 이하 → 인원 균등 (창의 1,2반은 1학년도 균등)</span><button class="btn" data-x="att-resplit">자동 분반 다시 하기</button></section>' +
        A.blocks.map(function (b, i) { return sheetBlock(b, i, letters); }).join('');
      var sp = splitProblems();
      if (sp.length) html += '<section class="card pad small" style="border-color:#FECDCA;background:var(--red-bg)">' + sp.map(esc).join('<br>') + '</section>';
      html += navBar(true, '다음: 확인·내려받기 →');
    } else {
      html += '<section class="card pad" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:17px">④ 확인·내려받기</b><div class="tbox"><table class="grid"><thead><tr><th>순서</th><th>제목</th><th>교실·교구</th><th>신청반</th><th>인원</th></tr></thead><tbody>' +
        A.blocks.map(function (b, i) { var s = srcByKey(b.src); return '<tr><td>' + (i + 1) + '</td><td>' + esc(Roster.makeTitle(S.date, b)) + '</td><td>' + esc(Roster.makeLine(b)) + '</td><td>' + esc(b.tag) + '</td><td>' + (s ? s.students.length : 0) + '명</td></tr>'; }).join('') +
        '</tbody></table></div><p class="muted small" style="margin:0">확정하면 이 배정이 1차로 저장되고 엑셀이 내려받아집니다. 이후에는 분반을 다시 하지 않고 취소 처리·학생 추가만 합니다.</p></section>' +
        navBar(true, '확정 저장 · ' + esc(Roster.fileName(S.date, 1)) + ' 내려받기', 'att-save');
    }
    return html;
  }

  function attNext() {
    var A = S.att;
    if (A.step === 2) {
      var ck = blockChecks();
      if (ck.errors.length) { render(); toast('빨간색으로 표시한 반 설정을 먼저 고쳐 주세요.'); return; }
    }
    if (A.step === 3) {
      var sp = splitProblems();
      if (sp.length) { render(); toast(sp[0]); return; }
    }
    A.step = Math.min(4, A.step + 1);
    render(); window.scrollTo(0, 0);
  }

  function draftData() {
    var A = S.att;
    return {
      acceptKeep: A.acceptKeep,
      blocks: A.blocks.map(function (b) {
        var s = srcByKey(b.src);
        return { key: b.key, program: b.program, name: b.name, same: !!b.same, room1: b.room1, room2: b.room2, tool1: b.tool1, tool2: b.tool2,
          tag: b.tag, tagEdited: !!b.tagEdited, title: Roster.makeTitle(S.date, b), line: Roster.makeLine(b),
          students: s.students.map(function (st) { return { no: st.no, name: st.name, school: st.school, ban: st.ban, status: '' }; }) };
      })
    };
  }

  function viewAtt() {
    var saved = S.data.att;
    if (S.att && S.att.date !== S.date) S.att = null;
    if (S.att && S.att.mode === 'draft') return viewAttDraft();
    if (saved) return viewAttSaved(saved);
    return stepsBar(0) + '<section class="card pad" style="display:flex;flex-direction:column;gap:10px"><b style="font-size:17px">' + esc(md(S.date)) + ' 출석부 만들기</b>' +
      '<p class="muted" style="margin:0">승인된 신청자만으로 출석부를 만듭니다. ① 최신 명단 확인 → ② 반 설정(제목·교실·교구) → ③ 분반·학교명 정리 → ④ 확인·내려받기 순서로 한 단계씩 진행합니다.</p>' +
      '<div><button class="btn primary" data-x="att-start">출석부 만들기 시작</button></div></section>';
  }

  function downloadExcel(data, version) {
    var blocks = (data.blocks || []).map(function (b) {
      return { title: b.title, line: b.line, tag: b.tag, students: (b.students || []).filter(function (s) { return s.status !== '취소'; }) };
    });
    var wb = Roster.buildWorkbook(ExcelJS, blocks, mmdd(S.date));
    return wb.xlsx.writeBuffer().then(function (buf) {
      var blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = Roster.fileName(S.date, version);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
  }

  function saveAtt(data) {
    setBusy(true);
    return api('attSave', { date: S.date, data: data }).then(function (res) {
      return downloadExcel(data, res.version).then(function () {
        toast(res.version + '차 출석부를 저장하고 ' + Roster.fileName(S.date, res.version) + ' 을 내려받았습니다.');
        S.att = null;
        return load(S.date);
      });
    }).catch(function (er) { toast('저장하지 못했습니다: ' + er.message); }).then(function () { setBusy(false); });
  }

  function viewAttSaved(saved) {
    if (!S.att || S.att.mode !== 'edit' || S.att.version !== saved.version) {
      S.att = { mode: 'edit', date: S.date, version: saved.version, data: JSON.parse(JSON.stringify(saved.data)), dirty: false };
    }
    var A = S.att, blocks = A.data.blocks || [];
    var html = stepsBar(5, true) + '<section class="card pad row between" style="border-color:#86EFAC"><div><b style="font-size:17px">✔ ' + saved.version + '차 확정 · ' + esc(String(saved.at).slice(5, 16)) + ' · ' + esc(saved.by) + '</b>' +
      '<div class="muted small">확정 후에는 분반을 다시 하지 않습니다. 취소한 학생은 출석부에서 빠지고 결석 기록으로 넘어갑니다. 바꾼 내용은 [변경 저장]을 눌러야 다음 차수로 저장됩니다.</div></div>' +
      '<div class="row"><button class="btn" data-x="att-redl">엑셀 다시 내려받기 (' + esc(Roster.fileName(S.date, saved.version)) + ')</button>' +
      '<button class="btn primary" data-x="att-save2"' + (A.dirty ? '' : ' disabled') + '>변경 저장 · ' + esc(Roster.fileName(S.date, saved.version + 1)) + '</button>' +
      '<button class="btn" data-x="att-rebuild">처음부터 다시 만들기</button></div></section>';
    blocks.forEach(function (b, i) {
      var live = (b.students || []).filter(function (s) { return s.status !== '취소'; }).length;
      html += '<section class="card pad" style="display:flex;flex-direction:column;gap:8px"><div class="row between"><input type="text" value="' + esc(b.title) + '" data-xi="att-ef" data-i="' + i + '" data-f="title" aria-label="제목" style="flex:1;font-weight:700">' +
        '<span style="font-weight:700;color:' + (live > Roster.CAP ? 'var(--red)' : 'inherit') + '">' + live + '명' + (live > Roster.CAP ? ' ⚠ 16명 초과' : '') + '</span></div>' +
        '<input type="text" value="' + esc(b.line) + '" data-xi="att-ef" data-i="' + i + '" data-f="line" aria-label="교실·교구">' +
        '<div class="tbox"><table class="grid"><thead><tr><th>번호</th><th>기관(학교)</th><th>학년/반</th><th>신청자</th><th>신청반</th><th>상태</th><th></th></tr></thead><tbody>' +
        (b.students || []).map(function (s, j) {
          var cut = s.status === '취소';
          return '<tr class="' + (cut ? 'cut' : '') + '"><td>' + (j + 1) + '</td><td>' + esc(s.school) + '</td><td>' + esc(s.ban) + '</td><td>' + esc(s.name) + '</td><td>' + esc(b.tag) + '</td>' +
            '<td>' + (cut ? '<span class="badge done" style="text-decoration:none">취소자</span>' : (s.added ? '<span class="badge new">추가</span>' : '')) + '</td>' +
            '<td style="text-decoration:none">' + (cut ? '<button class="btn sm" data-x="att-uncancel" data-i="' + i + '" data-j="' + j + '">되돌리기</button>' : '<button class="btn sm" data-x="att-cancel" data-i="' + i + '" data-j="' + j + '">취소 처리</button>') + '</td></tr>';
        }).join('') + '</tbody></table></div><div><button class="btn sm" data-x="att-addstu" data-i="' + i + '">학생 추가</button></div></section>';
    });
    return html;
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
        A.data.blocks[i].students.push(st);
        A.dirty = true;
        close(); render();
      }
    });
  }

  function absForStudent(s, b) {
    var r = s.no ? rowByNo(s.no) : null;
    return { date: S.date, no: s.no, name: s.name, school: s.school, ban: s.ban, cls: b.tag, phone: r ? r.cells[3] : '', src: '출석부 취소 처리', reason: '기한 후 취소' };
  }

  /* ───────── 새 기능 이벤트 ───────── */

  function extraClick(t) {
    var x = t.getAttribute('data-x');
    var i = +t.getAttribute('data-i'), j = +t.getAttribute('data-j');
    var A = S.att;
    if (x === 'sel-clear') { S.sel = {}; refreshFull(); }
    else if (x === 'sel-link') linkDialog();
    else if (x === 'abs-reason') absPatch(t.getAttribute('data-id'), { reason: t.getAttribute('data-v') });
    else if (x === 'abs-del') {
      if (!confirm('이 결석 기록을 삭제할까요?')) return;
      api('absDelete', { id: t.getAttribute('data-id') }).then(function () { return load(S.date); }).catch(function (er) { toast(er.message); });
    }
    else if (x === 'att-start') buildDraft();
    else if (x === 'att-gohome') { S.view = 'home'; render(); window.scrollTo(0, 0); }
    else if (x === 'att-next') attNext();
    else if (x === 'att-prev') { A.step = Math.max(1, A.step - 1); render(); window.scrollTo(0, 0); }
    else if (x === 'att-step') { A.step = +t.getAttribute('data-n'); render(); window.scrollTo(0, 0); }
    else if (x === 'att-resplit') { computeParts(); render(); }
    else if (x === 'att-move') {
      var from = srcByKey(t.getAttribute('data-key'));
      var sib = A.sources.filter(function (s) { return s.group === from.group && s.key !== from.key; })[0];
      var k = from.students.findIndex(function (s) { return s.no === t.getAttribute('data-no'); });
      if (sib && k >= 0) { sib.students = Roster.sortStudents(sib.students.concat(from.students.splice(k, 1))); render(); }
    }
    else if (x === 'att-save') {
      var sp = splitProblems(), ck = blockChecks();
      if (sp.length || ck.errors.length) { toast('반 설정이나 분반에 고칠 곳이 있습니다.'); return; }
      saveAtt(draftData());
    }
    else if (x === 'att-redl') downloadExcel(S.data.att.data, S.data.att.version);
    else if (x === 'att-save2') saveAtt(A.data);
    else if (x === 'att-rebuild') { if (confirm('저장된 출석부와 상관없이 처음부터 다시 분반합니다. 저장하기 전까지 기존 출석부는 그대로입니다. 계속할까요?')) buildDraft(); }
    else if (x === 'att-cancel') {
      var b = A.data.blocks[i], st = b.students[j];
      st.status = '취소'; A.dirty = true; render();
      saveAbs(absForStudent(st, b)).then(function () { toast(st.name + ' 학생을 취소자로 표시하고 결석 기록에 넣었습니다.'); });
    } else if (x === 'att-uncancel') {
      var b2 = A.data.blocks[i], st2 = b2.students[j];
      st2.status = ''; A.dirty = true; render();
      var rec = (S.data.absences || []).filter(function (a) { return a.src === '출석부 취소 처리' && ((st2.no && a.no === st2.no) || (!st2.no && a.name === st2.name)); })[0];
      if (rec) api('absDelete', { id: rec.id }).then(function () { return load(S.date); });
    } else if (x === 'att-addstu') attAddStudent(i);
  }

  function extraChange(el) {
    var x = el.getAttribute('data-xc'), A = S.att;
    if (x === 'abs-ex') absPatch(el.getAttribute('data-id'), { excused: el.checked });
    else if (x === 'abs-field') { var p = {}; p[el.getAttribute('data-f')] = el.value; absPatch(el.getAttribute('data-id'), p); }
    else if (x === 'att-keep') { if (el.checked) A.acceptKeep[el.getAttribute('data-id')] = true; else delete A.acceptKeep[el.getAttribute('data-id')]; computeParts(); render(); }
    else if (x === 'att-b') {
      var b = A.blocks[+el.getAttribute('data-i')], f = el.getAttribute('data-f');
      b[f] = el.type === 'checkbox' ? el.checked : el.value;
      render();
    }
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
    if (x === 'att-edit') {
      var no = el.getAttribute('data-no'), f = el.getAttribute('data-f');
      A.edits[no] = A.edits[no] || {};
      A.edits[no][f] = el.value;
      A.sources.forEach(function (s) { s.students.forEach(function (st) { if (st.no === no) { st[f] = el.value; if (f === 'school') st.schoolOk = true; else st.banOk = /^\d-\d+$/.test(el.value); } }); });
      el.classList.toggle('warn', f === 'ban' && !/^\d-\d+$/.test(el.value));
      if (f === 'school') el.classList.remove('warn');
    } else if (x === 'att-b') {
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
    } else if (x === 'att-ef') {
      A.data.blocks[+el.getAttribute('data-i')][el.getAttribute('data-f')] = el.value;
      if (!A.dirty) { A.dirty = true; var bt = document.querySelector('[data-x=att-save2]'); if (bt) bt.disabled = false; }
    }
  }

  /* ───────── 이벤트 ───────── */

  root.addEventListener('click', function (e) {
    var t = e.target.closest('[data-view],[data-act],[data-done],[data-ok],[data-undo],[data-expand],[data-sort],[data-fq],[data-go],[data-keepabs],[data-x]');
    if (!t) return;
    if (t.hasAttribute('data-x')) return extraClick(t, e);
    if (t.hasAttribute('data-keepabs')) return toggleAbsence(t.getAttribute('data-keepabs'));
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
    if (e.target.id === 'round') { S.lastUpload = null; load(e.target.value); }
    else if (e.target.getAttribute('data-act') === 'cols') { S.showAll = e.target.checked; render(); }
    else if (e.target.id === 'fcls') { S.f.cls = e.target.value; refreshFull(); }
    else if (e.target.id === 'pick') { uploadFromFiles(e.target.files); e.target.value = ''; }
    else if (e.target.hasAttribute('data-sel')) {
      var sn = e.target.getAttribute('data-sel');
      if (e.target.checked) S.sel[sn] = true; else delete S.sel[sn];
      var sb = document.getElementById('selbar'); if (sb) sb.innerHTML = selBar();
    } else if (e.target.hasAttribute('data-xc')) extraChange(e.target);
  });

  root.addEventListener('input', function (e) {
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
