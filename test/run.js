/* 전체 흐름 테스트: 초기 설정 → 업로드(연결 포함) → 점검 결과 → 처리 → 충돌 → 마스터 유지 */
'use strict';
const assert = require('assert');
const Core = require('../docs/core.js');
const { createEnv } = require('./harness');
const { files, toXls, parseXls } = require('./fake-data');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }
function load(f) { return parseXls(toXls(f.rows), f.name); }
function codes(row) { return row.issues.map((i) => i.code).sort().join(','); }

/* 1. 판정 로직 단위 테스트 */
(function unit() {
  ok(Core.parseFileName('통합예약신청자목록 - 2026-10-27T100325.738.xls').ts === '2026-10-27T10:03:25.738', '파일 이름 해석');
  ok(Core.parseFileName('통합예약신청자목록 - 2026-10-27T100325.738 (1).xls').date === '2026-10-27', '시각 이름 + (1)');
  ok(Core.isListFile('통합예약신청자목록.xls') && Core.isListFile('통합예약신청자목록 (2).xls') && !Core.isListFile('다른파일.xls') && !Core.isListFile('통합예약신청자목록 복사본.xls'), '명단 파일 이름 판별');
  const kst = Date.parse('2026-11-03T10:54:12.000+09:00');
  ok(Core.fileStamp('통합예약신청자목록 (1).xls', kst).ts === '2026-11-03T10:54:12.000', '시각 없는 이름은 파일 저장 시각(한국 시각)');
  ok(Core.fileStamp('통합예약신청자목록 - 2026-10-27T100325.738.xls', kst).date === '2026-10-27', '이름의 시각이 우선');
  ok(Core.inWindow('2026-11-01', '2026-11-07') && !Core.inWindow('2026-10-31', '2026-11-07') && Core.inWindow('2026-11-07', '2026-11-07'), '접수 기간 = 수업일 6일 전~수업일');
  const t = Core.parseTitle('[초5~중2학년]11월7일~12월5일 주말SW교실 마스터코딩 오전반 ', '2026');
  ok(t.start === '2026-11-07' && t.end === '2026-12-05' && t.grade.min === 5 && t.grade.max === 8, '마스터 예약명 기간·학년');
  ok(Core.instanceCovers('2026-11-07~2026-12-05', '2026-11-21') && !Core.instanceCovers('2026-11-07~2026-12-05', '2026-12-12'), '마스터 기간 포함 여부');
  ok(Core.schoolKey('울산중앙중학교') === '중앙' && Core.schoolKey('울산중앙중') === '중앙' && Core.schoolKey('중앙중') === '중앙', '울산 붙여도 빼도 같은 학교');
  ok(Core.schoolKey('울주명지초등학교') === '명지' && Core.schoolKey('명지초') === '명지', '울주 붙여도 빼도 같은 학교');
  ok(Core.schoolKey('울산초등학교') === '울산' && Core.schoolKey('울산초') === '울산' && Core.schoolKey('울산중') === '울산', '울산초·울산중은 그대로');
  const ridx = Core.buildSchoolIndex([{ name: '울산중앙중학교', level: '중' }]);
  const rrow = (school) => ['1', 't', '부모', '010', '', '개인', '', '', '', '학생', school, '1-2', '대기', 'id'];
  ['울산중앙중', '중앙중', '울산중앙중학교'].forEach((sc) => {
    const a = Core.analyzeRound([{ no: '1', row: rrow(sc), cls: { 시간대: '오전', 수업반: 'x', 접수명: 'x', range: { min: 5, max: 8 } } }], { schools: [{ name: '울산중앙중학교', level: '중' }] }, '2026-11-07');
    ok(!a['1'].issues.length, sc + ' → 관내·중1 정상: ' + a['1'].issues.map((i) => i.label).join(','));
  });
  ok(!!ridx['중앙'], '학교 목록 색인');
  // 출석부로 옮길 때 걸리는 것도 점검 목록에서 미리 확인 필요로
  const sch2 = [{ name: '가온초등학교', level: '초' }, { name: '가온중학교', level: '중' }, { name: '해솔초등학교', level: '초' }];
  const chk = (school, ban) => Core.analyzeRound([{ no: '1', row: ['1', 't', '부모', '010', '', '개인', '', '', '', '학생', school, ban, '대기', 'id'], cls: { 시간대: '오전', 수업반: 'x', 접수명: 'x', range: { min: 1, max: 9 } } }], { schools: sch2 }, '2026-11-07')['1'].issues.map((i) => i.detail);
  ok(chk('가온', '3-2').some((d) => /정식 이름.*가온초등학교 \/ 가온중학교/.test(d)), '학교급 없이 줄여 쓴 학교명: ' + chk('가온', '3-2'));
  ok(chk('해솔', '3-2').some((d) => /정식 이름/.test(d)), '후보 하나라도 학교급이 없으면 확인');
  ok(!chk('해솔초', '3-2').length && !chk('가온초등학교', '3학년 2반').length && !chk('해솔초', '32').length && !chk('해솔초', '3').length, '정상 학교명·학반은 통과');
  ok(chk('해솔초', '1-!').some((d) => /학반 형식/.test(d)), '1-! 학반 형식');
  ok(chk('해솔초', '60407').some((d) => /학반 형식/.test(d)), '60407 학반 형식');
  ok(chk('해솔초', '0-3').length === 1, '학년 오류와 학반 형식은 한 번만');
  const g = Core.parseGradeRange('초2~3학년');
  ok(g.min === 2 && g.max === 3, '학년 범위');
  ok(Core.nextClassDate([{ date: '2026-10-31' }, { date: '2026-11-07' }, { date: '2026-11-28' }], '2026-11-07') === '2026-11-28', '휴강 뒤 다음 수업일');
  ok(Core.currentRound([{ date: '2026-10-31' }, { date: '2026-11-07' }], '2026-11-03') === '2026-11-07', '현재 회차');
})();

/* 2. 서버 흐름 */
const env = createEnv({ now: new Date('2026-11-04T10:00:00+09:00') });
env.ctx.setupSheets();
env.props.REV = '1';
// 학교 목록 (가짜)
env.ctx.writeTable_('설정_학교', [['가온초등학교', '초'], ['해솔초등학교', '초'], ['새솔초등학교', '초'], ['다솜초등학교', '초'], ['누리중학교', '중']]);
// 제한 명단: 10/31 결석 → 11/7 제한
env.ctx.writeTable_('신청제한', [['2026-10-31', '정우진', '다솜초', '결석', '', '', '관리자']]);
env.ctx.writeTable_('점검자', [['owner@example.com', '이승주'], ['kim@example.com', '김선생']]);

let res = env.call('state', {});
ok(res.ok && res.date === '2026-11-07', '오늘(11/4) 기준 회차는 11/7: ' + res.date);
ok(env.call('state', {}, 'stranger@example.com').code === 'FORBIDDEN', '등록 안 된 계정 차단');

const all = [files.basic_old, files.basic, files.explore, files.master, files.c1, files.c2, files.lastweek].map(load);
res = env.call('upload', { date: '2026-11-07', files: all });
ok(res.ok, '업로드 응답 ' + (res.error || ''));
const by = {};
res.results.forEach((r) => { by[r.file] = r; });
ok(by[files.basic_old.name].result === '건너뜀', '같은 반 이전 파일 건너뜀');
ok(by[files.basic.name].result === '반영' && by[files.basic.name].count === 6, '기초 최신 파일 반영');
ok(by[files.lastweek.name].result === '건너뜀', '지난 회차 파일 무시');
ok(by[files.master.name].result === '반영', '마스터 반영');
ok(res.needMap.length === 2, '창의 두 예약명은 연결 필요: ' + res.needMap.length);

const maps = {};
res.needMap.forEach((n) => { maps[n.key] = /\[초1학년\]/.test(n.title) ? '창의 1,2반 [1학년]' : '창의 1,2반 [2~3학년]'; });
res = env.call('upload', { date: '2026-11-07', files: all.filter((f) => f === all[4] || f === all[5]), mappings: maps }, 'kim@example.com');
ok(res.results.filter((r) => r.result === '반영').length === 2 && !res.needMap.length, '연결 후 반영');

// 같은 파일을 다시 올리면 막힘
res = env.call('upload', { date: '2026-11-07', files: [all[1]] });
ok(res.results[0].result === '건너뜀' && /이미 더 최근/.test(res.results[0].detail), '이미 올린 명단 재업로드 차단');

res = env.call('state', { date: '2026-11-07' });
const row = (no) => res.rows.find((r) => r.no === no);
ok(res.rows.length === 18, '11/7 신청 수 18: ' + res.rows.length);
ok(/DUP/.test(codes(row('251204'))) && /DUP/.test(codes(row('251188'))), '기초·탐험 같은 오전 중복');
ok(/GRADE/.test(codes(row('251188'))), '탐험 2학년 → 대상 학년');
ok(codes(row('251240')) === 'OUTSIDE', '관외 학교: ' + codes(row('251240')));
ok(/INPUT/.test(codes(row('251245'))), '순서 바뀐 입력');
ok(codes(row('251178')) === '', '정상 신청(해솔초등학교 3학년2반)');
ok(codes(row('251162')) === '', '2ㅡ5 학반·두 글자 이름 정상: ' + codes(row('251162')));
ok(codes(row('251215')) === 'INPUT', '홈스쿨링은 확인 필요 (관외 아님): ' + codes(row('251215')));
ok(codes(row('251210')) === 'PARENT', '학생 아이디 신청');
ok(codes(row('251199')) === 'RESTRICT', '신청 제한 학생');
ok(row('251131').cancelled && !row('251131').issues.length, '예약취소는 점검 제외');
ok(codes(row('250980')) === 'PARENT', '마스터 중1(누리중학교 1-4)은 대상 안: ' + codes(row('250980')));
ok(/GRADE/.test(codes(row('250970'))), '마스터 중3은 대상 밖');
ok(codes(row('251158')) === '' && codes(row('251157')) === '', '형제(같은 아이디, 다른 학생)는 정상');
ok(/GROUP/.test(codes(row('251230'))), '단체 신청');
ok(/INPUT/.test(codes(row('251236'))), '학반 삼학년 → 입력 오류');
ok(row('251204').level === 'red' && row('251210').level === 'amber', '단계 표시');

// 수식 삽입 방지: 시트에 =로 시작하는 값이 그대로 들어가지 않음 (harness가 수식이면 예외)
const list = env.table('통합명단');
ok(list.some((r) => r[2] === '=HYPERLINK("x")'), '수식처럼 보이는 값은 글자로 저장');

// 처리·충돌
let st = env.call('status', { date: '2026-11-07', no: '251210', status: 'done', memo: '통화 완료', prevAt: '' });
ok(st.ok && st.status.who === '이승주', '완료 처리');
let st2 = env.call('status', { date: '2026-11-07', no: '251210', status: 'ok', memo: '', prevAt: '' }, 'kim@example.com');
ok(st2.ok && st2.conflict && /이승주/.test(st2.message), '동시 처리 충돌 감지');
res = env.call('state', { date: '2026-11-07' });
ok(row('251210').status && row('251210').status.memo === '통화 완료', '처리 상태 유지');
const summary = env.table('점검현황');
ok(summary.length > 1 && summary[0][0] === '수업일', '점검현황 탭');

// 신청자가 내용을 고치면 다시 미처리
const fixed = JSON.parse(JSON.stringify(files.explore));
fixed.name = '통합예약신청자목록 - 2026-11-04T090000.000.xls';
fixed.rows[2][2] = '한엄마';
env.setNow(new Date('2026-11-04T10:30:00+09:00'));
res = env.call('upload', { date: '2026-11-07', files: [load(fixed)] });
ok(res.results[0].result === '반영', '탐험 새 명단 반영');
res = env.call('state', { date: '2026-11-07' });
ok(!row('251210').issues.length && !row('251210').status, '학부모 이름으로 고치면 문제 없어짐');
ok(!row('251204').isNew && !row('251188').isNew, '이전부터 있던 신청은 새로 들어옴 아님');
// 탐험에 새 신청 1건 추가해서 다시 올리기
const more = JSON.parse(JSON.stringify(fixed));
more.name = '통합예약신청자목록 - 2026-11-04T093500.000.xls';
more.rows.push(['251300', more.rows[0][1], '새엄마', '010-0000-1300', '', '개인', '', '', '', '새학생', '새솔초', '4-2', '대기', 'fake_new']);
env.setNow(new Date('2026-11-04T10:40:00+09:00'));
env.call('upload', { date: '2026-11-07', files: [load(more)] });
res = env.call('state', { date: '2026-11-07' });
ok(row('251300').isNew && !row('251210').isNew, '새로 들어온 신청만 표시: ' + row('251300').isNew);
ok(!row('251245').isNew, '다른 반(기초)은 새로 들어옴 아님');

// 되돌리기
st = env.call('status', { date: '2026-11-07', no: '251230', status: 'ok', memo: '', prevAt: '' });
const at = st.status.at;
st = env.call('status', { date: '2026-11-07', no: '251230', status: null, prevAt: at });
res = env.call('state', { date: '2026-11-07' });
ok(!row('251230').status, '되돌리기');

// 마스터는 다음 회차(11/14)에도 유지, 다른 오전반과 중복 검사
env.setNow(new Date('2026-11-10T10:00:00+09:00'));
const nextBasic = { name: '통합예약신청자목록 - 2026-11-10T100000.000.xls', rows: [
  ['251500', '[초2~3학년]11월14일 주말SW교실 기초코딩 오전반', '서민준', '010-0000-0970', '', '개인', '', '', '', '서지호', '누리중', '3-1', '대기', 'fake_smj']
] };
res = env.call('upload', { date: '2026-11-14', files: [load(nextBasic)] });
ok(res.results[0].result === '반영', '11/14 기초 반영');
res = env.call('state', { date: '2026-11-14' });
ok(res.rows.some((r) => r.no === '250980'), '마스터 명단 11/14에도 유지');
ok(/DUP/.test(codes(row('251500'))) && /DUP/.test(codes(row('250970'))), '마스터 수강생이 다른 오전반 신청 → 중복');
ok(!res.rows.some((r) => r.no === '251204'), '11/7 기초 명단은 11/14에 안 보임');
ok(res.classes.some((c) => c['접수명'] === '메이커1') && !res.classes.some((c) => c['접수명'] === '창의 3,4반'), '11/14부터 메이커반 운영');

// 시각 없는 이름(통합예약신청자목록 (1).xls)도 받은 시각 순서로 처리
env.setNow(new Date('2026-11-11T10:00:00+09:00'));
const plain = (n, ts, rows) => Object.assign(load({ name: '통합예약신청자목록 - 2026-11-11T000000.000.xls', rows }), { fileName: n, fileTs: ts });
const e1 = [['251600', '[초3~5학년]11월14일 주말SW교실 탐험코딩 오전반', '가가가', '010-0000-1600', '', '개인', '', '', '', '나나나', '가온초', '4-1', '대기', 'fake_p1']];
const e2 = e1.concat([['251601', '[초3~5학년]11월14일 주말SW교실 탐험코딩 오전반', '다다다', '010-0000-1601', '', '개인', '', '', '', '라라라', '가온초', '4-2', '대기', 'fake_p2']]);
res = env.call('upload', { date: '2026-11-14', files: [plain('통합예약신청자목록 (2).xls', '2026-11-11T09:40:00.000', e2), plain('통합예약신청자목록.xls', '2026-11-11T09:10:00.000', e1)] });
ok(res.results.find((r) => r.file === '통합예약신청자목록 (2).xls').result === '반영' && res.results.find((r) => r.file === '통합예약신청자목록.xls').result === '건너뜀', '시각 없는 이름: 나중에 받은 파일만 반영');
res = env.call('upload', { date: '2026-11-14', files: [plain('통합예약신청자목록 (3).xls', 'bad', e1)] });
ok(res.results[0].result === '오류', '받은 시각이 없으면 거부');
res = env.call('state', { date: '2026-11-14' });
ok(res.uploadedFiles.indexOf('통합예약신청자목록 (2).xls|2026-11-11T09:40:00.000') >= 0, '이미 올린 파일은 이름+시각으로 기억');

// 같은 반 요청
let lk = env.call('linkAdd', { date: '2026-11-14', scope: 'keep', memo: '전화 요청', members: [{ no: '251600', name: '나나나', school: '가온초' }, { no: '', name: '친구', school: '새솔초' }] });
ok(lk.ok && lk.id, '같은 반 요청 저장');
res = env.call('state', { date: '2026-11-14' });
ok(res.links.length === 1 && res.links[0].members.length === 2 && res.links[0].scope === '계속', '요청 묶음 불러오기');
ok(env.call('linkAdd', { date: '2026-11-14', members: [{ name: '혼자' }] }).ok === false, '1명은 묶을 수 없음');
env.call('linkRemove', { id: lk.id });
ok(!env.call('state', { date: '2026-11-14' }).links.length, '요청 해제');

// 결석 기록 → 다음 수업일 신청 제한, 출석 인정이면 풀림
let ab = env.call('absSave', { rec: { date: '2026-11-07', no: '251178', name: '문서윤', school: '해솔초등학교', ban: '3-2', cls: '기초 1,2반', src: '당일 결석', reason: '당일 무단결석' } });
ok(ab.ok && ab.id, '결석 기록 저장');
const next = { name: '통합예약신청자목록 - 2026-11-11T110000.000.xls', rows: [['251700', '[초2~3학년]11월14일 주말SW교실 기초코딩 오전반', '문지영', '010-0000-1178', '', '개인', '', '', '', '문서윤', '해솔초', '3-2', '대기', 'fake_mjy']] };
env.setNow(new Date('2026-11-11T11:10:00+09:00'));
env.call('upload', { date: '2026-11-14', files: [load(next)] });
res = env.call('state', { date: '2026-11-14' });
ok(/RESTRICT/.test(codes(row('251700'))), '결석 기록 → 다음 수업일 신청 제한: ' + codes(row('251700')));
ok(res.absences.length === 0 && env.call('state', { date: '2026-11-07' }).absences.length === 1, '결석 기록은 그 수업일에 보임');
env.call('absSave', { rec: { id: ab.id, date: '2026-11-07', no: '251178', name: '문서윤', school: '해솔초등학교', reason: '질병', excused: true } });
res = env.call('state', { date: '2026-11-14' });
ok(!/RESTRICT/.test(codes(row('251700'))), '출석 인정이면 제한 풀림');
ok(env.call('state', { date: '2026-11-07' }).absences.length === 1, '같은 학생 기록은 하나로 고침');

// 출석부 저장·차수
let sv = env.call('attSave', { date: '2026-11-07', data: { blocks: [{ key: '기초 1,2반#0', title: '11월 7일 테스트 오전1반', sessions: '기초1/기초2', rooms: '라온실/놀이실', line: 'x', tag: '기초1', students: [] }] } });
ok(sv.ok && sv.version === 1, '출석부 1차 저장');
sv = env.call('attSave', { date: '2026-11-07', data: { blocks: [] } });
ok(sv.version === 2, '다시 저장하면 2차');
res = env.call('state', { date: '2026-11-07' });
ok(res.att && res.att.version === 2, '최신 차수 불러오기');
res = env.call('state', { date: '2026-11-14' });
ok(res.attPrev && res.attPrev.date === '2026-11-07', '지난 회차 출석부 설정');

// 주제·교구 시트
env.topic.rows = [['날짜', '요일', '시간', '영역', '반', '소속', '강사명', '주제', '교구'], ['11/7', '토', '오전', 'SW', '기초1', '', '', 'AI 게임', '노트북 8대'], ['11/14', '토', '오전', 'SW', '기초1', '', '', '로비코', '로비코, 태블릿PC']];
const tp = env.call('topics', { date: '2026-11-14' });
ok(tp.ok && tp.items.length === 1 && tp.items[0].cls === '기초1' && /로비코/.test(tp.items[0].tools), '주제·교구 시트에서 그 날짜만 읽기');

console.log('테스트 ' + passed + '개 통과');
