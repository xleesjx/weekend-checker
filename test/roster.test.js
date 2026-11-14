/* 출석부 로직 테스트 */
'use strict';
const assert = require('assert');
global.Core = require('../docs/core.js');
const R = require('../docs/roster.js');

let passed = 0;
function ok(c, m) { assert.ok(c, m); passed++; }

const schools = [
  { name: '가온초등학교', level: '초' }, { name: '울산남부초등학교', level: '초' }, { name: '울주명지초등학교', level: '초' },
  { name: '해솔초등학교', level: '초' }, { name: '해솔중학교', level: '중' }, { name: '누리초등학교', level: '초' }, { name: '울산초등학교', level: '초' }
];
ok(R.officialSchool('가온초', schools).name === '가온초등학교', '가온초 → 정식 이름');
ok(R.officialSchool('남부초', schools).name === '울산남부초등학교', '남부초 → 울산남부초등학교');
ok(R.officialSchool('명지초등학교', schools).name === '울주명지초등학교', '울주 붙은 정식 이름');
ok(R.officialSchool('해솔중', schools).name === '해솔중학교', '학교급으로 구분');
ok(!R.officialSchool('해솔', schools).ok, '초·중 둘 다 있으면 확인 필요');
ok(!R.officialSchool('부산누리초', schools).ok, '목록에 없으면 확인 필요');
ok(R.officialSchool('울산초', schools).name === '울산초등학교', '울산초');

[['3학년2반', '3-2'], ['3-2', '3-2'], ['3ㅡ2', '3-2'], ['3.2', '3-2'], ['3 2', '3-2'], ['32', '3-2'], ['3', '3-1'], ['3학년', '3-1'], ['2학년 10반', '2-10'], ['중1-2', '1-2']]
  .forEach(([a, b]) => ok(R.normalizeBan(a).ban === b && R.normalizeBan(a).ok, '학반 ' + a + ' → ' + b + ' (' + R.normalizeBan(a).ban + ')'));
ok(!R.normalizeBan('삼학년').ok, '학반 해석 불가');

function stu(no, name, school, grade1) { return { no: String(no), name, school, grade1: !!grade1, ban: '2-1' }; }
// 30명: 15/15
let list = [];
for (let i = 0; i < 30; i++) list.push(stu(i, '학생' + String(i).padStart(2, '0'), '학교' + String.fromCharCode(65 + Math.floor((i + 1) / 2))));
let res = R.split(list, []);
ok(res.ok && res.parts[0].length === 15 && res.parts[1].length === 15, '30명 → 15/15');
const even = []; for (let i = 0; i < 30; i++) even.push(stu(i, '학생' + i, '학교' + String.fromCharCode(65 + Math.floor(i / 2))));
const r2 = R.split(even, []);
ok(r2.ok && r2.parts.map((p) => p.length).join() === '14,16', '모든 학교가 2명이면 같은 학교 유지가 우선 (14/16)');
// 같은 학교는 같은 반
const schoolOf = (p) => new Set(p.map((s) => s.school));
ok([...schoolOf(res.parts[0])].every((s) => !schoolOf(res.parts[1]).has(s)), '같은 학교가 두 반으로 나뉘지 않음');
// 경계에 3명 학교가 걸리면 교체해서 맞춤
list = [];
const sizes = [2, 2, 2, 2, 2, 2, 2, 3, 3, 2, 2, 2, 2, 2, 1, 1]; // 32명
let no = 0;
sizes.forEach((n, k) => { for (let j = 0; j < n; j++) list.push(stu(no++, '이름' + no, '학교' + String.fromCharCode(65 + k))); });
res = R.split(list, []);
ok(res.ok && res.parts[0].length === 16 && res.parts[1].length === 16, '32명, 3명 학교 포함 → 16/16: ' + (res.parts && res.parts.map((p) => p.length)));
ok([...schoolOf(res.parts[0])].every((s) => !schoolOf(res.parts[1]).has(s)), '교체해도 같은 학교 유지');
// 같은 반 요청
res = R.split(list, [{ id: 'L1', nos: ['0', '31'] }]);
const sideOf = (no) => (res.parts[0].some((s) => s.no === no) ? 0 : 1);
ok(res.ok && sideOf('0') === sideOf('31'), '다른 학교라도 같은 반 요청은 같은 반');
ok(res.parts.every((p) => p.length <= 16), '16명 이하 유지');
// 1학년 균등 (10명 + 22명)
list = [];
for (let i = 0; i < 10; i++) list.push(stu('g' + i, '일' + i, '1학년학교' + (i < 6 ? 'A' : String.fromCharCode(66 + i)), true));
for (let i = 0; i < 22; i++) list.push(stu('h' + i, '이' + i, '학교' + String.fromCharCode(65 + Math.floor(i / 2)), false));
res = R.split(list, [], { balanceGrade1: true });
const g1 = res.parts.map((p) => p.filter((s) => s.grade1).length);
ok(res.ok && res.parts.every((p) => p.length === 16) && Math.abs(g1[0] - g1[1]) <= 2, '창의 1,2반 1학년 균등: ' + g1 + ' / ' + res.parts.map((p) => p.length));
// 불가능하면 오류
list = [];
for (let i = 0; i < 17; i++) list.push(stu(i, '가' + i, '한학교'));
res = R.split(list, []);
ok(res.error && res.units.length === 1, '한 학교 17명이면 사용자에게 문의');

ok(R.shortTools('노트북 8대').text === '노트북' && R.shortTools('노트북 8대').generic, '공용 기기만 있으면 그대로 + 확인 표시');
ok(R.shortTools('로비코, 태블릿PC').text === '로비코', '공용 기기는 뺌');
ok(R.shortTools('첨성대 만들기, 스크랩북 만들기 10p (5매) (첨성대 과학적 원리 정리 책...').text === '첨성대, 스크랩북', '수량·괄호·만들기 제거: ' + R.shortTools('첨성대 만들기, 스크랩북 만들기 10p (5매) (첨성대 과학적 원리 정리 책...').text);
ok(R.shortTools('핑거워, 카보').text === '핑거워, 카보', '같은 수업 교구는 쉼표');
ok(R.composeLine('놀이1/과학1', '창의실/혜윰실', { 놀이1: '핑거워, 카보', 과학1: '풍속계' }) === '1-2교시 창의실, 3-4교시 혜윰실(핑거워, 카보/풍속계)', '다른 수업은 슬래시');
ok(R.composeLine('탐험', '창의실', { 탐험: '캡컷' }) === '1-4교시 창의실(캡컷)', '한 수업');
ok(R.defaultSessions('기초 1,2반', 1, 2) === '기초2/기초1' && R.defaultSessions('창의 3,4반', 0, 2) === '놀이2/과학2' && R.defaultSessions('메이커1', 0, 1) === '메이커1', '기본 수업 연결');
ok(R.titleDate('10월 31일 주말SW프로그램 기초코딩 오전1반 수강생 명단', '2026-11-07') === '11월 7일 주말SW프로그램 기초코딩 오전1반 수강생 명단', '제목 날짜 바꾸기');
ok(R.fileName('2026-11-07', 1) === '출석부_1107.xlsx' && R.fileName('2026-11-07', 3) === '출석부_1107.xlsx' && R.contactFileName('2026-11-07', 2) === '명렬표_1107.xlsx', '파일 이름은 차수 없이 날짜만');

// 반 설정
const blk = { program: 'SW', name: '기초코딩 오전1반', room1: '라온실', room2: '놀이실', tool1: '스케치북', tool2: '3D펜' };
ok(R.makeTitle('2026-11-07', blk) === '11월 7일 주말SW프로그램 기초코딩 오전1반 수강생 명단', '제목 만들기');
ok(R.makeLine(blk) === '1-2교시 라온실, 3-4교시 놀이실(스케치북/3D펜)', '교실·교구 줄');
ok(R.makeLine({ same: true, room1: '창의실', tool1: '네오싱카' }) === '1-4교시 창의실(네오싱카)', '1~4교시 같은 교실');
[['기초코딩 오전1반', '기초1'], ['기초코딩 오전2반', '기초2'], ['탐험코딩 오전반', '탐험'], ['마스터코딩 오전반', '마스터'], ['오후3반', '3'], ['메이커1반', '메이커1']]
  .forEach(([a, b]) => ok(R.autoTag(a) === b, '신청반 자동 ' + a + ' → ' + R.autoTag(a)));
ok(R.defaultBlock('기초 1,2반', 1, 2, '오전', 2).name === '기초코딩 오전2반' && R.defaultBlock('창의 3,4반', 0, 2, '오후', 3).name === '오후3반' && R.defaultBlock('창의 3,4반', 0, 2, '오후', 3).program === '창의', '기본 반 이름');
ok(R.parseTitle('10월 31일 주말SW프로그램 기초코딩 오전1반 수강생 명단 ').name === '기초코딩 오전1반', '예전 제목 읽기');
const B = (o) => Object.assign({ program: 'SW', name: 'x', room1: '', room2: '', tool1: 't', tool2: 't', time: '오전', group: 'g' }, o);
let ck = R.checkBlocks([B({ name: '기초코딩 오전1반', group: '기초', room1: '라온실', room2: '놀이실' }), B({ name: '기초코딩 오전2반', group: '기초', room1: '놀이실', room2: '라온실' }), B({ name: '탐험코딩 오전반', group: '탐험', same: true, room1: '창의실' })]);
ok(!ck.errors.length && !ck.warns.length, '정상 반 설정: ' + JSON.stringify(ck));
ck = R.checkBlocks([B({ name: '기초코딩 오전1반', group: '기초', room1: '라온실', room2: '놀이실' }), B({ name: '탐험코딩 오전반', group: '탐험', same: true, room1: '라온실' })]);
ok(ck.errors.some((e) => /겹칩니다/.test(e.msg)), '같은 시간 같은 교실 겹침');
ck = R.checkBlocks([B({ name: '기초코딩 오전1반', group: '기초', room1: '라온실', room2: '놀이실' }), B({ name: '기초코딩 오전2반', group: '기초', room1: '혜윰실', room2: '창의실' })]);
ok(ck.warns.some((e) => /바뀌어/.test(e.msg)), '1반·2반 교실 순서 확인');
ck = R.checkBlocks([B({ name: '오후1반', time: '오후', room1: '창의실', room2: '혜윰실' }), B({ name: '오후1반', time: '오후', room1: '놀이실', room2: '라온실' }), B({ name: '', time: '오후' })]);
ok(ck.errors.some((e) => /제목이 같습니다/.test(e.msg)) && ck.errors.some((e) => /반 이름이 비어/.test(e.msg)) && ck.errors.some((e) => /교실을 골라/.test(e.msg)), '같은 제목·빈 칸');
ok(!R.checkBlocks([B({ name: '기초코딩 오전1반', room1: '라온실', room2: '놀이실' }), B({ name: '오후1반', time: '오후', room1: '라온실', room2: '놀이실' })]).errors.length, '오전·오후는 같은 교실 써도 됨');

const pl = R.parseLine('1-2교시 창의실, 3-4교시 혜윰실(핏츠, 코너드/펑펑 눈내리는 마을)');
ok(pl && pl.room1 === '창의실' && pl.room2 === '혜윰실' && pl.tool1 === '핏츠, 코너드' && pl.tool2 === '펑펑 눈내리는 마을', '문구에서 교실·교구 읽기');
const pl2 = R.parseLine('1-4교시 라온실(파이썬)');
ok(pl2 && pl2.same && pl2.room1 === '라온실' && pl2.tool1 === '파이썬', '1~4교시 문구 읽기');
ok(R.makeLine(pl) === '1-2교시 창의실, 3-4교시 혜윰실(핏츠, 코너드/펑펑 눈내리는 마을)', '읽은 값으로 같은 문구 다시 만들기');

// 출석부 출력은 이름 가나다순
const bv = R.blockValues({ title: 'T', line: 'L', tag: '기초1', students: [{ name: '하나', school: '가온초등학교', ban: '3-1' }, { name: '가람', school: '해솔초등학교', ban: '3-2' }, { name: '나래', school: '가온초등학교', ban: '3-3' }] });
ok(bv.values[5][3] === '가람' && bv.values[6][3] === '나래' && bv.values[7][3] === '하나' && bv.values[5][1] === '해솔초등학교', '출석부 학생은 이름순');
ok(bv.values[4][5] === '1교시' && bv.values[23][1] === '신청인원' && bv.values[27][0] === 4 && bv.values[20][0] === 16 && bv.values[21][0] === null, '교시·출결 통계 칸');
const html = R.sheetHtml({ title: '제목<x>', line: 'L', tag: 't', students: [] });
ok(/colspan="10" rowspan="2"/.test(html) && /제목&lt;x&gt;/.test(html) && (html.match(/<tr/g) || []).length === 28 && /출석여부/.test(html) && /지도교사/.test(html), '화면 미리보기도 엑셀 28줄 그대로');


// 반별 제목 색: 설정 → 원본 색(이름) → 겹치지 않는 색, 같은 수업반은 같은 색
const gc = R.groupColors([{ name: '기초코딩', color: '' }, { name: '탐험코딩', color: '' }, { name: '마스터코딩', color: '' }, { name: '창의 1,2반', color: '' }, { name: '창의 3,4반', color: '' }, { name: '기초코딩', color: '' }, { name: '새수업', color: '00ff00' }]);
ok(gc['기초코딩'] === 'FFF2CC' && gc['탐험코딩'] === 'BDD7EE' && gc['마스터코딩'] === 'E2F0D9', '이름으로 원본 출석부 색');
ok(gc['창의 1,2반'] !== gc['창의 3,4반'] && gc['창의 1,2반'] === 'C6D9FE' && gc['창의 3,4반'] === 'FEBEC9', '나머지 수업반은 겹치지 않는 색');
ok(gc['새수업'] === '00FF00', '설정에서 고른 색이 먼저');
ok(R.groupColors([{ name: 'A', color: 'zzz' }])['A'] === 'C6D9FE', '잘못된 색은 자동');
const hc = R.sheetHtml({ title: 'T', line: 'L', tag: 't', color: 'FEBEC9', students: [] });
ok((hc.match(/background:#FEBEC9/g) || []).length === 2 && /background:#DBDBDB/.test(hc) && !/background:#FFF2CC/.test(hc), '제목·교시 줄만 반 색, 머리줄 회색은 그대로: ' + (hc.match(/background:#FEBEC9/g) || []).length);
// 오른쪽 바깥 테두리는 맨 아래 서명 칸까지 굵게
const lastRows = hc.split('<tr').slice(24, 29);
ok(lastRows.length === 5 && lastRows.every((r) => { const tds = r.match(/<td[^>]*>/g) || []; return /border-right:2px solid #000/.test(tds[tds.length - 2]); }), '서명 칸 오른쪽 바깥 테두리 굵게');
// 인쇄용: 화면 전용 11번째 칸 없음, 배율·줄 높이 늘림
const ph = R.sheetHtml({ title: 'T', line: 'L', tag: 't', students: [] }, { print: true });
ok((ph.match(/<col /g) || []).length === 10 && !/class="xk"/.test(ph) && /zoom:0\.936/.test(ph), '인쇄용 표는 10칸 + 배율');
ok((R.sheetHtml({ title: 'T', line: 'L', tag: 't', students: [] }).match(/<col /g) || []).length === 11, '화면 미리보기는 11칸(버튼 열 포함)');
// 엑셀 파일: 제목 색, 오른쪽 굵은 테두리, 여백 20mm
const ExcelJS = require('../docs/vendor/exceljs.min.js');
const wb = R.buildWorkbook(ExcelJS, [{ title: 'T', line: 'L', tag: 't', color: 'BDD7EE', students: [] }, { title: 'T2', line: 'L2', tag: 't', students: [] }], '1107');
const ws = wb.worksheets[0];
ok(ws.getCell(1, 1).fill.fgColor.argb === 'FFBDD7EE' && ws.getCell(3, 1).fill.fgColor.argb === 'FFBDD7EE' && ws.getCell(4, 1).fill.fgColor.argb === 'FFDBDBDB', '엑셀 제목 색 / 머리줄 회색');
ok(ws.getCell(29, 1).fill.fgColor.argb === 'FFFFF2CC', '색을 안 정한 반은 기본 노랑');
ok([24, 25, 26, 27, 28].every((r) => ws.getCell(r, 10).border.right.style === 'medium'), '엑셀 서명 칸 오른쪽 테두리 굵게');
ok(Math.abs(ws.pageSetup.margins.left * 25.4 - 20) < 0.1 && Math.abs(ws.pageSetup.margins.bottom * 25.4 - 20) < 0.1 && ws.pageSetup.scale === 93, '엑셀 인쇄 여백 20mm · 배율 93%');
const cb = R.buildContactBook(ExcelJS, [{ title: '11월 7일 기초', line: 'L', color: 'FEBEC9', students: [], waits: [] }], '1107');
ok(cb.worksheets[0].getCell(1, 1).fill.fgColor.argb === 'FFFEBEC9' && Math.abs(cb.worksheets[0].pageSetup.margins.top * 25.4 - 20) < 0.1, '명렬표도 제목 색·여백 20mm');
const chtml = R.contactHtml([{ title: 'T', line: 'L', color: 'FEBEC9', students: [], waits: [] }]);
ok(/class="cb-t1" style="background:#FEBEC9"/.test(chtml), '명렬표 인쇄도 제목 색');


// 게시용 명단표: 16줄 고정, 교실 강조, 출석여부·비고·통계·신청반 없음
const pst = (n, extra) => Object.assign({ title: '11월 14일 주말SW프로그램 기초코딩 오전1반 수강생 명단', line: '1-2교시 라온실, 3-4교시 놀이실(기어목걸이 만들기/템플, 언더워터)', program: 'SW', name: '기초코딩 오전1반', same: false, room1: '라온실', room2: '놀이실', tool1: '기어목걸이 만들기', tool2: '템플, 언더워터', color: 'BDD7EE',
  students: Array.from({ length: n }, (_, i) => ({ name: '학생' + String(i).padStart(2, '0'), school: '가온초등학교', ban: '3-1', status: '' })) }, extra || {});
const ph8 = R.postSheetHtml(pst(8), '2026-11-14'), ph16 = R.postSheetHtml(pst(16), '2026-11-14');
const bodyRows = (h) => (h.match(/<tbody>[\s\S]*<\/tbody>/)[0].match(/<tr>/g) || []).length;
ok(bodyRows(ph8) === 16 && bodyRows(ph16) === 16, '게시용은 학생 수와 상관없이 16줄');
ok(ph8.match(/--rh:[\d.]+mm/)[0] === ph16.match(/--rh:[\d.]+mm/)[0], '게시용 줄 높이는 모든 반이 같음');
ok(!/출석여부|비고|신청인원|수강인원|결석인원|지도교사|신청반/.test(ph16), '게시용에는 출석 칸·통계·신청반이 없음');
ok(/SW 기초코딩 오전1반 수강생 명단/.test(ph8) && /11월 14일 기어목걸이 만들기\/템플, 언더워터/.test(ph8), '게시용 제목: 프로그램+반 이름 / 날짜+교구');
ok(/1-2교시<\/span> <b class="po-r1">라온실<\/b><span class="po-s">, 3-4교시<\/span> <b class="po-r2">놀이실/.test(ph8), '교실 줄: 첫 교실 강조(po-r1) + 둘째 교실');
ok(/--pc:#BDD7EE/.test(ph8), '게시용 제목 색은 반 색');
ok(/<td>학생07<\/td>/.test(ph8) && /<td>9<\/td><td><\/td><td><\/td><td><\/td>/.test(ph8), '학생 이름 + 빈 줄에는 번호만');
const ps = R.postSheetHtml(pst(3, { same: true, room2: '', tool2: '', room1: '라온실', tool1: '파이썬', name: '마스터코딩 오전반' }), '2026-11-14');
ok(/1-4교시<\/span> <b class="po-r1">라온실<\/b>/.test(ps) && !/po-r2/.test(ps), '한 교실짜리 수업은 1-4교시 교실만');
const pOld = R.postSheetHtml({ title: '11월 14일 주말창의프로그램 오후1반 수강생 명단', line: '1-2교시 놀이실, 3-4교시 라온실(A/B)', students: [] }, '2026-11-14');
ok(/창의 오후1반 수강생 명단/.test(pOld) && /po-r1">놀이실/.test(pOld) && /11월 14일 A\/B/.test(pOld), '교실 칸이 없는 예전 저장본도 문구에서 읽음');
const p17 = R.postSheetHtml(pst(18), '2026-11-14');
ok(bodyRows(p17) === 18 && Number(p17.match(/--rh:([\d.]+)mm/)[1]) < 12, '17명 이상이면 줄 높이만 줄여 한 장에 맞춤');
ok(R.postFileName('2026-11-14') === '게시용_1114.xlsx', '게시용 엑셀 파일 이름');
const pwb = R.buildPostBook(ExcelJS, [pst(8), pst(16, { name: '탐험코딩 오전반', same: true, room2: '', color: '' })], '1114', '2026-11-14');
const pws = pwb.worksheets[0];
ok(pws.getCell(1, 1).fill.fgColor.argb === 'FFBDD7EE' && pws.getCell(1, 1).value === 'SW 기초코딩 오전1반 수강생 명단', '게시용 엑셀 제목·색');
const rtv = pws.getCell(3, 1).value;
ok(rtv.richText && rtv.richText[1].text === '라온실' && rtv.richText[1].font.color.argb === 'FFC00000' && rtv.richText[1].font.size === 34, '게시용 엑셀 교실: 첫 교실 빨강·34pt');
ok(pws.getCell(4, 1).value === '번호' && pws.getCell(5, 4).value === '학생00' && pws.getCell(20, 1).value === 16 && pws.getCell(13, 4).value === '' || pws.getCell(13, 4).value === null, '게시용 엑셀: 머리글 + 16줄');
ok(pws.getRow(5).height === pws.getRow(20).height && pws.getRow(20).height > 30, '게시용 엑셀 줄 높이 통일');
ok(/탐험코딩 오전반/.test(pws.getCell(21, 1).value) && pws.getCell(21, 1).fill.fgColor.argb === 'FFFFF2CC', '둘째 반은 다음 장에서 시작, 색을 안 정하면 기본 노랑');
ok(pws.getCell(5, 4).border.right.style === 'medium' && pws.getCell(20, 1).border.bottom.style === 'medium', '게시용 엑셀 바깥 테두리 굵게');
ok(Math.abs(pws.pageSetup.margins.left * 25.4 - 20) < 0.1 && pws.pageSetup.printArea === 'A1:D40', '게시용 엑셀 여백 20mm · 인쇄 범위: ' + pws.pageSetup.printArea);
// 인쇄용 굵은 선은 3px
ok(/border-left:3px solid #000/.test(R.sheetHtml({ title: 'T', line: 'L', tag: 't', students: [] }, { print: true })) && /border-left:2px solid #000/.test(R.sheetHtml({ title: 'T', line: 'L', tag: 't', students: [] })), '인쇄용 굵은 선 3px, 화면은 2px');

console.log('출석부 테스트 ' + passed + '개 통과');
