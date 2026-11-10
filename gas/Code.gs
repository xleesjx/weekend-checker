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
  LINKS: '같은반요청', ABS: '결석기록', ATT: '출석부', SETLOG: '설정변경기록', WAIT: '대기자연락', MARKS: '확인표시'
};
var TOPIC_SHEET_DEFAULT = '165RlpeCfhR9Z4n_Qq2IoPMTXBlkSiUWZMyBBhO77MBw';
var TOPIC_TAB_DEFAULT = '하반기';
// 신청일시·취소시각: 엑셀에는 없고 관리자 화면에만 있는 값 (즐겨찾기 버튼이 화면에서 읽어 함께 보냄)
var EXTRA = ['수업일', '시간대', '수업반', '접수명', '점검결과', '처리상태', '처리자', '처리시각', '메모', '업로드시각', '업로더', '파일명', '순번', '처음 올라온 시각', '신청일시', '취소시각'];
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
  HEADERS[SHEET.SETLOG] = ['시각', '변경자', '항목', '내용'];
  HEADERS[SHEET.WAIT] = ['수업일', '신청일련번호', '결과', '메모', '기록자', '기록시각'];
  HEADERS[SHEET.MARKS] = ['수업일', '종류', '신청일련번호', '기록자', '기록시각'];
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
    TBL_ = {};
    // state는 기억해 둔 결과를 쓸 수 있으면 아예 읽지 않으므로 API.state 안에서 필요할 때만 미리 읽기
    if (req.action !== 'rev' && req.action !== 'state') prefetch_(prefetchFor_(req.action));
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

/* ───────── 빠르게 읽기 ─────────
 * TBL_: 요청 하나 동안 읽은 탭 (같은 탭을 두 번 읽지 않음, 쓰면 바로 갱신)
 * 설정 탭(STATIC_TABS_)은 CacheService에 10분 기억 — 웹앱에서 쓰거나 시트에서 직접 고치면(onEdit) 바로 지움
 * prefetch_: 필요한 탭을 Sheets API 한 번으로 읽음 (편집기 「서비스」에 Google Sheets API가 없으면 예전처럼 하나씩)
 */
var TBL_ = {};
var CACHE_TTL_ = 600;
function staticTabs_() { return [SHEET.USERS, SHEET.DATES, SHEET.CLASSES, SHEET.SCHOOLS, SHEET.MAP, SHEET.RESTRICT]; }
function cacheKey_(name) { return 'T:' + name; }

function tableFromValues_(name, values) {
  var header = values.length ? values[0].map(cellText_) : (HEADERS[name] || []);
  var w = Math.max(header.length, (HEADERS[name] || []).length);
  var rows = values.slice(1).map(function (r) {
    var o = r.map(cellText_);
    while (o.length < w) o.push('');
    return o;
  }).filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  return { header: header, rows: rows };
}

function copyTable_(t) { return { header: t.header.slice(), rows: t.rows.map(function (r) { return r.slice(); }) }; }

function remember_(name, t) {
  TBL_[name] = copyTable_(t);
  if (staticTabs_().indexOf(name) >= 0) {
    try { var js = JSON.stringify(t); if (js.length < 90000) CacheService.getScriptCache().put(cacheKey_(name), js, CACHE_TTL_); } catch (e) { /* 너무 크면 기억 안 함 */ }
  }
}

/** 무엇이든 쓰면 기억해 둔 계산 결과를 못 쓰게 (세대 번호를 올림) */
function cacheGen_() { try { return CacheService.getScriptCache().get('GEN') || '0'; } catch (e) { return '0'; } }
function forget_(name) {
  delete TBL_[name];
  try { CacheService.getScriptCache().put('GEN', String(Date.now()), 21600); } catch (e) { /* 무시 */ }
  if (staticTabs_().indexOf(name) >= 0) { try { CacheService.getScriptCache().remove(cacheKey_(name)); } catch (e) { /* 무시 */ } }
}

function readTable_(name) {
  if (TBL_[name]) return copyTable_(TBL_[name]);
  if (staticTabs_().indexOf(name) >= 0) {
    try {
      var c = CacheService.getScriptCache().get(cacheKey_(name));
      if (c) { TBL_[name] = JSON.parse(c); return copyTable_(TBL_[name]); }
    } catch (e) { /* 다시 읽기 */ }
  }
  var t = tableFromValues_(name, sheet_(name).getDataRange().getValues());
  remember_(name, t);
  return copyTable_(t);
}

/** 여러 탭을 한 번에 읽어 둡니다 (Sheets API). 안 되면 아무 일도 하지 않고, 읽을 때 하나씩 읽습니다. */
function prefetch_(names) {
  if (typeof Sheets === 'undefined' || !Sheets.Spreadsheets || !Sheets.Spreadsheets.Values) return;
  var cache = null;
  try { cache = CacheService.getScriptCache(); } catch (e) { cache = null; }
  var need = names.filter(function (n) { return !TBL_[n] && !(cache && staticTabs_().indexOf(n) >= 0 && cache.get(cacheKey_(n))); });
  if (!need.length) return;
  try {
    var exist = {};
    ss_().getSheets().forEach(function (sh) { exist[sh.getName()] = true; });
    need = need.filter(function (n) { return exist[n]; });
    if (!need.length) return;
    var res = Sheets.Spreadsheets.Values.batchGet(ss_().getId(), {
      ranges: need.map(function (n) { return "'" + n.replace(/'/g, "''") + "'"; }), valueRenderOption: 'FORMATTED_VALUE', majorDimension: 'ROWS'
    });
    (res.valueRanges || []).forEach(function (vr, i) { remember_(need[i], tableFromValues_(need[i], vr.values || [])); });
  } catch (e) { /* 하나씩 읽기로 */ }
}

/** 요청마다 미리 읽을 탭 */
function prefetchFor_(action) {
  var cfg = [SHEET.USERS, SHEET.DATES, SHEET.CLASSES, SHEET.SCHOOLS, SHEET.MAP, SHEET.RESTRICT, SHEET.ABS];
  var map = {
    state: cfg.concat([SHEET.LIST, SHEET.STATUS, SHEET.UPLOADS, SHEET.ATT, SHEET.LINKS, SHEET.MARKS, SHEET.WAIT]),
    status: cfg.concat([SHEET.LIST, SHEET.STATUS, SHEET.UPLOADS]),
    upload: cfg.concat([SHEET.LIST, SHEET.STATUS, SHEET.UPLOADS]),
    settings: cfg.concat([SHEET.SETLOG]),
    settingsSave: cfg
  };
  return map[action] || [SHEET.USERS];
}

/** 시트를 직접 고치면(편집기·시트 화면) 기억해 둔 설정을 지우고 웹앱이 새로 불러오게 합니다 (단순 트리거) */
function onEdit(e) {
  try {
    var name = e && e.range ? e.range.getSheet().getName() : '';
    init_();
    if (name) forget_(name);
    bumpRev_();
  } catch (err) { /* 무시 */ }
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
  if (sh.getMaxColumns && sh.getMaxColumns() < header.length) sh.insertColumnsAfter(sh.getMaxColumns(), header.length - sh.getMaxColumns());
  var rg = sh.getRange(1, 1, all.length, header.length);
  rg.setNumberFormat('@');
  rg.setValues(all);
  // 이번 요청 안에서는 방금 쓴 내용을 그대로 기억 (다시 읽지 않음), 설정 탭은 서버 기억을 지움
  forget_(name);
  TBL_[name] = { header: header.slice(), rows: rows.map(function (r) { var o = []; for (var i = 0; i < header.length; i++) o.push(r[i] === undefined || r[i] === null ? '' : String(r[i])); return o; }) };
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
  forget_(name);
}

/* ───────── 설정 읽기 ───────── */

function parseSheetDate_(s, year) {
  var t = Core.str(s);
  var m = /^(\d{4})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{1,2})/.exec(t);
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
    restrictions.push({ absent: r[1], name: Core.str(r[3]), school: Core.str(r[4]), reason: Core.str(r[9]) || '결석', date: Core.nextClassDate(dates, r[1]), memo: Core.str(r[11]), cancelAt: Core.str(r[10]),
      no: Core.str(r[2]), ban: Core.str(r[5]), cls: Core.str(r[6]), phone: Core.str(r[7]) });
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
    rows.push({ idx: i, no: r[0], row: r.slice(0, Core.HEADER.length), cls: cls, inst: r[X['수업일']], seq: +r[X['순번']] || 0, firstSeen: r[X['처음 올라온 시각']] || '',
      appliedAt: r[X['신청일시']] || '', cancelAt: r[X['취소시각']] || '' });
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
  var rev0 = API.rev().rev, key = 'S:' + (req.date || '') + ':' + rev0 + ':' + cacheGen_() + ':' + today_();
  var hit = stateCacheGet_(key);
  if (hit) { hit.user = user; return hit; }
  prefetch_(prefetchFor_('state'));
  var res = stateBuild_(req, user);
  if (API.rev().rev === rev0) stateCachePut_(key, res);
  return res;
};

function stateCacheGet_(key) {
  try {
    var c = CacheService.getScriptCache().get(key);
    if (!c) return null;
    return JSON.parse(Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(c), 'application/x-gzip')).getDataAsString());
  } catch (e) { return null; }
}

function stateCachePut_(key, res) {
  try {
    var copy = {}; Object.keys(res).forEach(function (k) { if (k !== 'user') copy[k] = res[k]; });
    var z = Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(JSON.stringify(copy), 'application/json')).getBytes());
    if (z.length < 95000) CacheService.getScriptCache().put(key, z, CACHE_TTL_);
  } catch (e) { /* 기억 못 해도 괜찮음 */ }
}

function stateBuild_(req, user) {
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
    return { no: e.no, cells: e.row, cls: e.cls ? e.cls['접수명'] : '', inst: e.inst, seq: e.seq, issues: e.issues, level: e.level, appliedAt: e.appliedAt, cancelAt: e.cancelAt,
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
  // 이번 회차 신청 제한 명단 (점검 목록 맨 위 카드)
  // 이번 회차 신청 제한 명단 (민원 대응용으로 자세히: 학반·신청자·연락처·신청했던 반은 그때 명단에서)
  var byNo = {};
  list.forEach(function (r) { byNo[r[0]] = r; });
  out.restrictions = ctx.restrictions.filter(function (r) { return r.date === date; }).map(function (r) {
    var src = r.no ? byNo[r.no] : null;
    return { name: r.name, school: r.school, reason: r.reason, absent: r.absent, memo: r.memo, cancelAt: r.cancelAt || '',
      ban: r.ban || (src ? src[11] : ''), parent: src ? src[2] : '', phone: (src ? src[3] : '') || r.phone || '',
      cls: src ? (src[X['수업반']] || src[X['접수명']]) : (r.cls || '') };
  });
  out.cancelRule = cancelRule_();
  out.openRule = openRule_();
  out.marks = readTable_(SHEET.MARKS).rows.filter(function (r) { return r[0] === date; }).map(function (r) { return { kind: r[1], no: r[2], by: r[3] }; });
  out.waitLogs = readTable_(SHEET.WAIT).rows.filter(function (r) { return r[0] === date; }).map(function (r) { return { no: r[1], result: r[2], memo: r[3], by: r[4], at: r[5] }; });
  out.rooms = rooms_();
  var att = readAtt_();
  out.att = att.filter(function (a) { return a.date === date; }).pop() || null;
  out.attPrev = att.filter(function (a) { return a.date < date; }).pop() || null;
  if (out.attPrev) out.attPrev = { date: out.attPrev.date, blocks: (out.attPrev.data.blocks || []).map(function (b) {
    var o = {};
    Object.keys(b).forEach(function (k) { if (k !== 'students') o[k] = b[k]; });
    return o;
  }) };
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
    var group = readLinks_().filter(function (g) { return g.id === id; })[0] || null;
    return { id: id, group: group, rev: bumpRev_() };
  });
};

API.linkRemove = function (req) {
  return withLock_(function () {
    writeTable_(SHEET.LINKS, readTable_(SHEET.LINKS).rows.filter(function (r) { return r[0] !== req.id; }));
    return { rev: bumpRev_() };
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
    return { id: id, rev: bumpRev_() };
  });
};

/** 기한 후 취소 기준: 수업일 days일 전 time 이후에 취소하면 「기한 후 취소」 후보 (점검자 모두 같은 기준) */
function cancelRule_() {
  try {
    var r = JSON.parse(PropertiesService.getScriptProperties().getProperty('CANCEL_RULE') || 'null');
    if (r && r.days >= 0 && /^\d{2}:\d{2}$/.test(r.time)) return { days: +r.days, time: r.time, by: r.by || '', at: r.at || '' };
  } catch (e) { /* 기본값 */ }
  return { days: 2, time: '16:00', by: '', at: '', isDefault: true };  // 운영 규정: 수업 2일 전(목) 16:00까지 취소
}

/** 접수 시작: 수업일 days일 전 time (주말 프로그램: 화 10:00 = 4일 전) — 맨 위 안내줄의 단계 구분에 씀 */
function openRule_() {
  try {
    var r = JSON.parse(PropertiesService.getScriptProperties().getProperty('OPEN_RULE') || 'null');
    if (r && r.days >= 0 && /^\d{2}:\d{2}$/.test(r.time)) return { days: +r.days, time: r.time, by: r.by || '', at: r.at || '' };
  } catch (e) { /* 기본값 */ }
  return { days: 4, time: '10:00', by: '', at: '', isDefault: true };
}

API.openRule = function (req, user) {
  var days = Math.floor(+req.days), time = Core.str(req.time);
  if (!(days >= 0 && days <= 30) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw apiError_('BAD', '접수 시작을 확인해 주세요 (0~30일 전, 00:00~23:59).');
  return withLock_(function () {
    var r = { days: days, time: time, by: user.name, at: now_() };
    PropertiesService.getScriptProperties().setProperty('OPEN_RULE', JSON.stringify(r));
    appendRows_(SHEET.SETLOG, [[r.at, user.name, '접수 시작', '수업 ' + days + '일 전 ' + time]]);
    return { rule: r, rev: bumpRev_() };
  });
};

/** 토요일 아침 대기자 연락 결과 (참석 확정·불참·연락 안 됨) — 점검자끼리 공유. result가 비면 지움 */
API.waitLog = function (req, user) {
  var RESULTS = ['참석 확정', '불참', '연락 안 됨'];
  if (!req.date || !/^\d{1,12}$/.test(Core.str(req.no))) throw apiError_('BAD', '대상이 없습니다.');
  if (req.result && RESULTS.indexOf(req.result) < 0) throw apiError_('BAD', '결과를 확인해 주세요.');
  return withLock_(function () {
    var rows = readTable_(SHEET.WAIT).rows.filter(function (r) { return !(r[0] === req.date && r[1] === Core.str(req.no)); });
    var rec = null;
    if (req.result) { rec = [req.date, Core.str(req.no), req.result, Core.str(req.memo).slice(0, 200), user.name, now_()]; rows.push(rec); }
    writeTable_(SHEET.WAIT, rows);
    return { rev: bumpRev_(), log: rec ? { no: rec[1], result: rec[2], memo: rec[3], by: rec[4], at: rec[5] } : null };
  });
};

/**
 * 점검자끼리 공유하는 확인 표시: keep = 출석부 변동 사항 [그대로 두기]·[나중에], skip = 기한 후 취소 후보 [제외]
 * on=false 이고 no='*' 이면 그 종류를 모두 지움
 */
API.mark = function (req, user) {
  var KINDS = ['keep', 'skip'], no = Core.str(req.no);
  if (!req.date || KINDS.indexOf(req.kind) < 0 || !(/^\d{1,12}$/.test(no) || (no === '*' && !req.on))) throw apiError_('BAD', '대상이 없습니다.');
  return withLock_(function () {
    var rows = readTable_(SHEET.MARKS).rows.filter(function (r) { return !(r[0] === req.date && r[1] === req.kind && (no === '*' || r[2] === no)); });
    if (req.on) rows.push([req.date, req.kind, no, user.name, now_()]);
    writeTable_(SHEET.MARKS, rows);
    return { rev: bumpRev_() };
  });
};

API.cancelRule = function (req, user) {
  var days = Math.floor(+req.days), time = Core.str(req.time);
  if (!(days >= 0 && days <= 14) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw apiError_('BAD', '기준을 확인해 주세요 (0~14일 전, 00:00~23:59).');
  return withLock_(function () {
    var r = { days: days, time: time, by: user.name, at: now_() };
    PropertiesService.getScriptProperties().setProperty('CANCEL_RULE', JSON.stringify(r));
    appendRows_(SHEET.SETLOG, [[r.at, user.name, '취소 기한', '수업 ' + days + '일 전 ' + time + ' 이후 취소 = 기한 후 취소']]);
    return { rule: r, rev: bumpRev_() };
  });
};

API.absDelete = function (req) {
  return withLock_(function () {
    writeTable_(SHEET.ABS, readTable_(SHEET.ABS).rows.filter(function (r) { return r[0] !== req.id; }));
    return { rev: bumpRev_() };
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
    var last = prev.length ? prev[prev.length - 1] : null;
    // 고치기 시작한 차수(baseVersion) 뒤에 다른 점검자가 먼저 저장했으면 덮어쓰지 않습니다
    if (req.baseVersion !== undefined && req.baseVersion !== null && (last ? last.version : 0) !== +req.baseVersion) {
      throw apiError_('CONFLICT', last ? last.by + ' 선생님이 ' + String(last.at).slice(5, 16) + '에 ' + last.version + '차를 먼저 저장했습니다. 새로 불러온 출석부에서 다시 확인해 주세요.' : '출석부가 바뀌었습니다. 새로 불러와 주세요.');
    }
    var version = last ? last.version + 1 : 1;
    var at = now_();
    appendRows_(SHEET.ATT, [[req.date, String(version), at, user.name, json]]);
    bumpRev_();
    return { version: version, at: at, by: user.name };
  });
};

/** 웹앱에서 인쇄한 반 기록: 그 차수 저장본에 { 반: 인쇄한 차수 }를 덧붙입니다 (새 차수를 만들지 않음) */
API.attPrinted = function (req) {
  return withLock_(function () {
    var sh = sheet_(SHEET.ATT), values = sh.getDataRange().getValues();
    for (var i = values.length - 1; i >= 1; i--) {
      if (cellText_(values[i][0]) !== req.date || +values[i][1] !== +req.version) continue;
      var data = {};
      try { data = JSON.parse(values[i][4]); } catch (e) { return {}; }
      data.printed = data.printed || {};
      (req.keys || []).slice(0, 50).forEach(function (k) { data.printed[String(k)] = +req.version; });
      sh.getRange(i + 1, 5).setValue(JSON.stringify(data));
      return { rev: bumpRev_() };
    }
    return {};
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

/** 화면에서 읽은 값 검사: { 신청일련번호: { a: 'YYYY-MM-DD HH:MM:SS', c: 같은 형식 } } */
function cleanExtras_(x) {
  var out = {}, n = 0, re = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;
  if (!x || typeof x !== 'object') return out;
  Object.keys(x).forEach(function (k) {
    if (n > 5000 || !/^\d{1,12}$/.test(k) || !x[k] || typeof x[k] !== 'object') return;
    var a = Core.str(x[k].a), c = Core.str(x[k].c);
    out[k] = { a: re.test(a) ? a : '', c: re.test(c) ? c : '' };
    n++;
  });
  return out;
}

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
    var extras = cleanExtras_(req.extras);

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

      var seenBefore = {}, known = {};
      list.forEach(function (r) {
        if (r[X['수업일']] !== inst || r[X['접수명']] !== cls['접수명']) return;
        seenBefore[r[0]] = r[X['처음 올라온 시각']] || r[X['업로드시각']];
        known[r[0]] = { a: r[X['신청일시']] || '', c: r[X['취소시각']] || '' };
      });
      list = list.filter(function (r) { return !(r[X['수업일']] === inst && r[X['접수명']] === cls['접수명']); });
      f.rows.forEach(function (cells, i) {
        var r = [];
        for (var k = 0; k < Core.HEADER.length; k++) r.push(Core.str(cells[k]));
        r[X['수업일']] = inst; r[X['시간대']] = cls['시간대']; r[X['수업반']] = cls['수업반']; r[X['접수명']] = cls['접수명'];
        r[X['업로드시각']] = at; r[X['업로더']] = user.name; r[X['파일명']] = f.fileName; r[X['순번']] = String(i + 1);
        r[X['처음 올라온 시각']] = seenBefore[r[0]] || at;
        // 화면에서 읽은 신청일시·취소시각 (이번에 못 읽었으면 전에 알던 값 유지, 예약취소가 풀리면 취소시각 지움)
        var ex = extras[r[0]] || {}, old = known[r[0]] || {};
        r[X['신청일시']] = ex.a || old.a || '';
        r[X['취소시각']] = r[12] === '예약취소' ? (ex.c || old.c || '') : '';
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
    return { status: req.status ? { s: req.status, who: user.name, at: at, memo: Core.str(req.memo) } : null, fp: target.fp, rev: bumpRev_() };
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
    edit: {
      dates: readTable_(SHEET.DATES).rows.map(function (r) { return [r[0], parseSheetDate_(r[1], ctx.year) || r[1], r[2] || '']; }),
      classes: readTable_(SHEET.CLASSES).rows.map(function (r) { var o = []; for (var i = 0; i < 10; i++) o.push(r[i] || ''); return o; }),
      users: readTable_(SHEET.USERS).rows.map(function (r) { return [r[0], r[1] || '']; }),
      restrict: readTable_(SHEET.RESTRICT).rows.map(function (r) { return [parseSheetDate_(r[0], ctx.year) || r[0], r[1] || '', r[2] || '', r[3] || '', parseSheetDate_(r[4], ctx.year) || r[4] || '', r[5] || '', r[6] || '']; }),
      map: readTable_(SHEET.MAP).rows.map(function (r) { return [r[0], r[1] || '', r[2] || '', r[3] || '']; }),
      rooms: rooms_().map(function (x) { return [x]; })
    },
    cancelRule: cancelRule_(),
    openRule: openRule_(),
    log: readTable_(SHEET.SETLOG).rows.slice(-15).reverse(),
    hasNeisKey: !!PropertiesService.getScriptProperties().getProperty('NEIS_KEY')
  };
};

function rooms_() {
  try { var r = JSON.parse(PropertiesService.getScriptProperties().getProperty('ROOMS') || 'null'); if (Array.isArray(r) && r.length) return r; } catch (e) { /* 기본값 */ }
  return ['라온실', '혜윰실', '놀이실', '창의실', 'SW체험교실'];
}

var GRADE_RE_ = /^(초[1-6]|중[1-3]|고[1-3])$/;
var DATE_RE_ = /^\d{4}-\d{2}-\d{2}$/;
function dateOk_(d) { if (!DATE_RE_.test(d)) return false; var t = new Date(d + 'T00:00:00Z'); return !isNaN(t) && t.toISOString().slice(0, 10) === d; }

/**
 * 웹앱 설정 메뉴에서 표 하나를 통째로 저장합니다. 점검자 누구나 바꿀 수 있고, 바꾼 기록은 「설정변경기록」 탭에 남습니다.
 * tab: dates | classes | users | restrict | map | rooms | schoolAdd
 */
API.settingsSave = function (req, user) {
  var tab = req.tab, rows = Array.isArray(req.rows) ? req.rows : [];
  var clean = rows.map(function (r) { return (Array.isArray(r) ? r : []).map(function (c) { return Core.str(c).slice(0, 200); }); })
    .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
  var errs = [];
  var need = function (ok, msg) { if (!ok && errs.length < 8) errs.push(msg); };
  var label = { dates: '수업일', classes: '반', users: '점검자', restrict: '신청제한 명단', map: '예약명 연결', rooms: '교실', schoolAdd: '학교 추가' }[tab];
  if (!label) throw apiError_('BAD', '알 수 없는 설정입니다.');
  if (clean.length > 500) throw apiError_('BAD', '줄이 너무 많습니다.');
  var seen = {};
  if (tab === 'dates') {
    clean.forEach(function (r, i) {
      need(/^\d{1,3}$/.test(r[0]), (i + 1) + '번째 줄: 회차는 숫자로 적어 주세요.');
      need(dateOk_(r[1]), (i + 1) + '번째 줄: 수업일 날짜를 확인해 주세요.');
      need(!seen[r[1]], (i + 1) + '번째 줄: 같은 수업일(' + r[1] + ')이 두 번 있습니다.'); seen[r[1]] = 1;
    });
    clean.sort(function (a, b) { return a[1] < b[1] ? -1 : 1; });
  } else if (tab === 'classes') {
    clean.forEach(function (r, i) {
      var n = (i + 1) + '번째 줄: ';
      need(r[0] === '오전' || r[0] === '오후', n + '시간대는 오전·오후 중 하나입니다.');
      need(r[1], n + '수업반 이름을 적어 주세요.');
      var key = r[2] || r[1];
      need(!seen[key], n + '접수명 「' + key + '」이 두 번 있습니다.'); seen[key] = 1;
      need(GRADE_RE_.test(r[4]) && (!r[5] || GRADE_RE_.test(r[5])), n + '대상 학년을 골라 주세요.');
      need(!r[6] || /^\d{1,3}$/.test(r[6]), n + '정원은 숫자입니다.');
      need((!r[7] || /^\d{1,3}$/.test(r[7])) && (!r[8] || /^\d{1,3}$/.test(r[8])), n + '시작·끝 회차는 숫자입니다.');
    });
  } else if (tab === 'users') {
    clean.forEach(function (r, i) {
      r[0] = r[0].toLowerCase();
      need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r[0]), (i + 1) + '번째 줄: 이메일을 확인해 주세요.');
      need(r[1], (i + 1) + '번째 줄: 이름을 적어 주세요.');
      need(!seen[r[0]], (i + 1) + '번째 줄: 같은 이메일이 두 번 있습니다.'); seen[r[0]] = 1;
    });
    need(seen[String(user.email).toLowerCase()], '내 이메일(' + user.email + ')은 지울 수 없습니다. 지우면 바로 접속이 막힙니다.');
  } else if (tab === 'restrict') {
    clean.forEach(function (r, i) {
      need(dateOk_(r[0]), (i + 1) + '번째 줄: 결석 수업일 날짜를 확인해 주세요.');
      need(r[1], (i + 1) + '번째 줄: 학생명을 적어 주세요.');
      need(!r[4] || dateOk_(r[4]), (i + 1) + '번째 줄: 제한 수업일 날짜를 확인해 주세요 (비우면 자동).');
      if (!r[6]) r[6] = user.name;
    });
  } else if (tab === 'map') {
    var names = {};
    loadCtx_().classes.forEach(function (c) { names[c['접수명']] = 1; });
    clean.forEach(function (r, i) {
      need(r[0], (i + 1) + '번째 줄: 예약명을 적어 주세요.');
      need(names[r[1]], (i + 1) + '번째 줄: 접수명 「' + r[1] + '」이 반 설정에 없습니다.');
      if (!r[2]) { r[2] = user.name; r[3] = now_(); }
    });
  } else if (tab === 'rooms') {
    clean.forEach(function (r, i) { need(!seen[r[0]], (i + 1) + '번째 줄: 같은 교실 이름이 두 번 있습니다.'); seen[r[0]] = 1; });
    need(clean.length && clean.length <= 30, '교실은 1~30개까지 적을 수 있습니다.');
  } else if (tab === 'schoolAdd') {
    clean.forEach(function (r, i) {
      need(/(초등학교|중학교|고등학교)$/.test(r[0]), (i + 1) + '번째 줄: 학교 정식 이름(…초등학교·중학교·고등학교)으로 적어 주세요.');
    });
  }
  if (errs.length) throw apiError_('BAD', errs.join('\n'));
  return withLock_(function () {
    var sheetOf = { dates: SHEET.DATES, classes: SHEET.CLASSES, users: SHEET.USERS, restrict: SHEET.RESTRICT, map: SHEET.MAP };
    var detail = clean.length + '줄 저장';
    if (tab === 'rooms') PropertiesService.getScriptProperties().setProperty('ROOMS', JSON.stringify(clean.map(function (r) { return r[0]; })));
    else if (tab === 'schoolAdd') {
      var have = {};
      readTable_(SHEET.SCHOOLS).rows.forEach(function (r) { have[r[0]] = 1; });
      var add = clean.filter(function (r) { return !have[r[0]]; }).map(function (r) {
        var lv = Core.schoolLevel(r[0]) || '';
        return [r[0], lv || '고', Core.schoolKey(r[0])];
      });
      appendRows_(SHEET.SCHOOLS, add);
      detail = add.map(function (r) { return r[0]; }).join(', ') + ' 추가';
    } else writeTable_(sheetOf[tab], clean);
    appendRows_(SHEET.SETLOG, [[now_(), user.name, label, detail]]);
    return { rev: bumpRev_(), rows: clean.length };
  });
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
  [SHEET.LIST, SHEET.SUMMARY, SHEET.STATUS, SHEET.UPLOADS, SHEET.RESTRICT, SHEET.DATES, SHEET.CLASSES, SHEET.SCHOOLS, SHEET.MAP, SHEET.USERS, SHEET.LINKS, SHEET.ABS, SHEET.ATT, SHEET.SETLOG, SHEET.WAIT, SHEET.MARKS]
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
