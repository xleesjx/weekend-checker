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
ok(R.fileName('2026-11-07', 1) === '출석부_1107.xlsx' && R.fileName('2026-11-07', 2) === '출석부_1107_2차.xlsx', '파일 이름');

console.log('출석부 테스트 ' + passed + '개 통과');
