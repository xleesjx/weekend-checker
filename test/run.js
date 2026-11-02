/* 전체 흐름 테스트: 초기 설정 → 업로드(연결 포함) → 점검 결과 → 처리 → 충돌 → 마스터 유지 */
'use strict';
const assert = require('assert');
const Core = require('../web/core.js');
const { createEnv } = require('./harness');
const { files, toXls, parseXls } = require('./fake-data');

let passed = 0;
function ok(cond, msg) { assert.ok(cond, msg); passed++; }
function load(f) { return parseXls(toXls(f.rows), f.name); }
function codes(row) { return row.issues.map((i) => i.code).sort().join(','); }

/* 1. 판정 로직 단위 테스트 */
(function unit() {
  ok(Core.parseFileName('통합예약신청자목록 - 2026-10-27T100325.738.xls').ts === '2026-10-27T10:03:25.738', '파일 이름 해석');
  ok(Core.parseFileName('통합예약신청자목록 - 2026-10-27T100325.738 (1).xls') === null, '이름이 바뀐 파일은 제외');
  ok(Core.inWindow('2026-11-01', '2026-11-07') && !Core.inWindow('2026-10-31', '2026-11-07') && Core.inWindow('2026-11-07', '2026-11-07'), '접수 기간 = 수업일 6일 전~수업일');
  const t = Core.parseTitle('[초5~중2학년]11월7일~12월5일 주말SW교실 마스터코딩 오전반 ', '2026');
  ok(t.start === '2026-11-07' && t.end === '2026-12-05' && t.grade.min === 5 && t.grade.max === 8, '마스터 예약명 기간·학년');
  ok(Core.instanceCovers('2026-11-07~2026-12-05', '2026-11-21') && !Core.instanceCovers('2026-11-07~2026-12-05', '2026-12-12'), '마스터 기간 포함 여부');
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
env.setNow(new Date('2026-11-04T09:30:00+09:00'));
res = env.call('upload', { date: '2026-11-07', files: [load(fixed)] });
ok(res.results[0].result === '반영', '탐험 새 명단 반영');
res = env.call('state', { date: '2026-11-07' });
ok(!row('251210').issues.length && !row('251210').status, '학부모 이름으로 고치면 문제 없어짐');

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

console.log('테스트 ' + passed + '개 통과');
