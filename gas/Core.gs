/*
 * 주말 신청 점검 — 공통 판정 로직
 * 브라우저(docs/core.js)와 Apps Script(gas/Core.gs)에서 같은 내용으로 사용합니다.
 * gas/Core.gs 는 이 파일을 그대로 복사한 것입니다 (npm run build 또는 cp).
 */
var Core = (function () {
  'use strict';

  var HEADER = ['신청일련번호', '예약명', '신청자명', '연락처', '이메일', '단체신청여부', '단체명', '단체인원수', '기타내용', '학생명', '학교명', '학반', '대기여부', '신청자아이디'];
  var C = {};
  HEADER.forEach(function (h, i) { C[h] = i; });
  // 웹 화면에서 기본으로 감추는 원본 열 (이메일, 단체명, 단체인원수, 기타내용)
  var HIDDEN_COLS = [4, 6, 7, 8];

  // 브라우저에 따라 '통합예약신청자목록.xls', '통합예약신청자목록 (1).xls' 또는 이름에 받은 시각이 붙은 형식으로 저장됩니다
  var LIST_RE = /^통합예약신청자목록(?:\s*-\s*\d{4}-\d{2}-\d{2}T\d{6}\.\d{3})?(?:\s*\(\d+\))?\.xls$/;
  var FILE_RE = /^통합예약신청자목록\s*-\s*(\d{4})-(\d{2})-(\d{2})T(\d{2})(\d{2})(\d{2})\.(\d{3})(?:\s*\(\d+\))?\.xls$/;
  var TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;
  var DATE_RE = /(\d{1,2})\s*월\s*(\d{1,2})\s*일(?:\s*~\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일)?/;
  var HOMESCHOOL_RE = /홈\s*스쿨|학교\s*밖|대안|미취학|해당\s*없음|없음/;
  var WINDOW_DAYS = 6;
  var CANCELLED = '예약취소';

  var ISSUE = {
    DUP: { level: 'red', label: '중복 신청' },
    GROUP: { level: 'red', label: '단체 신청' },
    GRADE: { level: 'red', label: '대상 학년 확인' },
    OUTSIDE: { level: 'red', label: '관외 학교' },
    RESTRICT: { level: 'red', label: '신청 제한 학생' },
    INPUT: { level: 'amber', label: '입력 내용 오류' },
    PARENT: { level: 'amber', label: '학부모 연락처 필요' }
  };

  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }

  function addDays(dateStr, n) {
    var p = dateStr.split('-');
    var t = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000);
    return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }

  function shortDate(dateStr) {
    if (!dateStr) return '';
    var p = dateStr.split('-');
    return (+p[1]) + '/' + (+p[2]);
  }

  /** 파일 이름에서 다운로드 날짜·시각을 읽습니다. 형식이 다르면 null. */
  function parseFileName(name) {
    var m = FILE_RE.exec(str(name));
    if (!m) return null;
    return {
      date: m[1] + '-' + m[2] + '-' + m[3],
      ts: m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + '.' + m[7]
    };
  }

  function isListFile(name) { return LIST_RE.test(str(name)); }

  /** 밀리초 시각 → 한국 시각 'YYYY-MM-DDTHH:MM:SS.mmm' */
  function tsFromMillis(ms) {
    var k = new Date(+ms + 9 * 3600000);
    return ymd(k.getUTCFullYear(), k.getUTCMonth() + 1, k.getUTCDate()) + 'T' + pad2(k.getUTCHours()) + ':' + pad2(k.getUTCMinutes()) + ':' +
      pad2(k.getUTCSeconds()) + '.' + ('00' + k.getUTCMilliseconds()).slice(-3);
  }

  /** 명단 파일의 받은 날짜·시각. 이름에 시각이 있으면 그것을, 없으면 파일 저장 시각을 씁니다. 명단 파일이 아니면 null */
  function fileStamp(name, lastModified) {
    if (!isListFile(name)) return null;
    var p = parseFileName(name);
    if (p) return p;
    if (!lastModified) return null;
    var ts = tsFromMillis(lastModified);
    return { date: ts.slice(0, 10), ts: ts };
  }

  function validTs(ts) { return TS_RE.test(str(ts)); }

  /** 파일 날짜가 수업일 6일 전 ~ 수업일 안에 있는지 */
  function inWindow(fileDate, classDate) {
    return fileDate >= addDays(classDate, -WINDOW_DAYS) && fileDate <= classDate;
  }

  /** '초5' → 5, '중2' → 8, '3' → 3 (기본 학교급 적용) */
  function parseGradeToken(s, defaultLevel) {
    var t = str(s).replace(/학년/g, '');
    var m = /^(초|중|고)?\s*(\d)/.exec(t);
    if (!m) return null;
    var lv = m[1] || defaultLevel || '초';
    var n = +m[2];
    return { level: lv, value: lv === '중' ? n + 6 : (lv === '고' ? n + 9 : n) };
  }

  /** '초3~5학년', '초5~중2학년', '1학년', '2~3' → {min, max} */
  function parseGradeRange(text) {
    var t = str(text).replace(/학년/g, '').replace(/\s/g, '');
    if (!t) return null;
    var parts = t.split('~');
    var a = parseGradeToken(parts[0], '초');
    if (!a) return null;
    var b = parts[1] ? parseGradeToken(parts[1], a.level) : a;
    if (!b) return null;
    return { min: Math.min(a.value, b.value), max: Math.max(a.value, b.value) };
  }

  function gradeLabel(n) {
    if (n <= 6) return '초' + n;
    if (n <= 9) return '중' + (n - 6);
    return '고' + (n - 9);
  }

  function rangeLabel(r) {
    if (!r) return '';
    return r.min === r.max ? gradeLabel(r.min) : gradeLabel(r.min) + '~' + gradeLabel(r.max);
  }

  /** 예약명에서 날짜(또는 기간), 대상학년, 날짜를 뺀 연결용 키를 읽습니다. */
  function parseTitle(title, year) {
    var t = str(title);
    var m = DATE_RE.exec(t);
    var out = { start: null, end: null, grade: null, key: '' };
    if (m && year) {
      out.start = ymd(+year, +m[1], +m[2]);
      if (m[3]) {
        var y2 = +m[3] < +m[1] ? +year + 1 : +year;
        out.end = ymd(y2, +m[3], +m[4]);
      }
    }
    var b = /\[([^\]]*)\]/.exec(t);
    if (b) out.grade = parseGradeRange(b[1]);
    out.key = t.replace(DATE_RE, '').replace(/\s+/g, '');
    return out;
  }

  function normSchool(s) { return str(s).replace(/\s+/g, ''); }
  var REGION_RE = /^(울산|울주)/;
  var LEVEL_SUFFIX_RE = /(초등학교|초교|초|중학교|중|고등학교|고|학교)$/;

  /**
   * 학교 비교용 앞 두 글자. 공식 이름 앞의 지역명(울산·울주)은 빼고 봅니다.
   * 울산중앙중(학교) / 중앙중 → '중앙', 울주명지초 / 명지초 → '명지'
   * 단, 지역명 뒤가 학교급뿐이면(울산초, 울산중) 그대로 '울산'
   */
  function schoolKey(s) {
    var t = normSchool(s);
    if (REGION_RE.test(t) && t.slice(2).replace(LEVEL_SUFFIX_RE, '').length >= 1) t = t.slice(2);
    return t.slice(0, 2);
  }

  function schoolLevel(s) {
    var t = normSchool(s);
    if (/(초등학교|초교|초)$/.test(t)) return '초';
    if (/(중학교|중)$/.test(t)) return '중';
    if (/(고등학교|고)$/.test(t)) return '고';
    return null;
  }

  /** 학교 목록 → { 앞두글자: {초:true, 중:true ...} } */
  function buildSchoolIndex(schools) {
    var idx = {};
    (schools || []).forEach(function (s) {
      var k = schoolKey(s.name);
      if (k.length < 2) return;
      if (!idx[k]) idx[k] = {};
      var lv = s.level || schoolLevel(s.name) || '기타';
      idx[k][lv] = true;
    });
    return idx;
  }

  /** 학부모가 쓴 학교명 → 학교 목록의 정식 이름. 하나로 정해지지 않으면 ok:false (출석부와 점검 목록이 같이 씀) */
  function officialSchool(raw, schools) {
    var t = normSchool(raw);
    if (!t) return { name: '', ok: false, cands: [] };
    var exact = (schools || []).filter(function (s) { return normSchool(s.name) === t; });
    if (exact.length) return { name: exact[0].name, ok: true };
    var key = schoolKey(t);
    var lv = schoolLevel(t);
    var cands = (schools || []).filter(function (s) {
      if (schoolKey(s.name) !== key) return false;
      if (!lv) return true;
      return (s.level || schoolLevel(s.name)) === lv;
    });
    // 학교급(초·중) 없이 줄여 쓴 이름은 후보가 하나여도 확인 필요 (예: '옥동')
    if (cands.length === 1 && lv) return { name: cands[0].name, ok: true };
    return { name: str(raw), ok: false, cands: cands.map(function (s) { return s.name; }) };
  }

  /** 학반 → '3-2'. 반이 없으면 1반. 형식을 알 수 없으면 ok:false */
  function normalizeBan(raw) {
    var t = str(raw).replace(/^(초등?|중학?|초|중)\s*/, '');
    var m = /^(\d)\s*학년\s*(\d{1,2})\s*반?$/.exec(t) ||
      /^(\d)\s*[-ㅡ—–.~_/,·\s]\s*(\d{1,2})\s*반?$/.exec(t) ||
      /^(\d)(\d{1,2})$/.exec(t);
    if (m && +m[2] >= 1) return { ban: m[1] + '-' + (+m[2]), ok: true };
    m = /^(\d)\s*(학년)?$/.exec(t);
    if (m) return { ban: m[1] + '-1', ok: true };
    return { ban: str(raw), ok: false };
  }

  function looksLikeSchool(s, idx) {
    var t = normSchool(s);
    if (t.length < 2) return false;
    if (/초등|중학|학교|초교/.test(t)) return true;
    return /[초중]$/.test(t) && t.length >= 3 && !!idx[schoolKey(t)];
  }

  function looksLikeGrade(s) { return /^(초|중)?\s*\d/.test(str(s)); }

  /** 학생명·학교명·학반 세 칸을 해석합니다. 순서가 바뀌어도 최대한 복원합니다. */
  function interpret(row, idx) {
    var raw = [str(row[C['학생명']]), str(row[C['학교명']]), str(row[C['학반']])];
    var problems = [];
    var cells = [];
    var role = raw.map(function (v) {
      if (!v) return 'empty';
      if (HOMESCHOOL_RE.test(v)) return 'home';
      if (looksLikeSchool(v, idx)) return 'school';
      if (looksLikeGrade(v)) return 'grade';
      return 'name';
    });
    var name = '', school = '', grade = '', home = '';
    role.forEach(function (r, i) {
      if (r === 'school' && !school) school = raw[i];
      else if (r === 'home' && !home) home = raw[i];
      else if (r === 'grade' && !grade) grade = raw[i];
      else if (r === 'name' && !name) name = raw[i];
    });
    // 학교로 보이는 칸이 없으면 학교명 칸 값을 학교로 봅니다 (관외 판정용)
    if (!school && !home && role[1] === 'name') { school = raw[1]; if (name === raw[1]) name = role[0] === 'name' ? raw[0] : ''; }
    if (!name && role[0] === 'name') name = raw[0];

    var ordered = (role[0] === 'name') && (role[1] === 'school' || role[1] === 'home' || role[1] === 'name') && role[2] === 'grade';
    if (role[0] === 'empty') { problems.push('학생명 누락'); cells.push(C['학생명']); }
    if (role[1] === 'empty') { problems.push('학교명 누락'); cells.push(C['학교명']); }
    if (role[2] === 'empty') { problems.push('학반 누락'); cells.push(C['학반']); }
    if (!ordered && problems.length === 0) {
      problems.push('학생명·학교명·학반 순서가 맞지 않음');
      cells.push(C['학생명'], C['학교명'], C['학반']);
    } else if (!ordered) {
      if (role[0] === 'school' || role[0] === 'grade') { problems.push('학생명 칸에 ' + (role[0] === 'school' ? '학교 이름' : '학년') + '이 들어감'); cells.push(C['학생명']); }
    }
    if (name) {
      if (name.length < 2 || name.length > 4) { problems.push('학생명 글자 수 확인 (' + name + ')'); cells.push(C['학생명']); }
      else if (/[0-9A-Za-z]/.test(name)) { problems.push('학생명에 숫자·영문 포함'); cells.push(C['학생명']); }
    }
    return { name: name, school: school, grade: grade, home: home, problems: problems, cells: cells, ordered: ordered };
  }

  function addIssue(list, code, detail, cells) {
    list.push({ code: code, level: ISSUE[code].level, label: ISSUE[code].label, detail: detail || '', cells: cells || [] });
  }

  /**
   * 한 회차의 신청 전체를 점검합니다.
   * entries: [{ no, row(14칸), cls: {시간대, 수업반, 접수명, range:{min,max}} }]
   * ctx: { schools:[{name, level}], restrictions:[{date, name, school}] }
   * date: 'YYYY-MM-DD' (점검하는 수업일)
   * 반환: { [no]: { issues:[], name, schoolKey, grade, fp } }
   */
  function analyzeRound(entries, ctx, date) {
    var idx = buildSchoolIndex(ctx.schools);
    var out = {};
    var groups = {};
    var restrictions = (ctx.restrictions || []).filter(function (r) { return r.date === date; });

    entries.forEach(function (e) {
      var row = e.row;
      var issues = [];
      var cancelled = str(row[C['대기여부']]) === CANCELLED;
      var it = interpret(row, idx);
      var key = schoolKey(it.school);
      var gradeValue = null;

      if (!cancelled) {
        // 입력 내용
        if (it.problems.length) addIssue(issues, 'INPUT', it.problems.join(' · '), it.cells);
        if (it.home) addIssue(issues, 'INPUT', '홈스쿨링 확인 (적힌 그대로: ' + it.home + ')', [C['학교명']]);

        // 학부모 연락처
        var applicant = str(row[C['신청자명']]);
        if (applicant && applicant === str(row[C['학생명']])) addIssue(issues, 'PARENT', '학생명과 신청자명이 같음 (학생 아이디로 신청한 것으로 보임)', [C['신청자명'], C['학생명']]);

        // 단체
        var kind = str(row[C['단체신청여부']]);
        if (kind && kind !== '개인') {
          var cnt = str(row[C['단체인원수']]);
          addIssue(issues, 'GROUP', '단체 신청' + (cnt ? ' (' + cnt + '명)' : '') + ' — 개별 신청만 가능', [C['단체신청여부']]);
        }

        // 관외
        if (it.school && !it.home && !idx[key]) addIssue(issues, 'OUTSIDE', '학교 목록에 없음 (적힌 그대로: ' + it.school + ')', [C['학교명']]);

        // 학년
        var dm = /(\d)/.exec(it.grade);
        if (dm) {
          var n = +dm[1];
          var lv = schoolLevel(it.school);
          if (!lv && idx[key]) {
            var lvs = Object.keys(idx[key]).filter(function (x) { return x === '초' || x === '중' || x === '고'; });
            if (lvs.length === 1) lv = lvs[0];
          }
          var maxN = lv === '중' || lv === '고' ? 3 : 6;
          if (n < 1 || n > maxN) {
            addIssue(issues, 'INPUT', '학년 숫자 확인 (적힌 그대로: ' + it.grade + ')', [C['학반']]);
          } else {
            gradeValue = lv === '중' ? n + 6 : (lv === '고' ? n + 9 : n);
            var r = e.cls && e.cls.range;
            if (r && (gradeValue < r.min || gradeValue > r.max)) {
              addIssue(issues, 'GRADE', gradeLabel(gradeValue) + ' 학생 — 대상(' + rangeLabel(r) + ') 아님', [C['학반']]);
            }
          }
        } else if (it.grade || !it.problems.length) {
          addIssue(issues, 'INPUT', '학반에서 학년을 알 수 없음' + (it.grade ? ' (적힌 그대로: ' + it.grade + ')' : ''), [C['학반']]);
        }

        // 출석부에 그대로 옮길 수 있는지 (학교 정식 이름·학반 형식) — 원본을 고쳐 두면 매주 다시 걸리지 않습니다
        var hasInput = function (col) { return issues.some(function (x) { return (x.code === 'INPUT' || x.code === 'OUTSIDE') && x.cells.indexOf(col) >= 0; }); };
        if (it.school && !it.home && idx[key] && !hasInput(C['학교명'])) {
          var off = officialSchool(it.school, ctx.schools);
          if (!off.ok) addIssue(issues, 'INPUT', '학교명을 정식 이름으로 (적힌 그대로: ' + it.school + (off.cands && off.cands.length ? ' → ' + off.cands.join(' / ') + ' 중 하나' : '') + ')', [C['학교명']]);
        }
        if (it.grade && !hasInput(C['학반']) && !normalizeBan(it.grade).ok) {
          addIssue(issues, 'INPUT', '학반 형식 확인 (적힌 그대로: ' + it.grade + ' → 예: 3-2)', [C['학반']]);
        }

        // 신청 제한
        restrictions.forEach(function (rs) {
          if (str(rs.name) === it.name && schoolKey(rs.school) === key && it.name) {
            addIssue(issues, 'RESTRICT', (rs.reason ? rs.reason + ' ' : '') + shortDate(rs.absent) + ' → ' + shortDate(date) + ' 신청 제한', [C['학생명']]);
          }
        });

        // 중복 묶음 (같은 시간대 + 학생명 + 학교 앞 두 글자)
        if (it.name && key && e.cls) {
          var g = e.cls['시간대'] + '|' + it.name + '|' + key;
          (groups[g] = groups[g] || []).push(e);
        }
      }
      out[e.no] = { issues: issues, name: it.name, schoolKey: key, grade: gradeValue, cancelled: cancelled };
    });

    Object.keys(groups).forEach(function (g) {
      var list = groups[g];
      if (list.length < 2) return;
      list.forEach(function (e) {
        var others = list.filter(function (o) { return o !== e; }).map(function (o) { return o.cls['수업반'] + '(' + o.no + ')'; });
        addIssue(out[e.no].issues, 'DUP', '같은 ' + e.cls['시간대'] + ' 시간대에 또 신청: ' + others.join(', '), [C['학생명'], C['학교명']]);
      });
    });

    entries.forEach(function (e) {
      var o = out[e.no];
      o.issues.sort(function (a, b) { return (a.level === b.level ? 0 : (a.level === 'red' ? -1 : 1)); });
      o.level = o.issues.length ? o.issues[0].level : '';
      o.fp = fingerprint(e.row, o.issues);
    });
    return out;
  }

  /** 처리 이후 신청 내용이나 사유가 바뀌었는지 알아보는 지문 */
  function fingerprint(row, issues) {
    var s = row.map(str).join('\u0001') + '\u0002' + issues.map(function (i) { return i.code; }).sort().join(',');
    var h = 5381;
    for (var i = 0; i < s.length; i++) { h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; }
    return h.toString(36);
  }

  /** 수업일 목록과 오늘 날짜로 지금 회차를 고릅니다. */
  function currentRound(dates, today) {
    var list = (dates || []).filter(function (d) { return d && d.date; }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    for (var i = 0; i < list.length; i++) {
      if (today <= list[i].date) return list[i].date;
    }
    return list.length ? list[list.length - 1].date : null;
  }

  function roundNumber(dates, date) {
    for (var i = 0; i < dates.length; i++) if (dates[i].date === date) return +dates[i].n;
    return null;
  }

  /** 그 수업일에 운영하는 접수 단위 */
  function activeClasses(classes, dates, date) {
    var n = roundNumber(dates, date);
    return (classes || []).filter(function (c) {
      if (n === null) return true;
      var from = +c.from || 1, to = +c.to || 99;
      return n >= from && n <= to;
    });
  }

  /** 예약명 → 접수 단위. 연결 기록이 먼저, 그다음 키워드. 못 찾으면 null */
  function resolveClass(title, year, classes, mappings) {
    var p = parseTitle(title, year);
    var name = mappings && mappings[p.key];
    if (name) {
      var hit = classes.filter(function (c) { return c['접수명'] === name; });
      if (hit.length) return hit[0];
    }
    var cands = classes.filter(function (c) {
      var kw = str(c.keyword).replace(/\s+/g, '');
      return kw && p.key.indexOf(kw) >= 0;
    });
    return cands.length === 1 ? cands[0] : null;
  }

  function instanceKey(p) { return p.end ? p.start + '~' + p.end : p.start; }

  function instanceCovers(inst, date) {
    if (!inst) return false;
    if (inst.indexOf('~') < 0) return inst === date;
    var a = inst.split('~');
    return date >= a[0] && date <= a[1];
  }

  /** 결석일 다음 수업일 */
  function nextClassDate(dates, absent) {
    var list = (dates || []).map(function (d) { return d.date; }).filter(Boolean).sort();
    for (var i = 0; i < list.length; i++) if (list[i] > absent) return list[i];
    return null;
  }

  return {
    HEADER: HEADER, C: C, HIDDEN_COLS: HIDDEN_COLS, ISSUE: ISSUE, WINDOW_DAYS: WINDOW_DAYS, CANCELLED: CANCELLED,
    str: str, addDays: addDays, shortDate: shortDate, parseFileName: parseFileName, inWindow: inWindow,
    isListFile: isListFile, tsFromMillis: tsFromMillis, fileStamp: fileStamp, validTs: validTs,
    parseGradeRange: parseGradeRange, gradeLabel: gradeLabel, rangeLabel: rangeLabel, parseTitle: parseTitle,
    schoolKey: schoolKey, schoolLevel: schoolLevel, buildSchoolIndex: buildSchoolIndex, interpret: interpret,
    officialSchool: officialSchool, normalizeBan: normalizeBan,
    analyzeRound: analyzeRound, fingerprint: fingerprint, currentRound: currentRound, roundNumber: roundNumber,
    activeClasses: activeClasses, resolveClass: resolveClass, instanceKey: instanceKey, instanceCovers: instanceCovers,
    nextClassDate: nextClassDate
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Core; }
