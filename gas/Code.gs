/*
 * 주말 신청 점검 — Apps Script (저장·점검 서버)
 * 구글 시트에 붙어 있는 스크립트입니다. 웹앱으로 배포하면 GitHub Pages 화면이 이 주소로 요청을 보냅니다.
 * 스크립트 속성: CLIENT_ID (구글 로그인 클라이언트 ID), NEIS_KEY (NEIS 인증키),
 *   TOPIC_SHEET_ID · TOPIC_TAB (주제·교구 시트, 비우면 아래 기본값)
 */

var TZ = 'Asia/Seoul';
var SHEET = {
  LIST: '통합명단', SUMMARY: '점검현황', STATUS: '처리기록', UPLOADS: '업로드기록', RESTRICT: '신청제한',
  DATES: '설정_수업일', CLASSES: '설정_반', SCHOOLS: '설정_학교', MAP: '예약명연결', USERS: '점검자',
  LINKS: '같은반요청', ABS: '결석기록', ATT: '출석부'
};
var TOPIC_SHEET_DEFAULT = '165RlpeCfhR9Z4n_Qq2IoPMTXBlkSiUWZMyBBhO77MBw';
var TOPIC_TAB_DEFAULT = '하반기';
var EXTRA = ['수업일', '시간대', '수업반', '접수명', '점검결과', '처리상태', '처리자', '처리시각', '메모', '업로드시각', '업로더', '파일명', '순번', '처음 올라온 시각'];
var LIST_HEADER, X, HEADERS;

/** Core.gs 를 쓰는 값은 파일 순서와 상관없이 처음 호출될 때 만듭니다. */
function init_() {
  if (LIST_HEADER) return;
  LIST_HEADER = Core.HEADER.concat(EXTRA);
  X = {};
  EXTRA.forEach(function (h, i) { X[h] = Core.HEADER.length + i; });
  HEADERS = {};
  HEADERS[SHEET.LIST] = LIST_HEADER;
  HEADERS[SHEET.SUMMARY] = ['수업일', '시간대', '수업반', '접수명', '인원', '정원', '취소대상 미처리', '확인필요 미처리', '처리 완료', '최종 업로드', '업로더'];
  HEADERS[SHEET.STATUS] = ['수업일', '신청일련번호', '상태', '처리자', '처리시각', '메모', '지문'];
  HEADERS[SHEET.UPLOADS] = ['업로드시각', '업로더', '파일명', '파일시각', '수업일', '접수명', '인원', '결과'];
  HEADERS[SHEET.RESTRICT] = ['결석 수업일', '학생명', '학교', '사유', '제한 수업일(비우면 자동)', '메모', '등록자'];
  HEADERS[SHEET.DATES] = ['회차', '수업일', '비고'];
  HEADERS[SHEET.CLASSES] = ['시간대', '수업반', '접수명', '예약명 키워드', '대상 시작', '대상 끝', '정원', '시작 회차', '끝 회차', '비고'];
  HEADERS[SHEET.SCHOOLS] = ['학교명', '학교급', '앞 두 글자'];
  HEADERS[SHEET.MAP] = ['예약명(날짜 제외)', '접수명', '등록자', '등록시각'];
  HEADERS[SHEET.USERS] = ['이메일', '이름'];
  HEADERS[SHEET.LINKS] = ['묶음ID', '수업일', '범위', '신청일련번호', '학생명', '학교', '메모', '등록자', '등록시각'];
  HEADERS[SHEET.ABS] = ['기록ID', '수업일', '신청일련번호', '학생명', '학교', '학반', '반', '연락처', '경로', '사유', '취소시각', '메모', '출석인정', '기록자', '기록시각'];
  HEADERS[SHEET.ATT] = ['수업일', '차수', '저장시각', '저장자', '내용'];
}

/* ───────── 진입점 ───────── */

function doGet() {
  return ContentService.createTextOutput('주말 신청 점검 서버가 동작 중입니다.');
}

function doPost(e) {
  var out;
  init_();
  try {
    var req = JSON.parse(e.postData.contents);
    var user = authenticate_(req.token);
    var fn = API[req.action];
    if (!fn) throw apiError_('BAD_ACTION', '알 수 없는 요청입니다.');
    out = fn(req, user);
    out.ok = true;
  } catch (err) {
    out = { ok: false, code: err.code || 'ERROR', error: err.code ? err.message : '서버 오류: ' + err.message };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, msg) { var e = new Error(msg); e.code = code; return e; }

/* ───────── 로그인 확인 ───────── */

function authenticate_(token) {
  if (!token) throw apiError_('AUTH', '로그인이 필요합니다.');
  var cache = CacheService.getScriptCache();
  var ck = 'tk_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token));
  var email = cache.get(ck);
  if (!email) {
    var clientId = PropertiesService.getScriptProperties().getProperty('CLIENT_ID');
    if (!clientId) throw apiError_('SETUP', '스크립트 속성 CLIENT_ID가 없습니다. 설치 안내서를 확인하세요.');
    var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw apiError_('AUTH', '로그인이 만료되었습니다. 다시 로그인해 주세요.');
    var info = JSON.parse(res.getContentText());
    var exp = +info.exp * 1000;
    var okIss = info.iss === 'accounts.google.com' || info.iss === 'https://accounts.google.com';
    var verified = info.email_verified === true || info.email_verified === 'true';
    if (info.aud !== clientId || !okIss || !verified || exp < Date.now()) throw apiError_('AUTH', '로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
    email = String(info.email).toLowerCase();
    var ttl = Math.min(3600, Math.floor((exp - Date.now()) / 1000) - 30);
    if (ttl > 30) cache.put(ck, email, ttl);
  }
  var users = readUsers_();
  if (!users[email]) throw apiError_('FORBIDDEN', email + ' 계정은 점검자로 등록되어 있지 않습니다. 시트의 [점검자] 탭에 추가해 주세요.');
  return { email: email, name: users[email] };
}

function readUsers_() {
  var map = {};
  readTable_(SHEET.USERS).rows.forEach(function (r) {
    var em = Core.str(r[0]).toLowerCase();
    if (em) map[em] = Core.str(r[1]) || em.split('@')[0];
  });
  return map;
}

/* ───────── 시트 읽기·쓰기 ───────── */

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) {
    sh = ss_().insertSheet(name);
    var h = HEADERS[name];
    if (h) { sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold'); sh.setFrozenRows(1); }
  }
  return sh;
}

function cellText_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v).trim();
}

function readTable_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var header = values.length ? values[0].map(cellText_) : (HEADERS[name] || []);
  var rows = values.slice(1).map(function (r) { return r.map(cellText_); })
    .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  return { header: header, rows: rows };
}

/** 수식으로 해석될 수 있는 값은 글자로 저장 (수식 삽입 방지) */
function safeCell_(v) {
  var s = v === null || v === undefined ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function writeTable_(name, rows) {
  var sh = sheet_(name);
  var header = HEADERS[name];
  var all = [header].concat(rows.map(function (r) {
    var o = [];
    for (var i = 0; i < header.length; i++) o.push(safeCell_(r[i]));
    return o;
  }));
  sh.clearContents();
  var rg = sh.getRange(1, 1, all.length, header.length);
  rg.setNumberFormat('@');
  rg.setValues(all);
}

function appendRows_(name, rows) {
  if (!rows.length) return;
  var sh = sheet_(name);
  var header = HEADERS[name];
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var data = rows.map(function (r) { var o = []; for (var i = 0; i < header.length; i++) o.push(safeCell_(r[i])); return o; });
  var rg = sh.getRange(start, 1, data.length, header.length);
  rg.setNumberFormat('@');
  rg.setValues(data);
}

/* ───────── 설정 읽기 ───────── */

function parseSheetDate_(s, year) {
  var t = Core.str(s);
  var m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(t);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = /^(\d{1,2})\s*[/.\-월]\s*(\d{1,2})/.exec(t);
  if (m && year) return year + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return '';
}

function today_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function now_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'); }

function loadCtx_() {
  var year = today_().slice(0, 4);
  var dates = readTable_(SHEET.DATES).rows.map(function (r) {
    return { n: Core.str(r[0]), date: parseSheetDate_(r[1], year), note: Core.str(r[2]) };
  }).filter(function (d) { return d.date; });
  var classes = readTable_(SHEET.CLASSES).rows.map(function (r, i) {
    var range = Core.parseGradeRange(Core.str(r[4]) + (Core.str(r[5]) ? '~' + Core.str(r[5]) : ''));
    return {
      '시간대': Core.str(r[0]), '수업반': Core.str(r[1]), '접수명': Core.str(r[2]) || Core.str(r[1]),
      keyword: Core.str(r[3]), range: range, rangeText: Core.rangeLabel(range), cap: Core.str(r[6]),
      from: Core.str(r[7]), to: Core.str(r[8]), note: Core.str(r[9]), order: i
    };
  }).filter(function (c) { return c['접수명']; });
  var schools = readTable_(SHEET.SCHOOLS).rows.map(function (r) { return { name: r[0], level: Core.str(r[1]).charAt(0) }; })
    .filter(function (s) { return s.name; });
  var restrictions = readTable_(SHEET.RESTRICT).rows.map(function (r) {
    var absent = parseSheetDate_(r[0], year);
    var date = parseSheetDate_(r[4], year) || Core.nextClassDate(dates, absent);
    return { absent: absent, name: Core.str(r[1]), school: Core.str(r[2]), reason: Core.str(r[3]), date: date, memo: Core.str(r[5]) };
  }).filter(function (r) { return r.name; });
  // 결석 기록 중 출석 인정이 아닌 것은 다음 수업일 신청 제한
  readTable_(SHEET.ABS).rows.forEach(function (r) {
    if (!r[3] || r[12] === 'Y') return;
    restrictions.push({ absent: r[1], name: Core.str(r[3]), school: Core.str(r[4]), reason: Core.str(r[9]) || '결석', date: Core.nextClassDate(dates, r[1]), memo: Core.str(r[11]) });
  });
  var mappings = {};
  readTable_(SHEET.MAP).rows.forEach(function (r) { if (r[0]) mappings[r[0]] = r[1]; });
  return { year: year, dates: dates, classes: classes, schools: schools, restrictions: restrictions, mappings: mappings };
}

/* ───────── 점검 계산 ───────── */

function roundView_(ctx, date, list, statuses) {
  var active = Core.activeClasses(ctx.classes, ctx.dates, date);
  var byName = {};
  active.forEach(function (c) { byName[c['접수명']] = c; });
  var rows = [];
  list.forEach(function (r, i) {
    if (!Core.instanceCovers(r[X['수업일']], date)) return;
    var cls = byName[r[X['접수명']]] || ctx.classes.filter(function (c) { return c['접수명'] === r[X['접수명']]; })[0] || null;
    rows.push({ idx: i, no: r[0], row: r.slice(0, Core.HEADER.length), cls: cls, inst: r[X['수업일']], seq: +r[X['순번']] || 0, firstSeen: r[X['처음 올라온 시각']] || '' });
  });
  var result = Core.analyzeRound(rows, ctx, date);
  rows.forEach(function (e) {
    var a = result[e.no];
    e.issues = a.issues;
    e.level = a.level;
    e.fp = a.fp;
    e.cancelled = a.cancelled;
    var st = statuses[date + '|' + e.no];
    e.status = null;
    e.changed = false;
    if (st && a.issues.length) {
      if (st.fp === a.fp) e.status = st; else e.changed = true;
    }
  });
  return { active: active, rows: rows };
}

function readStatuses_() {
  var map = {};
  readTable_(SHEET.STATUS).rows.forEach(function (r, i) {
    map[r[0] + '|' + r[1]] = { s: r[2], who: r[3], at: r[4], memo: r[5], fp: r[6], idx: i };
  });
  return map;
}

function resultText_(e) {
  if (e.cancelled) return '예약취소';
  if (!e.issues.length) return '이상 없음';
  var reds = e.issues.filter(function (i) { return i.level === 'red'; }).map(function (i) { return i.label; });
  var ambers = e.issues.filter(function (i) { return i.level === 'amber'; }).map(function (i) { return i.label; });
  return reds.length ? '취소대상: ' + uniq_(reds).join(', ') : '확인필요: ' + uniq_(ambers).join(', ');
}

function uniq_(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }

/** 통합명단의 점검결과·처리 열과 점검현황 탭을 그 회차 기준으로 다시 씁니다. */
function refreshSheetView_(ctx, date, list, statuses, uploads) {
  var view = roundView_(ctx, date, list, statuses);
  view.rows.forEach(function (e) {
    var r = list[e.idx];
    r[X['점검결과']] = resultText_(e);
    r[X['처리상태']] = e.status ? (e.status.s === 'ok' ? '문제없음' : '완료') : (e.issues.length && !e.cancelled ? (e.changed ? '미처리(내용 변경)' : '미처리') : '');
    r[X['처리자']] = e.status ? e.status.who : '';
    r[X['처리시각']] = e.status ? e.status.at : '';
    r[X['메모']] = e.status ? e.status.memo : '';
  });
  writeTable_(SHEET.LIST, list);
  var summary = view.active.map(function (c) {
    var mine = view.rows.filter(function (e) { return e.cls && e.cls['접수명'] === c['접수명']; });
    var live = mine.filter(function (e) { return !e.cancelled; });
    var open = function (lv) { return live.filter(function (e) { return e.level === lv && !e.status; }).length; };
    var last = lastUpload_(uploads, date, c['접수명']);
    return [date, c['시간대'], c['수업반'], c['접수명'], live.length, c.cap, open('red'), open('amber'),
      live.filter(function (e) { return e.status; }).length, last ? last[0] : '', last ? last[1] : ''];
  });
  writeTable_(SHEET.SUMMARY, summary);
}

function lastUpload_(uploads, date, name) {
  var hit = null;
  uploads.forEach(function (u) {
    if (u[5] === name && Core.instanceCovers(u[4], date) && /^반영/.test(u[7])) { if (!hit || u[3] > hit[3]) hit = u; }
  });
  return hit;
}

function bumpRev_() {
  var p = PropertiesService.getScriptProperties();
  var rev = String((+p.getProperty('REV') || 0) + 1);
  p.setProperty('REV', rev);
  return rev;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw apiError_('BUSY', '다른 선생님의 작업을 처리하는 중입니다. 잠시 후 다시 시도해 주세요.');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ───────── API ───────── */

var API = {};

API.rev = function () {
  return { rev: PropertiesService.getScriptProperties().getProperty('REV') || '0' };
};

API.state = function (req, user) {
  var ctx = loadCtx_();
  var date = req.date || Core.currentRound(ctx.dates, today_());
  var list = readTable_(SHEET.LIST).rows;
  var statuses = readStatuses_();
  var uploads = readTable_(SHEET.UPLOADS).rows;
  var out = {
    user: user, rev: API.rev().rev, today: today_(), date: date, sheetUrl: ss_().getUrl(),
    dates: ctx.dates, classes: [], rows: [], uploads: [], uploadedFiles: []
  };
  if (!date) return out;
  var view = roundView_(ctx, date, list, statuses);
  out.classes = view.active.map(function (c) {
    var last = lastUpload_(uploads, date, c['접수명']);
    return { '시간대': c['시간대'], '수업반': c['수업반'], '접수명': c['접수명'], rangeText: c.rangeText, cap: c.cap, order: c.order,
      lastAt: last ? last[0] : '', lastBy: last ? last[1] : '', lastFile: last ? last[2] : '' };
  });
  // 새로 들어옴: 이 반의 첫 업로드가 아니고, 가장 최근 업로드에서 처음 나타난 신청
  var upAt = {};
  uploads.forEach(function (u) {
    if (!/^반영/.test(u[7]) || !Core.instanceCovers(u[4], date)) return;
    var k = u[4] + '|' + u[5];
    var o = upAt[k] || (upAt[k] = { first: u[0], last: u[0] });
    if (u[0] < o.first) o.first = u[0];
    if (u[0] > o.last) o.last = u[0];
  });
  out.rows = view.rows.map(function (e) {
    return { no: e.no, cells: e.row, cls: e.cls ? e.cls['접수명'] : '', inst: e.inst, seq: e.seq, issues: e.issues, level: e.level,
      cancelled: e.cancelled, status: e.status ? { s: e.status.s, who: e.status.who, at: e.status.at, memo: e.status.memo } : null, changed: e.changed,
      isNew: (function () { var o = upAt[e.inst + '|' + (e.cls ? e.cls['접수명'] : '')]; return !!(o && e.firstSeen && o.first !== o.last && e.firstSeen === o.last); })() };
  });
  var from = Core.addDays(date, -Core.WINDOW_DAYS);
  out.uploads = uploads.filter(function (u) { return Core.instanceCovers(u[4], date) || (u[3] >= from && u[3] <= date + 'T99'); })
    .map(function (u) { return { at: u[0], by: u[1], file: u[2], fileTs: u[3], inst: u[4], name: u[5], count: u[6], result: u[7] }; })
    .reverse();
  out.uploadedFiles = uploads.map(function (u) { return u[2] + '|' + u[3]; });
  out.links = readLinks_();
  out.absences = readAbsences_().filter(function (a) { return a.date === date; });
  var att = readAtt_();
  out.att = att.filter(function (a) { return a.date === date; }).pop() || null;
  out.attPrev = att.filter(function (a) { return a.date < date; }).pop() || null;
  if (out.attPrev) out.attPrev = { date: out.attPrev.date, blocks: (out.attPrev.data.blocks || []).map(function (b) { return { key: b.key, title: b.title, sessions: b.sessions, rooms: b.rooms, line: b.line, tag: b.tag }; }) };
  out.schools = ctx.schools;
  out.groups = ctx.classes.map(function (c) { return { '수업반': c['수업반'], '접수명': c['접수명'], order: c.order, range: c.range }; });
  return out;
};

/* ───────── 같은 반 요청 ───────── */

function readLinks_() {
  var map = {};
  readTable_(SHEET.LINKS).rows.forEach(function (r) {
    var g = map[r[0]] || (map[r[0]] = { id: r[0], date: r[1], scope: r[2], memo: r[6], by: r[7], at: r[8], members: [] });
    g.members.push({ no: r[3], name: r[4], school: r[5] });
  });
  return Object.keys(map).map(function (k) { return map[k]; });
}

API.linkAdd = function (req, user) {
  return withLock_(function () {
    var members = (req.members || []).filter(function (m) { return Core.str(m.name); });
    if (members.length < 2) throw apiError_('BAD', '2명 이상 골라 주세요.');
    var id = 'L' + Date.now().toString(36);
    var at = now_();
    appendRows_(SHEET.LINKS, members.map(function (m) {
      return [id, req.date, req.scope === 'keep' ? '계속' : '이번', Core.str(m.no), Core.str(m.name), Core.str(m.school), Core.str(req.memo), user.name, at];
    }));
    bumpRev_();
    return { id: id };
  });
};

API.linkRemove = function (req) {
  return withLock_(function () {
    writeTable_(SHEET.LINKS, readTable_(SHEET.LINKS).rows.filter(function (r) { return r[0] !== req.id; }));
    bumpRev_();
    return {};
  });
};

/* ───────── 결석 기록 ───────── */

var ABS_KEYS = ['id', 'date', 'no', 'name', 'school', 'ban', 'cls', 'phone', 'src', 'reason', 'cancelAt', 'memo', 'excused', 'by', 'at'];

function readAbsences_() {
  return readTable_(SHEET.ABS).rows.map(function (r) {
    var o = {};
    ABS_KEYS.forEach(function (k, i) { o[k] = r[i]; });
    o.excused = r[12] === 'Y';
    return o;
  });
}

API.absSave = function (req, user) {
  return withLock_(function () {
    var rec = req.rec || {};
    if (!Core.str(rec.name) || !rec.date) throw apiError_('BAD', '학생명과 수업일이 필요합니다.');
    var rows = readTable_(SHEET.ABS).rows;
    var id = rec.id || ('A' + Date.now().toString(36));
    var row = ABS_KEYS.map(function (k) { return k === 'excused' ? (rec.excused ? 'Y' : '') : Core.str(rec[k]); });
    row[0] = id; row[13] = user.name; row[14] = now_();
    var i = -1;
    rows.forEach(function (r, k) { if (r[0] === id) i = k; });
    // 같은 수업일·같은 신청번호 기록이 이미 있으면 그 기록을 고칩니다
    if (i < 0 && rec.no) rows.forEach(function (r, k) { if (r[1] === rec.date && r[2] === rec.no) { i = k; row[0] = id = r[0]; } });
    if (i >= 0) rows[i] = row; else rows.push(row);
    writeTable_(SHEET.ABS, rows);
    bumpRev_();
    return { id: id };
  });
};

API.absDelete = function (req) {
  return withLock_(function () {
    writeTable_(SHEET.ABS, readTable_(SHEET.ABS).rows.filter(function (r) { return r[0] !== req.id; }));
    bumpRev_();
    return {};
  });
};

/* ───────── 출석부 ───────── */

function readAtt_() {
  return readTable_(SHEET.ATT).rows.map(function (r) {
    var data = {};
    try { data = JSON.parse(r[4]); } catch (e) { data = {}; }
    return { date: r[0], version: +r[1] || 1, at: r[2], by: r[3], data: data };
  }).sort(function (a, b) { return a.date === b.date ? a.version - b.version : (a.date < b.date ? -1 : 1); });
}

API.attSave = function (req, user) {
  return withLock_(function () {
    if (!req.date || !req.data) throw apiError_('BAD', '저장할 출석부가 없습니다.');
    var json = JSON.stringify(req.data);
    if (json.length > 48000) throw apiError_('BAD', '출석부 내용이 너무 큽니다.');
    var prev = readAtt_().filter(function (a) { return a.date === req.date; });
    var version = prev.length ? prev[prev.length - 1].version + 1 : 1;
    var at = now_();
    appendRows_(SHEET.ATT, [[req.date, String(version), at, user.name, json]]);
    bumpRev_();
    return { version: version, at: at, by: user.name };
  });
};

/** 주제·교구 시트에서 그 수업일의 수업 목록을 읽습니다 (읽기만 함) */
API.topics = function (req) {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('TOPIC_SHEET_ID') || TOPIC_SHEET_DEFAULT;
  var tab = p.getProperty('TOPIC_TAB') || TOPIC_TAB_DEFAULT;
  var sh;
  try { sh = SpreadsheetApp.openById(id).getSheetByName(tab); } catch (e) {
    return { ok: true, error: '주제·교구 시트를 열 수 없습니다 (' + e.message + ')', items: [] };
  }
  if (!sh) return { error: '주제·교구 시트에 「' + tab + '」 탭이 없습니다.', items: [] };
  var values = sh.getDataRange().getValues();
  var hi = -1, col = {};
  for (var r = 0; r < Math.min(values.length, 5) && hi < 0; r++) {
    var row = values[r].map(cellText_);
    if (row.indexOf('날짜') >= 0 && row.indexOf('반') >= 0) { hi = r; row.forEach(function (h, i) { col[h] = i; }); }
  }
  if (hi < 0) return { error: '주제·교구 시트에서 「날짜」 「반」 제목 줄을 찾지 못했습니다.', items: [] };
  var want = (+req.date.slice(5, 7)) + '/' + (+req.date.slice(8, 10));
  var items = [];
  values.slice(hi + 1).forEach(function (r) {
    var d = r[col['날짜']];
    var md = d instanceof Date ? Utilities.formatDate(d, TZ, 'M/d') : Core.str(d).replace(/\(.*\)/, '').trim();
    if (md !== want) return;
    var g = function (h) { return col[h] === undefined ? '' : Core.str(r[col[h]]); };
    items.push({ time: g('시간'), area: g('영역'), cls: g('반'), topic: g('주제'), tools: g('교구') });
  });
  return { items: items };
};

API.upload = function (req, user) {
  return withLock_(function () {
    var ctx = loadCtx_();
    var date = req.date;
    if (!date) throw apiError_('BAD', '수업일이 정해지지 않았습니다. 설정_수업일 탭을 확인하세요.');
    var year = date.slice(0, 4);
    var at = now_();

    // 이번에 고른 예약명 연결을 저장
    var newMaps = [];
    Object.keys(req.mappings || {}).forEach(function (k) {
      if (req.mappings[k]) { ctx.mappings[k] = req.mappings[k]; newMaps.push([k, req.mappings[k], user.name, at]); }
    });
    appendRows_(SHEET.MAP, newMaps);

    var active = Core.activeClasses(ctx.classes, ctx.dates, date);
    var list = readTable_(SHEET.LIST).rows;
    var uploads = readTable_(SHEET.UPLOADS).rows;
    var results = [], needMap = [], logs = [];

    var files = (req.files || []).slice().sort(function (a, b) { return a.fileTs < b.fileTs ? -1 : 1; });
    var checked = files.map(function (f) {
      var p = Core.parseTitle(f.title, year);
      var res = { file: f.fileName, title: f.title, result: '', detail: '' };
      results.push(res);
      // 받은 시각은 화면에서 계산해 보냅니다 (이름에 시각이 없으면 파일 저장 시각)
      var meta = Core.isListFile(f.fileName) && Core.validTs(f.fileTs) ? { date: f.fileTs.slice(0, 10), ts: f.fileTs } : null;
      if (!sameHeader_(f.header)) { res.result = '오류'; res.detail = '엑셀 열 구성이 예상과 다름'; return null; }
      if (!meta) { res.result = '오류'; res.detail = '통합예약 명단 파일이 아니거나 받은 시각을 알 수 없음'; return null; }
      if (!req.ignoreWindow && !Core.inWindow(meta.date, date)) { res.result = '건너뜀'; res.detail = '접수 기간(' + Core.shortDate(Core.addDays(date, -Core.WINDOW_DAYS)) + '~' + Core.shortDate(date) + ') 밖의 파일'; return null; }
      if (!p.start) { res.result = '오류'; res.detail = '예약명에서 수업 날짜를 찾지 못함'; return null; }
      if (!Core.instanceCovers(Core.instanceKey(p), date)) { res.result = '건너뜀'; res.detail = '예약명 날짜(' + Core.shortDate(p.start) + ')가 이번 수업일과 다름'; return null; }
      return { f: f, p: p, meta: meta, res: res };
    });
    // 같은 예약명은 가장 늦게 받은 파일만
    var latest = {};
    checked.forEach(function (c) { if (c) latest[c.p.key] = c; });

    checked.forEach(function (c) {
      if (!c) return;
      var f = c.f, p = c.p, meta = c.meta, res = c.res;
      if (latest[p.key] !== c) { res.result = '건너뜀'; res.detail = '같은 반의 더 최근 파일이 있음'; return; }
      var inst = Core.instanceKey(p);
      var cls = Core.resolveClass(f.title, year, active, ctx.mappings);
      if (!cls) {
        res.result = '연결 필요'; res.detail = '설정된 반과 예약명이 다름';
        needMap.push({ key: p.key, title: f.title, file: f.fileName, count: f.rows.length,
          candidates: active.map(function (c) { return { name: c['접수명'], label: c['시간대'] + ' · ' + c['접수명'] + ' (' + c.rangeText + ')' }; }) });
        return;
      }
      var prev = null;
      uploads.forEach(function (u) { if (u[4] === inst && u[5] === cls['접수명'] && /^반영/.test(u[7]) && (!prev || u[3] > prev[3])) prev = u; });
      if (prev && meta.ts <= prev[3]) { res.result = '건너뜀'; res.detail = '이미 더 최근 명단(' + prev[3].slice(11, 16) + ' 받은 파일)이 올라가 있음'; return; }

      var seenBefore = {};
      list.forEach(function (r) { if (r[X['수업일']] === inst && r[X['접수명']] === cls['접수명']) seenBefore[r[0]] = r[X['처음 올라온 시각']] || r[X['업로드시각']]; });
      list = list.filter(function (r) { return !(r[X['수업일']] === inst && r[X['접수명']] === cls['접수명']); });
      f.rows.forEach(function (cells, i) {
        var r = [];
        for (var k = 0; k < Core.HEADER.length; k++) r.push(Core.str(cells[k]));
        r[X['수업일']] = inst; r[X['시간대']] = cls['시간대']; r[X['수업반']] = cls['수업반']; r[X['접수명']] = cls['접수명'];
        r[X['업로드시각']] = at; r[X['업로더']] = user.name; r[X['파일명']] = f.fileName; r[X['순번']] = String(i + 1);
        r[X['처음 올라온 시각']] = seenBefore[r[0]] || at;
        for (var j = 0; j < LIST_HEADER.length; j++) if (r[j] === undefined) r[j] = '';
        list.push(r);
      });
      res.result = '반영'; res.cls = cls['접수명']; res.count = f.rows.length;
      res.detail = f.rows.length + '명 · ' + meta.ts.slice(11, 16) + ' 받은 파일';
      if (p.grade && cls.range && (p.grade.min !== cls.range.min || p.grade.max !== cls.range.max)) {
        res.warning = '예약명 대상학년(' + Core.rangeLabel(p.grade) + ')이 설정(' + cls.rangeText + ')과 다름 — 설정 기준으로 점검';
      }
      logs.push([at, user.name, f.fileName, meta.ts, inst, cls['접수명'], String(f.rows.length), '반영']);
    });

    if (logs.length) {
      appendRows_(SHEET.UPLOADS, logs);
      uploads = uploads.concat(logs);
      refreshSheetView_(ctx, date, list, readStatuses_(), uploads);
      bumpRev_();
    }
    return { results: results, needMap: needMap };
  });
};

function sameHeader_(h) {
  if (!h || h.length < Core.HEADER.length) return false;
  for (var i = 0; i < Core.HEADER.length; i++) if (Core.str(h[i]) !== Core.HEADER[i]) return false;
  return true;
}

API.status = function (req, user) {
  return withLock_(function () {
    var ctx = loadCtx_();
    var date = req.date;
    var key = date + '|' + req.no;
    var statuses = readStatuses_();
    var cur = statuses[key] || null;
    var list = readTable_(SHEET.LIST).rows;
    var view = roundView_(ctx, date, list, statuses);
    var target = view.rows.filter(function (e) { return e.no === req.no; })[0];
    if (!target) throw apiError_('GONE', '이 신청은 최신 명단에 없습니다. 화면을 새로고침해 주세요.');
    var curShown = target.status ? target.status.at : '';
    if ((req.prevAt || '') !== curShown) {
      return { conflict: true, current: target.status, message: target.status ? target.status.who + ' 선생님이 이미 처리했습니다 (' + target.status.at.slice(5, 16) + ')' : '처리 상태가 바뀌었습니다. 다시 확인해 주세요.' };
    }
    var rows = readTable_(SHEET.STATUS).rows;
    if (cur) rows.splice(cur.idx, 1);
    var at = now_();
    if (req.status === 'done' || req.status === 'ok') {
      rows.push([date, req.no, req.status, user.name, at, Core.str(req.memo), target.fp]);
    }
    writeTable_(SHEET.STATUS, rows);
    var statuses2 = readStatuses_();
    refreshSheetView_(ctx, date, list, statuses2, readTable_(SHEET.UPLOADS).rows);
    bumpRev_();
    return { status: req.status ? { s: req.status, who: user.name, at: at, memo: Core.str(req.memo) } : null };
  });
};

API.settings = function () {
  var ctx = loadCtx_();
  return {
    sheetUrl: ss_().getUrl(),
    dates: ctx.dates,
    classes: ctx.classes.map(function (c) { return { '시간대': c['시간대'], '수업반': c['수업반'], '접수명': c['접수명'], keyword: c.keyword, rangeText: c.rangeText, cap: c.cap, from: c.from, to: c.to }; }),
    restrictions: ctx.restrictions,
    mappings: readTable_(SHEET.MAP).rows,
    schoolCount: ctx.schools.length,
    users: readTable_(SHEET.USERS).rows.map(function (r) { return r[1] || r[0]; }),
    hasNeisKey: !!PropertiesService.getScriptProperties().getProperty('NEIS_KEY')
  };
};

API.neis = function () {
  return withLock_(function () {
    var n = importSchoolsFromNeis_();
    bumpRev_();
    return { count: n };
  });
};

/* ───────── NEIS 학교 목록 ───────── */

function importSchoolsFromNeis_() {
  var key = PropertiesService.getScriptProperties().getProperty('NEIS_KEY');
  if (!key) throw apiError_('SETUP', '스크립트 속성 NEIS_KEY가 없습니다.');
  var rows = [];
  for (var page = 1; page <= 10; page++) {
    var url = 'https://open.neis.go.kr/hub/schoolInfo?Type=json&pSize=1000&pIndex=' + page +
      '&ATPT_OFCDC_SC_CODE=H10&KEY=' + encodeURIComponent(key);
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw apiError_('NEIS', 'NEIS 응답 오류 (' + res.getResponseCode() + ')');
    var body = JSON.parse(res.getContentText());
    if (!body.schoolInfo) break;
    var items = body.schoolInfo[1].row || [];
    items.forEach(function (s) {
      var kind = Core.str(s.SCHUL_KND_SC_NM);
      if (/고등학교/.test(kind)) return;
      var lv = /초등/.test(kind) ? '초' : (/중학교/.test(kind) ? '중' : kind);
      rows.push([s.SCHUL_NM, lv, Core.schoolKey(s.SCHUL_NM)]);
    });
    if (items.length < 1000) break;
  }
  if (!rows.length) throw apiError_('NEIS', 'NEIS에서 학교를 가져오지 못했습니다. 인증키를 확인하세요.');
  // 직접 추가한 학교(홈스쿨 등 예외)는 유지
  var manual = readTable_(SHEET.SCHOOLS).rows.filter(function (r) { return /직접/.test(r[1]); });
  writeTable_(SHEET.SCHOOLS, rows.concat(manual));
  return rows.length;
}

/* ───────── 메뉴·초기 설정 (시트에서 실행) ───────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('주말 점검')
    .addItem('초기 설정 (처음 한 번)', 'setupSheets')
    .addItem('NEIS 학교 목록 가져오기', 'menuImportSchools')
    .addToUi();
}

/** 주제·교구 시트 읽기 권한을 허용하기 위해 편집기에서 한 번 실행합니다 */
function checkTopicSheet() {
  var r = API.topics({ date: Core.currentRound(loadCtx_().dates, today_()) || today_() });
  Logger.log(r.error || ('주제·교구 시트 확인: 이번 수업일 수업 ' + r.items.length + '개'));
}

function menuImportSchools() {
  init_();
  var n = importSchoolsFromNeis_();
  SpreadsheetApp.getUi().alert('학교 ' + n + '곳을 가져왔습니다.');
}

function setupSheets() {
  init_();
  var ss = ss_();
  [SHEET.LIST, SHEET.SUMMARY, SHEET.STATUS, SHEET.UPLOADS, SHEET.RESTRICT, SHEET.DATES, SHEET.CLASSES, SHEET.SCHOOLS, SHEET.MAP, SHEET.USERS, SHEET.LINKS, SHEET.ABS, SHEET.ATT]
    .forEach(function (n) { sheet_(n); });

  if (!readTable_(SHEET.USERS).rows.length) {
    var me = Session.getEffectiveUser().getEmail();
    writeTable_(SHEET.USERS, [[me, '관리자']]);
  }
  if (!readTable_(SHEET.DATES).rows.length) {
    writeTable_(SHEET.DATES, [
      ['1', '2026-09-12', '마스터 1기 시작'], ['2', '2026-09-19', ''], ['3', '2026-10-17', ''], ['4', '2026-10-24', ''],
      ['5', '2026-10-31', '마스터 1기 끝'], ['6', '2026-11-07', '마스터 2기 시작'], ['7', '2026-11-14', '메이커반 시작'],
      ['8', '2026-11-21', ''], ['9', '2026-11-28', ''], ['10', '2026-12-05', '마스터 2기 끝']
    ]);
  }
  if (!readTable_(SHEET.CLASSES).rows.length) {
    writeTable_(SHEET.CLASSES, [
      ['오전', '기초 1,2반', '기초 1,2반', '기초코딩 오전반', '초2', '초3', '32', '1', '10', ''],
      ['오전', '탐험', '탐험', '탐험코딩 오전반', '초3', '초5', '16', '1', '10', ''],
      ['오전', '마스터', '마스터', '마스터코딩', '초5', '중2', '12', '1', '10', '5주 연속 (예약명 기간 동안 유지)'],
      ['오후', '창의 1,2반', '창의 1,2반 [1학년]', '', '초1', '초1', '10', '1', '10', '키워드 비움: 첫 업로드 때 연결'],
      ['오후', '창의 1,2반', '창의 1,2반 [2~3학년]', '', '초2', '초3', '22', '1', '10', '키워드 비움: 첫 업로드 때 연결'],
      ['오후', '창의 3,4반', '창의 3,4반', '', '초3', '초6', '32', '1', '6', ''],
      ['오후', '메이커1', '메이커1', '', '초3', '초4', '16', '7', '10', ''],
      ['오후', '메이커2', '메이커2', '', '초4', '초6', '16', '7', '10', '']
    ]);
  }
  // 통합명단: 좁게 둘 열(이메일·단체명·단체인원수·기타내용), 텍스트 서식, 조건부 서식
  var list = sheet_(SHEET.LIST);
  list.getRange(1, 1, 1, LIST_HEADER.length).setValues([LIST_HEADER]).setFontWeight('bold');
  list.setFrozenRows(1);
  Core.HIDDEN_COLS.forEach(function (c) { list.setColumnWidth(c + 1, 24); });
  list.setColumnWidth(2, 220);
  list.setColumnWidth(X['점검결과'] + 1, 260);
  var col = X['점검결과'] + 1;
  var rng = list.getRange(2, col, Math.max(list.getMaxRows() - 1, 1), 1);
  var rules = [
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('취소대상').setBackground('#FDE2DE').setFontColor('#B42318').setRanges([rng]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenTextStartsWith('확인필요').setBackground('#FEF0C7').setFontColor('#7A2E0E').setRanges([rng]).build()
  ];
  list.setConditionalFormatRules(rules);
  // 웹앱이 쓰는 탭은 편집 시 경고
  [SHEET.LIST, SHEET.SUMMARY, SHEET.STATUS, SHEET.UPLOADS].forEach(function (n) {
    var sh = sheet_(n);
    if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) sh.protect().setWarningOnly(true).setDescription('웹앱이 자동으로 채우는 탭입니다');
  });
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('REV')) p.setProperty('REV', '1');
  var def = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  try { SpreadsheetApp.getUi().alert('초기 설정을 마쳤습니다. 설정_수업일·설정_반·점검자 탭을 확인해 주세요.'); } catch (e) { /* 편집기에서 실행 */ }
}
