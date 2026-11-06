/*
 * 창의융합프로그램 신청자 명단 점검 — 출석부 만들기 (학교명·학반 정리, 정렬, 분반, 교실·교구 문구)
 * 브라우저에서만 쓰고, 테스트는 node 로 합니다.
 */
var Roster = (function () {
  'use strict';
  var str = Core.str;
  var CAP = 16;

  function norm(s) { return str(s).replace(/\s+/g, ''); }

  /* 학교명·학반 정리는 점검 목록과 같은 기준을 쓰도록 Core에 있습니다 */
  var officialSchool = Core.officialSchool;
  var normalizeBan = Core.normalizeBan;

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

  /** 교실·교구 문구 → 칸별 값 (예전 저장본 읽기용) */
  function parseLine(line) {
    var t = str(line), m;
    if ((m = /^1-4교시\s*([^(]+?)\s*\((.*)\)$/.exec(t))) return { same: true, room1: m[1], room2: '', tool1: m[2], tool2: '' };
    if ((m = /^1-2교시\s*([^,]+?)\s*,\s*3-4교시\s*([^(]+?)\s*\((.*)\)$/.exec(t))) {
      var k = m[3].indexOf('/');
      return { same: false, room1: m[1], room2: m[2], tool1: k >= 0 ? m[3].slice(0, k) : m[3], tool2: k >= 0 ? m[3].slice(k + 1) : '' };
    }
    return null;
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

  /* ───────── 엑셀 (원본 출석부 서식 그대로) ───────── */

  var FONT = '맑은 고딕';
  var BLOCK_ROWS = 28, STUDENT_ROWS = 18, COLS = 11;
  // 원본 출석부(2026 출석부 1031 시트) 첫 반 블록 28줄 × A~K열의 칸 서식을 그대로 옮긴 본
  // 각 서식: [글자 크기, 굵게, 채우기 색, 가로 정렬, 세로 정렬, 줄 바꿈, 왼쪽·오른쪽·위·아래 테두리]
  var TPL_STYLES = [[17.0,1,"FFF2CC","center","center",1,"medium","medium","medium","thin"],[11.0,0,null,null,null,0,null,null,"medium",null],[11.0,0,null,null,null,0,null,"medium","medium",null],[11.0,0,null,null,null,0,null,null,null,null],[11.0,0,null,null,null,0,"medium",null,null,"thin"],[11.0,0,null,null,null,0,null,null,null,"thin"],[11.0,0,null,null,null,0,null,"medium",null,"thin"],[13.0,1,"FFF2CC","center","center",1,"medium","medium",null,"medium"],[11.0,0,null,null,null,0,null,null,null,"medium"],[11.0,0,null,null,null,0,null,"medium",null,"medium"],[12.0,1,"DBDBDB","center","center",1,"medium","thin","medium","thin"],[12.0,1,"DBDBDB","center","center",1,"thin","thin","medium","thin"],[11.0,0,null,null,null,0,null,null,"medium","thin"],[11.0,0,null,null,null,0,null,"thin","medium","thin"],[12.0,1,"DBDBDB","center","center",0,"thin","medium","medium","thin"],[11.0,0,null,null,null,0,"medium","thin",null,"thin"],[11.0,0,null,null,null,0,"thin","thin",null,"thin"],[11.0,1,"DBDBDB","center","center",1,null,"thin",null,"thin"],[11.0,0,null,null,null,0,"thin","medium",null,"thin"],[11.0,0,null,"center","center",1,"medium","thin","thin","thin"],[11.0,0,null,"center","center",0,"thin","thin","thin","thin"],[11.0,0,null,"center","center",1,"thin","thin","thin","thin"],[11.0,0,null,"center","center",1,null,"thin",null,"thin"],[11.0,0,null,"center","center",0,null,"medium",null,"thin"],[11.0,0,null,"center","center",0,null,"medium","thin","thin"],[12.0,0,null,"center","center",1,null,"thin",null,"thin"],[11.0,0,null,null,"center",0,null,"medium","thin","thin"],[11.0,0,null,"center","center",1,"medium","thin","thin",null],[12.0,0,null,"center","center",1,null,"thin",null,null],[11.0,0,null,"center","center",1,null,"thin",null,null],[11.0,0,null,null,"center",0,null,"medium","thin",null],[12.0,0,null,"center","center",1,"thin","thin","thin","thin"],[11.0,0,null,null,"center",0,"thin","medium","thin","thin"],[11.0,0,null,"center","center",1,"medium","thin","medium","thin"],[11.0,0,null,"center","center",1,"thin","thin","medium","thin"],[11.0,0,null,"center","center",0,"thin","thin","medium","thin"],[11.0,0,null,null,null,0,null,"thin","thin","thin"],[11.0,0,null,null,null,0,null,null,"thin","thin"],[11.0,0,null,null,"center",1,"thin","thin","thin","thin"],[11.0,0,null,"center","center",1,"medium","thin","thin","medium"],[11.0,0,null,"center","center",1,"thin","thin","thin","medium"],[11.0,0,null,null,null,0,null,"thin","thin","medium"],[11.0,0,null,"center","center",0,"thin","thin","thin","medium"],[11.0,0,null,null,null,0,null,null,"thin","medium"]];
  var TPL_GRID = [[0,1,1,1,1,1,1,1,1,2,3],[4,5,5,5,5,5,5,5,5,6,3],[7,8,8,8,8,8,8,8,8,9,3],[10,11,11,11,11,11,12,12,13,14,3],[15,16,16,16,16,17,17,17,17,18,3],[19,20,20,20,21,22,22,22,22,23,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,22,22,22,22,24,3],[19,20,20,20,21,25,25,25,22,26,3],[19,20,20,20,21,25,25,25,22,26,3],[27,20,20,20,21,28,28,28,29,30,3],[19,20,20,20,21,31,31,31,21,32,3],[19,20,20,20,21,31,31,31,21,32,3],[19,20,20,20,21,31,31,31,21,32,3],[19,21,21,21,21,25,25,25,22,26,3],[33,34,13,35,13,35,12,13,34,13,3],[19,21,36,20,36,20,37,36,21,36,3],[19,21,36,20,36,20,37,36,38,36,3],[19,21,36,20,36,20,37,36,21,36,3],[39,40,41,42,41,42,43,41,40,41,3]];
  var TPL_HEIGHTS = [22.5, 22.5, 38.25, 30.75, 30.75, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 26.25, 29.25, 29.25, 29.25, 29.25, 29.25];

  /** 칸마다 새 서식 객체를 넣습니다 (병합된 칸끼리 서식을 공유하지 않도록) */
  function applyStyle(cell, k) {
    var t = TPL_STYLES[k];
    var st = { font: { name: FONT, size: t[0], bold: !!t[1], color: { argb: 'FF000000' }, charset: 129, family: 3 } };
    if (t[2]) st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + t[2] }, bgColor: { indexed: 64 } };
    var al = {};
    if (t[3]) al.horizontal = t[3];
    if (t[4]) al.vertical = t[4] === 'center' ? 'middle' : t[4];  // 엑셀의 세로 가운데는 ExcelJS에서 'middle'
    if (t[5]) al.wrapText = true;
    st.alignment = al;
    var bd = {};
    ['left', 'right', 'top', 'bottom'].forEach(function (side, i) { if (t[6 + i]) bd[side] = { style: t[6 + i], color: { argb: 'FF000000' } }; });
    st.border = bd;
    cell.style = st;
  }

  var COL_WIDTHS = [6.25, 18.75, 8.375, 11.875, 8.125, 6.625, 6.625, 6.625, 6.625, 11, 9];

  /** 출석부에 들어가는 학생 순서: 신청자 이름 가나다순 (분반은 학교 순으로 나누고, 출력은 이름순) */
  function byName(list) {
    return (list || []).slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'ko') || String(a.school).localeCompare(String(b.school), 'ko') || byKo(a.no, b.no);
    });
  }

  /** 한 반 블록(28줄 × 11칸)의 병합 범위 [위줄, 왼칸, 아래줄, 오른칸] (0부터, 블록 안 기준) */
  function blockMerges() {
    var m = [[0, 0, 1, 9], [2, 0, 2, 9]];
    for (var c = 0; c < 5; c++) m.push([3, c, 4, c]);
    m.push([3, 5, 3, 8], [3, 9, 4, 9]);
    var sr = 5 + STUDENT_ROWS;
    for (var k = 0; k < 5; k++) m.push([sr + k, 1, sr + k, 2], [sr + k, 3, sr + k, 4], [sr + k, 5, sr + k, 7], [sr + k, 8, sr + k, 9]);
    return m;
  }

  /** 한 반 블록에 들어가는 값 (엑셀과 화면 미리보기가 같은 값을 씁니다). 학생은 이름순. */
  function blockValues(blk) {
    var v = [];
    for (var t = 0; t < BLOCK_ROWS; t++) { v.push([]); for (var c = 0; c < COLS; c++) v[t].push(null); }
    v[0][0] = blk.title; v[2][0] = blk.line;
    ['번호', '기관(학교)', '학년/반', '신청자', '신청반'].forEach(function (h, i) { v[3][i] = h; });
    v[3][5] = '출석여부'; v[3][9] = '비고';
    for (c = 5; c <= 8; c++) v[4][c] = (c - 4) + '교시';
    var list = byName(blk.students);
    for (var i = 0; i < STUDENT_ROWS; i++) {
      var s = list[i];
      if (s || i < CAP) v[5 + i][0] = i + 1;
      if (s) { v[5 + i][1] = s.school; v[5 + i][2] = s.ban; v[5 + i][3] = s.name; v[5 + i][4] = blk.tag; }
    }
    var sr = 5 + STUDENT_ROWS;
    ['교시', '신청인원', null, '수강인원', null, '결석인원', null, null, '지도교사'].forEach(function (x, i) { if (x) v[sr][i] = x; });
    for (var k = 1; k <= 4; k++) v[sr + k][0] = k;
    return { values: v, students: list };
  }

  function escHtml(x) {
    return String(x == null ? '' : x).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; });
  }

  /**
   * 엑셀 출석부와 똑같은 모양의 화면 미리보기 (칸 너비·줄 높이·글자·채우기·테두리·병합 모두 원본 서식 그대로)
   * opts.cell(t, c, value, student) 가 문자열을 돌려주면 그 칸 내용을 바꿉니다 (입력칸·버튼 넣기용). t: 블록 안 줄(0~27), c: 칸(0~10)
   */
  function sheetHtml(blk, opts) {
    opts = opts || {};
    var bv = blockValues(blk), v = bv.values;
    var px = function (w) { return Math.round(w * 7 + 5); };
    var cover = {}, span = {};
    blockMerges().forEach(function (m) {
      span[m[0] + ',' + m[1]] = m;
      for (var r = m[0]; r <= m[2]; r++) for (var c = m[1]; c <= m[3]; c++) if (r !== m[0] || c !== m[1]) cover[r + ',' + c] = true;
    });
    var bw = function (x) { return x === 'medium' ? '2px solid #000' : (x === 'thin' ? '1px solid #000' : '0'); };
    var html = '<table class="xls"><colgroup>' + COL_WIDTHS.map(function (w) { return '<col style="width:' + px(w) + 'px">'; }).join('') + '</colgroup><tbody>';
    for (var t = 0; t < BLOCK_ROWS; t++) {
      html += '<tr style="height:' + Math.round(TPL_HEIGHTS[t] * 4 / 3) + 'px">';
      for (var c = 0; c < COLS; c++) {
        if (cover[t + ',' + c]) continue;
        var m = span[t + ',' + c] || [t, c, t, c];
        var st = TPL_STYLES[TPL_GRID[t][c]];
        var L = TPL_STYLES[TPL_GRID[m[0]][m[1]]][6], R = TPL_STYLES[TPL_GRID[m[0]][m[3]]][7];
        var T = TPL_STYLES[TPL_GRID[m[0]][m[1]]][8], B = TPL_STYLES[TPL_GRID[m[2]][m[1]]][9];
        var css = 'font-size:' + Math.round(st[0] * 4 / 3) + 'px;' + (st[1] ? 'font-weight:700;' : '') + (st[2] ? 'background:#' + st[2] + ';' : '') +
          'text-align:' + (st[3] || 'left') + ';vertical-align:' + (st[4] === 'center' ? 'middle' : 'bottom') + ';' + (st[5] ? 'white-space:normal;' : '') +
          'border-left:' + bw(L) + ';border-right:' + bw(R) + ';border-top:' + bw(T) + ';border-bottom:' + bw(B) + ';';
        var stu = (t >= 5 && t < 5 + STUDENT_ROWS) ? bv.students[t - 5] : null;
        var inner = opts.cell ? opts.cell(t, c, v[t][c], stu) : undefined;
        html += '<td' + (m[3] > m[1] ? ' colspan="' + (m[3] - m[1] + 1) + '"' : '') + (m[2] > m[0] ? ' rowspan="' + (m[2] - m[0] + 1) + '"' : '') + (c === 10 ? ' class="xk"' : '') + ' style="' + css + '">' +
          (inner !== undefined && inner !== null ? inner : escHtml(v[t][c])) + '</td>';
      }
      html += '</tr>';
    }
    return html + '</tbody></table>';
  }

  /** blocks: [{ title, line, tag, students:[{school, ban, name}] }] → ExcelJS Workbook */
  function buildWorkbook(ExcelJS, blocks, sheetName) {
    var wb = new ExcelJS.Workbook();
    var last = Math.max(1, blocks.length) * BLOCK_ROWS;
    var ws = wb.addWorksheet(sheetName, {
      properties: { defaultRowHeight: 16.5 },
      pageSetup: { paperSize: 9, orientation: 'portrait', scale: 87, fitToPage: false, fitToWidth: 0, fitToHeight: 0,
        margins: { left: 0.7086614173228347, right: 0.5905511811023623, top: 1.1811023622047245, bottom: 0.984251968503937, header: 0.3937007874015748, footer: 0.1968503937007874 },
        printArea: 'A1:J' + last },
      views: [{ zoomScale: 85, zoomScaleNormal: 85 }]
    });
    COL_WIDTHS.forEach(function (w, i) {
      var col = ws.getColumn(i + 1);
      col.width = w;
      col.font = { name: FONT, size: 11, color: { argb: 'FF000000' }, charset: 129, family: 3 };
    });
    blocks.forEach(function (blk, bi) {
      var r0 = 1 + bi * BLOCK_ROWS;
      // 병합을 먼저 하고, 칸마다 원본 서식을 입힙니다 (병합 뒤에 입혀야 테두리가 남습니다)
      blockMerges().forEach(function (m) { ws.mergeCellsWithoutStyle(r0 + m[0], m[1] + 1, r0 + m[2], m[3] + 1); });
      var v = blockValues(blk).values;
      for (var t = 0; t < BLOCK_ROWS; t++) {
        var row = ws.getRow(r0 + t);
        row.height = TPL_HEIGHTS[t];
        for (var c = 1; c <= COLS; c++) {
          applyStyle(row.getCell(c), TPL_GRID[t][c - 1]);
          if (v[t][c - 1] !== null) row.getCell(c).value = v[t][c - 1];
        }
      }
      var sr = r0 + 5 + STUDENT_ROWS;
      ws.getRow(sr + 4).addPageBreak();
    });
    return wb;
  }

  /* ───────── 연락처 명렬표 (들고 다니며 표시하는 용도) ───────── */

  var CB_COLS = [['번호', 5.5], ['기관(학교)', 17], ['학년/반', 7.5], ['학생명', 9.5], ['신청자', 9.5], ['연락처', 15], ['출석', 7], ['메모', 17]];

  function contactTitle(title) {
    var t = str(title).replace(/\s*수강생\s*명단\s*$/, '');
    return t + ' 명렬표';
  }

  /**
   * blocks: [{ title, line, students:[{school, ban, name, parent, phone}], waits:[{school, ban, name, parent, phone}], waitLabel }]
   * 학생은 출석부와 같은 이름순, 추가대기는 신청 순서 그대로
   */
  function buildContactBook(ExcelJS, blocks, sheetName) {
    var wb = new ExcelJS.Workbook();
    var ws = wb.addWorksheet(sheetName, {
      properties: { defaultRowHeight: 16.5 },
      pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.5, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
      views: [{ zoomScale: 100 }]
    });
    CB_COLS.forEach(function (c, i) { ws.getColumn(i + 1).width = c[1]; });
    var N = CB_COLS.length;
    var thin = { style: 'thin', color: { argb: 'FF000000' } }, med = { style: 'medium', color: { argb: 'FF000000' } };
    var font = function (size, bold) { return { name: FONT, size: size || 11, bold: !!bold, color: { argb: 'FF000000' }, charset: 129, family: 3 }; };
    var fill = function (rgb) { return { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + rgb }, bgColor: { indexed: 64 } }; };
    var r = 1;
    var band = function (text, size, bg, height, bold) {
      ws.mergeCellsWithoutStyle(r, 1, r, N);
      for (var c = 1; c <= N; c++) {
        var cell = ws.getCell(r, c);
        cell.style = { font: font(size, bold), alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
          border: { left: c === 1 ? med : undefined, right: c === N ? med : undefined, top: med, bottom: thin } };
        if (bg) cell.style.fill = fill(bg);
      }
      ws.getCell(r, 1).value = text;
      ws.getRow(r).height = height;
      r++;
    };
    var head = function (labels) {
      labels.forEach(function (h, i) {
        var cell = ws.getCell(r, i + 1);
        cell.value = h;
        cell.style = { font: font(11, true), fill: fill('DBDBDB'), alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
          border: { left: i === 0 ? med : thin, right: i === N - 1 ? med : thin, top: thin, bottom: thin } };
      });
      ws.getRow(r).height = 24;
      r++;
    };
    var line = function (vals, last) {
      vals.forEach(function (v, i) {
        var cell = ws.getCell(r, i + 1);
        if (v !== null && v !== undefined && v !== '') cell.value = v;
        cell.style = { font: font(11, false), alignment: { horizontal: i === 7 ? 'left' : 'center', vertical: 'middle', wrapText: true },
          border: { left: i === 0 ? med : thin, right: i === N - 1 ? med : thin, top: thin, bottom: last ? med : thin } };
      });
      ws.getRow(r).height = 26;
      r++;
    };
    blocks.forEach(function (blk, bi) {
      band(contactTitle(blk.title), 15, 'FFF2CC', 30, true);
      band(blk.line, 11, 'FFF2CC', 22, true);
      if (!blk.waitsOnly) {
        head(CB_COLS.map(function (c) { return c[0]; }));
        var list = byName(blk.students);
        var rows = Math.max(list.length, 1);
        for (var i = 0; i < rows; i++) {
          var s = list[i];
          line(s ? [i + 1, s.school, s.ban, s.name, s.parent, s.phone, '', ''] : ['', '', '', '(학생 없음)', '', '', '', ''], i === rows - 1);
        }
      }
      if (blk.waits && blk.waits.length) {
        if (!blk.waitsOnly) r++;
        band('추가대기 ' + blk.waits.length + '명 · 신청 순서' + (blk.waitLabel ? ' · ' + blk.waitLabel : ''), 12, 'FDE9D9', 24, true);
        head(['순서', '기관(학교)', '학년/반', '학생명', '신청자', '연락처', '연락', '메모']);
        blk.waits.forEach(function (s, k) { line([k + 1, s.school, s.ban, s.name, s.parent, s.phone, '', ''], k === blk.waits.length - 1); });
      }
      if (bi < blocks.length - 1) { ws.getRow(r - 1).addPageBreak(); }
    });
    ws.pageSetup.printArea = 'A1:H' + Math.max(1, r - 1);
    return wb;
  }

  function contactFileName(date, version) {
    var md = date.slice(5, 7) + date.slice(8, 10);
    return '명렬표_' + md + (version > 1 ? '_' + version + '차' : '') + '.xlsx';
  }

  return {
    CAP: CAP, buildContactBook: buildContactBook, contactFileName: contactFileName, contactTitle: contactTitle, officialSchool: officialSchool, normalizeBan: normalizeBan, sortStudents: sortStudents, students: students,
    linkSets: linkSets, split: split, shortTools: shortTools, composeLine: composeLine, defaultSessions: defaultSessions,
    swapPair: swapPair, titleDate: titleDate, fileName: fileName, buildWorkbook: buildWorkbook, byName: byName, blockValues: blockValues, sheetHtml: sheetHtml,
    ROOMS: ROOMS, makeTitle: makeTitle, makeLine: makeLine, autoTag: autoTag, defaultBlock: defaultBlock, parseTitle: parseTitle, parseLine: parseLine, checkBlocks: checkBlocks
  };
})();

if (typeof module !== 'undefined' && module.exports) { module.exports = Roster; }
