/*
 * 주말 신청 점검 — 출석부 만들기 (학교명·학반 정리, 정렬, 분반, 교실·교구 문구)
 * 브라우저에서만 쓰고, 테스트는 node 로 합니다.
 */
var Roster = (function () {
  'use strict';
  var str = Core.str;
  var CAP = 16;

  function norm(s) { return str(s).replace(/\s+/g, ''); }

  /** 학부모가 쓴 학교명 → 학교 목록의 정식 이름. 하나로 정해지지 않으면 ok:false */
  function officialSchool(raw, schools) {
    var t = norm(raw);
    if (!t) return { name: '', ok: false };
    var exact = (schools || []).filter(function (s) { return norm(s.name) === t; });
    if (exact.length) return { name: exact[0].name, ok: true };
    var key = Core.schoolKey(t);
    var lv = Core.schoolLevel(t);
    var cands = (schools || []).filter(function (s) {
      if (Core.schoolKey(s.name) !== key) return false;
      if (!lv) return true;
      var sl = s.level || Core.schoolLevel(s.name);
      return sl === lv;
    });
    if (cands.length === 1) return { name: cands[0].name, ok: true };
    return { name: str(raw), ok: false, cands: cands.map(function (s) { return s.name; }) };
  }

  /** 학반 → '3-2'. 반이 없으면 1반 */
  function normalizeBan(raw) {
    var t = str(raw).replace(/^(초등?|중학?|초|중)\s*/, '');
    var m = /^(\d)\s*학년\s*(\d{1,2})\s*반?/.exec(t) ||
      /^(\d)\s*[-ㅡ—–.~_/,·\s]\s*(\d{1,2})\s*반?$/.exec(t) ||
      /^(\d)(\d{1,2})$/.exec(t);
    if (m) return { ban: m[1] + '-' + (+m[2]), ok: true };
    m = /^(\d)\s*(학년)?$/.exec(t);
    if (m) return { ban: m[1] + '-1', ok: true };
    return { ban: str(raw), ok: false };
  }

  function byKo(a, b) { return a < b ? -1 : (a > b ? 1 : 0); }
  function sortStudents(list) {
    return list.slice().sort(function (a, b) {
      return String(a.school).localeCompare(String(b.school), 'ko') || String(a.name).localeCompare(String(b.name), 'ko') || byKo(a.no, b.no);
    });
  }

  /**
   * 승인된 신청 → 출석부 학생. rows: state.rows, schools: 학교 목록
   * 반환 학생: { no, name, school, schoolOk, ban, banOk, grade1, cls, phone, parent }
   */
  function students(rows, schools) {
    var idx = Core.buildSchoolIndex(schools);
    return rows.filter(function (r) { return Core.str(r.cells[12]) === '승인'; }).map(function (r) {
      var it = Core.interpret(r.cells, idx);
      var sch = officialSchool(it.school || it.home || r.cells[10], schools);
      var b = normalizeBan(it.grade || r.cells[11]);
      var lv = Core.schoolLevel(sch.name);
      return {
        no: r.no, name: it.name || Core.str(r.cells[9]), school: sch.name, schoolOk: sch.ok, ban: b.ban, banOk: b.ok,
        grade1: b.ok && b.ban.charAt(0) === '1' && lv !== '중', cls: r.cls, phone: r.cells[3], parent: r.cells[2]
      };
    });
  }

  /** 같은 반 요청 묶음 → 학생 번호 묶음 목록 [[no, no], ...] */
  function linkSets(links, list, date, acceptKeep) {
    var out = [];
    (links || []).forEach(function (g) {
      var useIt = g.date === date || (g.scope === '계속' && acceptKeep && acceptKeep[g.id]);
      if (!useIt) return;
      var nos = [];
      g.members.forEach(function (m) {
        var hit = list.filter(function (s) { return (g.date === date && m.no && s.no === m.no) || (s.name === m.name && Core.schoolKey(s.school) === Core.schoolKey(m.school)); })[0];
        if (hit && nos.indexOf(hit.no) < 0) nos.push(hit.no);
      });
      if (nos.length >= 2) out.push({ id: g.id, nos: nos });
    });
    return out;
  }

  /**
   * 두 반으로 나누기. 같은 반 요청 → 같은 학교 → 한 반 16명 이하 → 인원 균등 → (필요하면) 1학년 균등
   * 반환: { parts: [반1 학생들, 반2 학생들], cost, ok } 또는 { error, units }
   */
  function split(list, sets, opts) {
    opts = opts || {};
    var cap = opts.cap || CAP;
    var sorted = sortStudents(list);
    var n = sorted.length;
    // 묶음 단위 만들기 (같은 학교 + 같은 반 요청)
    var parent = sorted.map(function (_, i) { return i; });
    function find(i) { return parent[i] === i ? i : (parent[i] = find(parent[i])); }
    function join(a, b) { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); }
    var bySchool = {};
    sorted.forEach(function (s, i) { var k = norm(s.school); if (bySchool[k] === undefined) bySchool[k] = i; else join(bySchool[k], i); });
    (sets || []).forEach(function (set) {
      var ids = set.nos.map(function (no) { return sorted.findIndex(function (s) { return s.no === no; }); }).filter(function (i) { return i >= 0; });
      for (var k = 1; k < ids.length; k++) join(ids[0], ids[k]);
    });
    var unitsMap = {};
    sorted.forEach(function (s, i) { var r = find(i); (unitsMap[r] = unitsMap[r] || []).push(i); });
    var units = Object.keys(unitsMap).map(function (k) { return unitsMap[k]; }).sort(function (a, b) { return a[0] - b[0]; });
    var G = sorted.filter(function (s) { return s.grade1; }).length;
    var useG = !!opts.balanceGrade1 && G > 0;
    var info = units.map(function (u) { return { size: u.length, g: u.filter(function (i) { return sorted[i].grade1; }).length }; });

    function cost(sA, gA) {
      if (sA > cap || n - sA > cap) return Infinity;
      return Math.abs(n - 2 * sA) * 10 + (useG ? Math.abs(G - 2 * gA) * 10 : 0);
    }
    // 모든 가능한 조합 (단위 개수가 적어서 표로 계산)
    var dp = { '0|0': [] };
    info.forEach(function (u, k) {
      var next = {};
      Object.keys(dp).forEach(function (key) {
        var p = key.split('|').map(Number);
        if (!next[key]) next[key] = dp[key];
        var k2 = (p[0] + u.size) + '|' + (p[1] + u.g);
        if (!next[k2]) next[k2] = dp[key].concat([k]);
      });
      dp = next;
    });
    var best = null;
    Object.keys(dp).forEach(function (key) {
      var p = key.split('|').map(Number);
      var c = cost(p[0], p[1]);
      if (c < Infinity && (!best || c < best.c)) best = { c: c, pick: dp[key] };
    });
    if (!best) {
      return { error: '같은 학교·같은 반 요청을 지키면서 한 반 ' + cap + '명 이하로 나눌 수 없습니다.', units: units.filter(function (u) { return u.length > 1; }).map(function (u) { return u.map(function (i) { return sorted[i]; }); }) };
    }
    // 정렬 순서대로 앞뒤로 자른 결과가 같은 수준이면 그쪽을 씁니다
    var pick = best.pick, size = 0, g = 0;
    for (var k = 0; k < info.length; k++) {
      size += info[k].size; g += info[k].g;
      if (cost(size, g) === best.c) { pick = units.slice(0, k + 1).map(function (_, j) { return j; }); break; }
    }
    var inA = {};
    pick.forEach(function (k) { inA[k] = true; });
    if (!inA[0]) { var flip = {}; units.forEach(function (_, k) { if (!inA[k]) flip[k] = true; }); inA = flip; }
    var A = [], B = [];
    units.forEach(function (u, k) { u.forEach(function (i) { (inA[k] ? A : B).push(sorted[i]); }); });
    return { parts: [sortStudents(A), sortStudents(B)], cost: best.c, ok: true };
  }

  /* ───────── 교실·교구 문구 ───────── */

  var GENERIC = /^(노트북|태블릿|태블릿\s*PC|태블릿PC|PC|컴퓨터|AA+\s*건전지|AA+배터리|건전지|배터리|활동지|필기도구|사인펜|가위|풀|색칠도구|A4\s*용지)$/i;

  /** 교구 칸 → 출석부용 짧은 이름. 공용 기기는 빼고, 수량·괄호 설명은 지웁니다 */
  function shortTools(text) {
    var items = str(text).replace(/\([^)]*\)?/g, '').split(/[,\n]/).map(function (x) {
      return x.replace(/\.\.\.$/, '').replace(/\s*\d+\s*(대|개입|개|매|p|P|세트|인용|EA|ea)(\s.*)?$/, '').replace(/\s*만들기$/, '').trim();
    }).filter(Boolean);
    var main = items.filter(function (x) { return !GENERIC.test(x); });
    var use = (main.length ? main : items).slice(0, 2);
    return { text: use.join(', '), generic: !main.length && items.length > 0 };
  }

  /** 수업(세션)·교실 → '1-2교시 라온실, 3-4교시 놀이실(교구A/교구B)' */
  function composeLine(sessions, rooms, toolsBySession) {
    var ss = str(sessions).split('/').map(str).filter(Boolean);
    var rr = str(rooms).split('/').map(str);
    var tools = ss.map(function (s) { return str(toolsBySession[norm(s)]); });
    if (ss.length <= 1) return '1-4교시 ' + (rr[0] || '') + '(' + (tools[0] || '') + ')';
    return '1-2교시 ' + (rr[0] || '') + ', 3-4교시 ' + (rr[1] || '') + '(' + tools.join('/') + ')';
  }

  /** 수업반·분반 번호 → 기본 수업 연결 (주제·교구 시트의 '반' 이름) */
  function defaultSessions(group, part, parts) {
    var g = norm(group);
    var pair = null;
    if (/기초/.test(g)) pair = ['기초1', '기초2'];
    else if (/창의1,2|창의1·2/.test(g)) pair = ['놀이1', '과학1'];
    else if (/창의3,4|창의3·4/.test(g)) pair = ['놀이2', '과학2'];
    if (pair && parts > 1) return (part === 0 ? pair : pair.slice().reverse()).join('/');
    return g.replace(/반$/, '');
  }

  function swapPair(s) { var a = str(s).split('/'); return a.length === 2 ? a[1] + '/' + a[0] : str(s); }

  function titleDate(title, date) {
    var md = (+date.slice(5, 7)) + '월 ' + (+date.slice(8, 10)) + '일';
    return /\d+\s*월\s*\d+\s*일/.test(title) ? title.replace(/\d+\s*월\s*\d+\s*일/, md) : md + ' ' + title;
  }

  /* ───────── 반 설정 (제목·교실·교구) ───────── */

  var ROOMS = ['라온실', '혜윰실', '놀이실', '창의실', 'SW체험교실'];

  function makeTitle(date, b) {
    return (+date.slice(5, 7)) + '월 ' + (+date.slice(8, 10)) + '일 주말' + str(b.program) + '프로그램 ' + str(b.name) + ' 수강생 명단';
  }

  /** 다른 수업 사이는 '/', 같은 수업 안의 교구는 ',' */
  function makeLine(b) {
    if (b.same) return '1-4교시 ' + str(b.room1) + '(' + str(b.tool1) + ')';
    return '1-2교시 ' + str(b.room1) + ', 3-4교시 ' + str(b.room2) + '(' + [str(b.tool1), str(b.tool2)].join('/') + ')';
  }

  /** 반 이름 → 신청반 표기: 기초코딩 오전1반 → 기초1, 탐험코딩 오전반 → 탐험, 오후3반 → 3, 메이커1반 → 메이커1 */
  function autoTag(name) {
    var t = norm(name), m;
    if ((m = /^(.+?)코딩.*?(\d)반$/.exec(t))) return m[1].slice(0, 2) + m[2];
    if ((m = /^(.+?)코딩/.exec(t))) return m[1];
    if ((m = /^메이커(\d)/.exec(t))) return '메이커' + m[1];
    if ((m = /^오[전후](\d)반$/.exec(t))) return m[1];
    return t.replace(/반$/, '');
  }

  /** 지난 회차 값이 없을 때의 반 이름·프로그램 기본값 */
  function defaultBlock(group, part, parts, time, seq) {
    var g = norm(group);
    var sw = /기초|탐험|마스터|도전/.test(g);
    var name;
    if (/기초/.test(g)) name = '기초코딩 ' + time + (parts > 1 ? (part + 1) : '') + '반';
    else if (/탐험/.test(g)) name = '탐험코딩 ' + time + '반';
    else if (/마스터/.test(g)) name = '마스터코딩 ' + time + '반';
    else if (/메이커(\d)/.test(g)) name = '메이커' + /메이커(\d)/.exec(g)[1] + '반';
    else name = time + seq + '반';
    return { program: sw ? 'SW' : '창의', name: name, same: !(parts > 1), room1: '', room2: '', tool1: '', tool2: '' };
  }

  /** 예전 제목에서 프로그램·반 이름 읽기 */
  function parseTitle(title) {
    var m = /주말\s*(SW|창의)\s*프로그램\s*(.*?)\s*수강생\s*명단/.exec(str(title));
    return m ? { program: m[1], name: m[2] } : null;
  }

  /**
   * 반 설정 검사. blocks: [{key, time(오전/오후), group, program, name, room1, room2, same, tool1, tool2}]
   * 반환: { errors: [{i, msg}], warns: [{i, msg}] }
   */
  function checkBlocks(blocks) {
    var errors = [], warns = [];
    var used = {}, titles = {};
    blocks.forEach(function (b, i) {
      if (!str(b.name)) errors.push({ i: i, msg: '반 이름이 비어 있습니다.' });
      if (!str(b.room1) || (!b.same && !str(b.room2))) errors.push({ i: i, msg: '교실을 골라 주세요.' });
      if (!str(b.tool1) || (!b.same && !str(b.tool2))) warns.push({ i: i, msg: '교구가 비어 있습니다.' });
      var t = norm(b.program + b.name);
      if (titles[t] !== undefined) errors.push({ i: i, msg: (titles[t] + 1) + '번 반과 제목이 같습니다.' }); else titles[t] = i;
      [[1, b.room1], [2, b.same ? b.room1 : b.room2]].forEach(function (x) {
        if (!str(x[1])) return;
        var k = b.time + '|' + x[0] + '|' + x[1];
        if (used[k] !== undefined) errors.push({ i: i, msg: b.time + ' ' + (x[0] === 1 ? '1-2교시' : '3-4교시') + ' ' + x[1] + '이(가) ' + (used[k] + 1) + '번 반과 겹칩니다.' });
        else used[k] = i;
      });
    });
    // 한 반을 둘로 나눈 경우 교실이 서로 바뀌어 있는지
    var byGroup = {};
    blocks.forEach(function (b, i) { (byGroup[b.group] = byGroup[b.group] || []).push(i); });
    Object.keys(byGroup).forEach(function (g) {
      var ix = byGroup[g];
      if (ix.length !== 2) return;
      var a = blocks[ix[0]], c = blocks[ix[1]];
      if (a.same || c.same || !a.room1 || !c.room1) return;
      if (a.room1 !== c.room2 || a.room2 !== c.room1) warns.push({ i: ix[1], msg: (ix[0] + 1) + '번 반과 교실 순서가 서로 바뀌어 있지 않습니다 (보통 1반 ' + a.room1 + '→' + a.room2 + ', 2반 ' + a.room2 + '→' + a.room1 + ').' });
    });
    return { errors: errors, warns: warns };
  }

  function fileName(date, version) {
    var md = date.slice(5, 7) + date.slice(8, 10);
    return '출석부_' + md + (version > 1 ? '_' + version + '차' : '') + '.xlsx';
  }

  /* ───────── 엑셀 (보내 주신 출석부 서식) ───────── */

  var FONT = '맑은 고딕';
  var TITLE_FILL = 'FFFFF2CC', HEAD_FILL = 'FFDBDBDB';
  var BLOCK_ROWS = 28, STUDENT_ROWS = 18;

  function border(l, r, t, b) {
    var o = {};
    if (l) o.left = { style: l }; if (r) o.right = { style: r }; if (t) o.top = { style: t }; if (b) o.bottom = { style: b };
    return o;
  }

  /** blocks: [{ title, line, tag, students:[{school, ban, name}] }] → ExcelJS Workbook */
  function buildWorkbook(ExcelJS, blocks, sheetName) {
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet(sheetName, {
      pageSetup: { paperSize: 9, orientation: 'portrait', scale: 87, fitToPage: false,
        margins: { left: 0.7087, right: 0.5906, top: 1.1811, bottom: 0.9843, header: 0.3937, footer: 0.1969 } },
      views: [{ showGridLines: true }]
    });
    [6.25, 18.75, 8.375, 11.875, 8.125, 6.625, 6.625, 6.625, 6.625, 11].forEach(function (w, i) { ws.getColumn(i + 1).width = w; });
    var center = { horizontal: 'center', vertical: 'middle', wrapText: true };
    function set(r, c, v, font, fill, b, align) {
      var cell = ws.getCell(r, c);
      if (v !== undefined && v !== null) cell.value = v;
      cell.font = Object.assign({ name: FONT, size: 11 }, font || {});
      if (fill) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      if (b) cell.border = b;
      cell.alignment = align || center;
    }
    blocks.forEach(function (blk, bi) {
      var r0 = 1 + bi * BLOCK_ROWS;
      // 제목 (2줄 병합)
      for (var c = 1; c <= 10; c++) {
        set(r0, c, c === 1 ? blk.title : null, c === 1 ? { size: 17, bold: true } : null, TITLE_FILL, border(c === 1 ? 'medium' : null, c === 10 ? 'medium' : null, 'medium', null));
        set(r0 + 1, c, null, null, TITLE_FILL, border(c === 1 ? 'medium' : null, c === 10 ? 'medium' : null, null, 'thin'));
      }
      ws.mergeCells(r0, 1, r0 + 1, 10);
      ws.getRow(r0).height = 22.5; ws.getRow(r0 + 1).height = 22.5;
      // 교실·교구
      for (c = 1; c <= 10; c++) set(r0 + 2, c, c === 1 ? blk.line : null, { size: 13, bold: true }, TITLE_FILL, border(c === 1 ? 'medium' : null, c === 10 ? 'medium' : null, null, 'medium'));
      ws.mergeCells(r0 + 2, 1, r0 + 2, 10);
      ws.getRow(r0 + 2).height = 38.25;
      // 머리글
      var heads = ['번호', '기관(학교)', '학년/반', '신청자', '신청반'];
      for (c = 1; c <= 10; c++) {
        var L = c === 1 ? 'medium' : 'thin', R = c === 10 ? 'medium' : 'thin';
        set(r0 + 3, c, c <= 5 ? heads[c - 1] : (c === 6 ? '출석여부' : (c === 10 ? '비고' : null)), { size: 12, bold: true }, HEAD_FILL, border(L, R, 'medium', 'thin'));
        set(r0 + 4, c, c >= 6 && c <= 9 ? (c - 5) + '교시' : null, { size: 11, bold: true }, HEAD_FILL, border(L, R, 'thin', 'thin'));
      }
      for (c = 1; c <= 5; c++) ws.mergeCells(r0 + 3, c, r0 + 4, c);
      ws.mergeCells(r0 + 3, 6, r0 + 3, 9);
      ws.mergeCells(r0 + 3, 10, r0 + 4, 10);
      ws.getRow(r0 + 3).height = 30.75; ws.getRow(r0 + 4).height = 30.75;
      // 학생 칸 18줄 (번호는 16까지 미리, 그 이상은 학생이 있을 때)
      for (var i = 0; i < STUDENT_ROWS; i++) {
        var rr = r0 + 5 + i, s = blk.students[i];
        var num = s || i < CAP ? i + 1 : null;
        var vals = [num, s ? s.school : null, s ? s.ban : null, s ? s.name : null, s ? blk.tag : null];
        for (c = 1; c <= 10; c++) set(rr, c, c <= 5 ? vals[c - 1] : null, c >= 6 && c <= 8 ? { size: 12 } : null, null, border(c === 1 ? 'medium' : 'thin', c === 10 ? 'medium' : 'thin', 'thin', 'thin'));
        ws.getRow(rr).height = 26.25;
      }
      // 아래 표
      var sr = r0 + 5 + STUDENT_ROWS;
      for (var k = 0; k < 5; k++) {
        var row = sr + k;
        var top = k === 0 ? 'medium' : 'thin', bot = k === 4 ? 'medium' : 'thin';
        var labels = k === 0 ? ['교시', '신청인원', null, '수강인원', null, '결석인원', null, null, '지도교사', null] : [k, null, null, null, null, null, null, null, null, null];
        for (c = 1; c <= 10; c++) set(row, c, labels[c - 1], null, null, border(c === 1 ? 'medium' : 'thin', 'thin', top, bot));
        ws.mergeCells(row, 2, row, 3); ws.mergeCells(row, 4, row, 5); ws.mergeCells(row, 6, row, 8); ws.mergeCells(row, 9, row, 10);
        ws.getRow(row).height = 29.25;
      }
      ws.getRow(sr + 4).addPageBreak();
    });
    return wb;
  }

  return {
    CAP: CAP, officialSchool: officialSchool, normalizeBan: normalizeBan, sortStudents: sortStudents, students: students,
    linkSets: linkSets, split: split, shortTools: shortTools, composeLine: composeLine, defaultSessions: defaultSessions,
    swapPair: swapPair, titleDate: titleDate, fileName: fileName, buildWorkbook: buildWorkbook,
    ROOMS: ROOMS, makeTitle: makeTitle, makeLine: makeLine, autoTag: autoTag, defaultBlock: defaultBlock, parseTitle: parseTitle, checkBlocks: checkBlocks
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Roster; }
