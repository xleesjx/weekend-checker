/* 실제 엑셀과 같은 형식의 가짜 명단 (.xls, 모든 칸 텍스트) */
'use strict';
const XLSX = require(process.env.XLSX_PATH || 'xlsx');
const Core = require('../docs/core.js');

const B = '[초2~3학년]11월7일 주말SW교실 기초코딩 오전반 ';
const E = '[초3~5학년]11월7일 주말SW교실 탐험코딩 오전반 ';
const M = '[초5~중2학년]11월7일~12월5일 주말SW교실 마스터코딩 오전반 ';
const C1 = '[초1학년]11월7일 주말창의교실 창의융합 1,2반 오후 ';
const C2 = '[초2~3학년]11월7일 주말창의교실 창의융합 1,2반 오후 ';

function r(no, title, parent, phone, kind, student, school, ban, state, uid, cnt) {
  return [no, title, parent, phone, '', kind || '개인', '', cnt || '', student + ' ' + school + ' ' + ban, student, school, ban, state || '대기', uid];
}

const files = {
  basic_old: { name: '통합예약신청자목록 - 2026-11-03T100325.738.xls', rows: [
    r('251204', B, '김민정', '010-0000-1204', '', '김하늘', '가온초', '2-3', '대기', 'fake_kmj'),
    r('251178', B, '문지영', '010-0000-1178', '', '문서윤', '해솔초등학교', '3학년2반', '승인', 'fake_mjy')
  ] },
  basic: { name: '통합예약신청자목록 - 2026-11-03T105412.000.xls', rows: [
    r('251245', B, '최영미', '010-0000-1245', '', '가온초등학교', '2', '3', '대기', 'fake_cym'),
    r('251240', B, '이수진', '010-0000-1240', '', '이도윤', '부산누리초', '2-1', '대기', 'fake_lsj'),
    r('251204', B, '김민정', '010-0000-1204', '', '김하늘', '가온초', '2-3', '대기', 'fake_kmj'),
    r('251178', B, '문지영', '010-0000-1178', '', '문서윤', '해솔초등학교', '3학년2반', '승인', 'fake_mjy'),
    r('251162', B, '강수연', '010-0000-1162', '', '강민', '가온초', '2ㅡ5', '승인', 'fake_ksy'),
    r('251150', B, '=HYPERLINK("x")', '010-0000-1150', '', '홍길', '가온초', '3', '대기', 'fake_inj')
  ] },
  explore: { name: '통합예약신청자목록 - 2026-11-03T104100.100.xls', rows: [
    r('251188', E, '김민정', '010-0000-1204', '', '김하늘', '가온초등학교', '2학년3반', '추가대기', 'fake_kmj'),
    r('251215', E, '윤태호', '010-0000-1215', '', '윤서아', '홈스쿨링', '3', '대기', 'fake_yth'),
    r('251210', E, '한지우', '010-0000-1210', '', '한지우', '새솔초', '4-1', '대기', 'fake_hjw'),
    r('251199', E, '정은희', '010-0000-1199', '', '정우진', '다솜초', '4-2', '승인', 'fake_jeh'),
    r('251131', E, '노경아', '010-0000-1131', '', '노은찬', '다솜초', '3-3', '예약취소', 'fake_nka')
  ] },
  master: { name: '통합예약신청자목록 - 2026-11-03T100929.158.xls', rows: [
    r('250980', M, '오세린', '010-0000-0980', '', '오세린', '누리중학교', '1-4', '승인', 'fake_osr'),
    r('250975', M, '배정민', '010-0000-0975', '', '배도현', '가온초', '6-1', '승인', 'fake_bjm'),
    r('250970', M, '서민준', '010-0000-0970', '', '서지호', '누리중', '3-1', '승인', 'fake_smj')
  ] },
  c1: { name: '통합예약신청자목록 - 2026-11-03T105200.000.xls', rows: [
    r('251158', C1, '하은정', '010-0000-1158', '', '하지안', '새솔초', '1-3', '승인', 'fake_hej'),
    r('251157', C1, '하은정', '010-0000-1158', '', '하지우', '새솔초', '1-3', '승인', 'fake_hej')
  ] },
  c2: { name: '통합예약신청자목록 - 2026-11-03T105300.000.xls', rows: [
    r('251236', C2, '서유리', '010-0000-1236', '', '서하준', '해솔', '삼학년', '대기', 'fake_syr'),
    r('251230', C2, '박지현', '010-0000-1230', '단체', '박서진', '해솔초', '3학년1반', '대기', 'fake_pjh', '3')
  ] },
  lastweek: { name: '통합예약신청자목록 - 2026-10-27T100325.738.xls', rows: [
    r('241026', B.replace('11월7일', '10월31일'), '테스트', '010-0000-0001', '', '테스트', '가온초', '2-1', '대기', 'fake_t')
  ] }
};

function toXls(rows) {
  const ws = XLSX.utils.aoa_to_sheet([Core.HEADER].concat(rows));
  Object.keys(ws).forEach((k) => { if (k[0] !== '!') { ws[k].t = 's'; ws[k].v = String(ws[k].v); } });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet0');
  return XLSX.write(wb, { bookType: 'biff8', type: 'buffer' });
}

/* app.js 의 parseFile 과 같은 방식으로 읽습니다 */
function parseXls(buf, fileName) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
  const header = (aoa[0] || []).map((s) => String(s).trim());
  const rows = aoa.slice(1).filter((x) => x.some((c) => String(c).trim() !== ''))
    .map((x) => Core.HEADER.map((_, i) => String(x[i] == null ? '' : x[i]).trim()));
  const meta = Core.parseFileName(fileName);
  return { fileName, fileTs: meta.ts, header, title: rows.length ? rows[0][1] : '', rows };
}

module.exports = { files, toXls, parseXls };

if (require.main === module) {
  const fs = require('fs');
  const path = require('path');
  const out = path.join(__dirname, 'fake-files');
  fs.mkdirSync(out, { recursive: true });
  Object.values(files).forEach((f) => fs.writeFileSync(path.join(out, f.name), toXls(f.rows)));
  console.log('가짜 명단 ' + Object.keys(files).length + '개를 test/fake-files 에 만들었습니다.');
}
