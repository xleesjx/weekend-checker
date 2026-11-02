/* 실제 통합예약 엑셀과 같은 형식의 연습용 가짜 명단을 만듭니다. (node test/make-dummy.js 출력폴더) */
'use strict';
const fs = require('fs');
const path = require('path');
const { toXls } = require('./fake-data');

const OUT = process.argv[2] || path.join(__dirname, 'dummy-files');
fs.mkdirSync(OUT, { recursive: true });

const FAM = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '전', '홍'];
const GIV = ['하늘', '서준', '하윤', '도윤', '서아', '지호', '지우', '예준', '수아', '시우', '하린', '주원', '지안', '은우', '유나', '건우', '서윤', '민준', '채원', '우진'];
const PAR = ['민정', '수진', '영미', '지현', '은희', '경아', '태호', '유리', '정민', '혜진'];
const SCH = ['가온초', '해솔초등학교', '새솔초', '다솜초등학교', '누리초', '한빛초', '바른초등학교', '푸른초'];
let seq = 0, no = 252000;

function person(i) {
  seq++;
  const fam = FAM[(i * 7 + seq) % FAM.length];
  return { student: fam + GIV[(i * 3 + seq) % GIV.length], parent: fam + PAR[(i + seq) % PAR.length], phone: '010-0000-' + String(1000 + seq).slice(-4), uid: 'dummy' + seq };
}

function row(title, p, school, ban, opt) {
  opt = opt || {};
  no += 1;
  const student = opt.student !== undefined ? opt.student : p.student;
  const sch = opt.school !== undefined ? opt.school : school;
  const b = opt.ban !== undefined ? opt.ban : ban;
  return [String(opt.no || no), title, opt.parent || p.parent, opt.phone || p.phone, '', opt.kind || '개인', '', opt.cnt || '',
    [student, sch, b].join(' '), student, sch, b, opt.state || '대기', opt.uid || p.uid];
}

function cls(title, grades, n, specials) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    const p = person(i);
    const g = grades[i % grades.length];
    const ban = i % 3 === 0 ? g + '학년' + ((i % 5) + 1) + '반' : g + '-' + ((i % 6) + 1);
    rows.push(row(title, p, SCH[i % SCH.length], ban, { state: i % 4 === 0 ? '승인' : '대기' }));
  }
  return rows.concat(specials || []);
}

const T = {
  basic: '[초2~3학년]11월7일 주말SW교실 기초코딩 오전반 ',
  explore: '[초3~5학년]11월7일 주말SW교실 탐험코딩 오전반 ',
  master: '[초5~중2학년]11월7일~12월5일 주말SW교실 마스터코딩 오전반 ',
  c1: '[초1학년]11월7일 주말창의교실 창의융합 1,2반 오후 ',
  c2: '[초2~3학년]11월7일 주말창의교실 창의융합 1,2반 오후 ',
  c34: '[초3~6학년]11월7일 주말창의교실 창의융합 3,4반 오후 '
};

// 여러 반에 걸쳐 쓰는 가짜 학생
const dupKid = { student: '문가람', parent: '문엄마', phone: '010-0000-7001', uid: 'dummy_dup' };
const masterKid = { student: '배도현', parent: '배아빠', phone: '010-0000-7002', uid: 'dummy_master' };
const restricted = { student: '정우진', parent: '정엄마', phone: '010-0000-7003', uid: 'dummy_rest' };

const basicSpecial = [
  row(T.basic, dupKid, '가온초', '3-2'),                                                     // 탐험과 중복
  row(T.basic, person(1), '', '', { student: '가온초등학교', school: '2', ban: '3' }),      // 칸 순서 바뀜
  row(T.basic, person(2), '부산누리초', '2-1'),                                             // 관외 학교
  row(T.basic, { student: '한지우', parent: '한지우', phone: '010-0000-7004', uid: 'student_id' }, '새솔초', '2-4'), // 학생 아이디로 신청
  row(T.basic, person(3), '가온초', '5-1')                                                  // 학년 오류 (5학년)
];
const exploreSpecial = [
  row(T.explore, dupKid, '가온초등학교', '3학년2반', { state: '추가대기' }),                 // 기초와 중복
  row(T.explore, masterKid, '가온초', '5-1'),                                               // 마스터와 중복
  row(T.explore, person(4), '홈스쿨링', '4'),                                               // 홈스쿨링
  row(T.explore, restricted, '다솜초', '4-2'),                                              // 신청 제한 (시트에 등록하면)
  row(T.explore, person(5), '누리초', '삼학년'),                                            // 학년 알 수 없음
  row(T.explore, person(6), '바른초', '4-3', { state: '예약취소' })                         // 예약취소
];
const masterSpecial = [
  row(T.master, masterKid, '가온초', '5-1', { state: '승인' }),
  row(T.master, person(7), '누리중학교', '1-4', { state: '승인' }),                          // 중1 정상
  row(T.master, person(8), '누리중', '3-1', { state: '승인' })                               // 중3 대상 밖
];
const c2Special = [
  row(T.c2, person(9), '해솔초', '3학년1반', { kind: '단체', cnt: '3' }),                   // 단체 신청
  row(T.c2, { student: '하지안', parent: '하은정', phone: '010-0000-7005', uid: 'dummy_sib' }, '새솔초', '2-3'),
  row(T.c2, { student: '하지우', parent: '하은정', phone: '010-0000-7005', uid: 'dummy_sib' }, '새솔초', '3-3') // 형제 (정상)
];

const day = process.env.DUMMY_DAY || '2026-11-03';
const name = (hhmmss, ms) => '통합예약신청자목록 - ' + day + 'T' + hhmmss + '.' + ms + '.xls';

const basicAll = cls(T.basic, ['2', '3'], 22, basicSpecial);
const files = [
  [name('100325', '738'), basicAll.slice(0, 15)],           // 기초: 먼저 받은 파일 (건너뛰어야 함)
  [name('105412', '000'), basicAll],                        // 기초: 나중에 받은 파일 (반영)
  [name('100929', '158'), cls(T.explore, ['3', '4', '5'], 10, exploreSpecial)],
  [name('101043', '786'), cls(T.master, ['5', '6'], 8, masterSpecial)],
  [name('101105', '426'), cls(T.c1, ['1'], 9)],
  [name('105352', '209'), cls(T.c2, ['2', '3'], 17, c2Special)],
  [name('105433', '586'), cls(T.c34, ['3', '4', '5', '6'], 26)],
  ['통합예약신청자목록 - 2026-10-27T101043.786.xls', cls(T.basic.replace('11월7일', '10월31일'), ['2'], 5)] // 지난주 파일 (무시)
];
files.forEach(([n, rows]) => fs.writeFileSync(path.join(OUT, n), toXls(rows)));
console.log(files.length + '개 파일을 만들었습니다: ' + OUT);
