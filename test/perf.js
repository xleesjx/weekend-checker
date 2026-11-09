/*
 * 속도 재기: 10주 동안 쌓인 실제 규모의 가짜 자료로
 *  (1) 서버(state)가 시트를 몇 번·몇 칸 읽는지와 계산 시간
 *  (2) 브라우저에서 메뉴마다 화면을 그리는 시간
 * 실행: node test/perf.js [스크린샷 폴더]
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('./harness');
const Core = require('../docs/core.js');

const OUT = process.argv[2] || path.join(__dirname, 'shots-perf');
fs.mkdirSync(OUT, { recursive: true });
const SHEETS = process.env.NO_SHEETS_API ? false : true;  // 기본: Google Sheets API(한 번에 읽기) 켬
const env = createEnv({ now: new Date('2026-11-06T15:00:00+09:00'), sheetsApi: SHEETS });
env.ctx.setupSheets();
env.ctx.writeTable_('점검자', [['owner@example.com', '이승주'], ['kim@example.com', '김선생']]);

// ── 가짜 자료 ──
const FAM = '김이박최정강조윤장임한오서신권황안송류홍';
const GIV = ['하늘', '서윤', '도윤', '하준', '서연', '지우', '민준', '예린', '시우', '지호', '유나', '은우', '수아', '건우', '다은', '준서', '나은', '현우', '채원', '우진'];
const SCH = [];
for (let i = 0; i < 230; i++) SCH.push([(['가온', '해솔', '새솔', '다솜', '누리', '하늘', '바다', '푸른', '은빛', '샛별', '마루', '나래', '한빛', '초록', '보람', '늘봄'][i % 16]) + (i >= 16 ? String.fromCharCode(0xAC00 + i * 37 % 11000) : '') + (i % 5 === 4 ? '중학교' : '초등학교'), i % 5 === 4 ? '중' : '초']);
env.ctx.writeTable_('설정_학교', SCH.map((s) => [s[0], s[1], Core.schoolKey(s[0])]));
const ctxCls = env.call('settings', {});
const classes = ctxCls.classes;
const dates = ctxCls.dates.map((d) => d.date);
const EX = ['수업일', '시간대', '수업반', '접수명', '점검결과', '처리상태', '처리자', '처리시각', '메모', '업로드시각', '업로더', '파일명', '순번', '처음 올라온 시각', '신청일시', '취소시각'];
let sn = 300000;
const list = [], statuses = [], absences = [], att = [];
dates.forEach((date, wi) => {
  classes.forEach((c) => {
    const n = Math.round((+c.cap || 16) * 1.35);
    const title = '[초2~3학년]' + (+date.slice(5, 7)) + '월' + (+date.slice(8, 10)) + '일 주말 ' + c['접수명'];
    for (let k = 0; k < n; k++) {
      const no = String(sn++);
      const nm = FAM[(sn * 7) % FAM.length] + GIV[(sn * 13) % GIV.length];
      const sc = SCH[(sn * 11) % SCH.length][0];
      const st = k < (+c.cap || 16) ? '승인' : (k % 3 ? '대기' : (k % 2 ? '추가대기' : '예약취소'));
      const row = [no, title, '보호자' + k, '010-' + String(1000 + (sn % 9000)) + '-' + String(1000 + (sn * 3) % 9000), '', '개인', '', '', nm + ' ' + sc + ' 3-2', nm, sc, (2 + k % 3) + '-' + (1 + k % 6), st, 'id' + no];
      const ex = EX.map(() => '');
      ex[0] = date; ex[1] = c['시간대']; ex[2] = c['수업반']; ex[3] = c['접수명']; ex[9] = date + ' 09:00:00'; ex[10] = '이승주'; ex[11] = '통합예약신청자목록.xls'; ex[12] = String(k + 1); ex[13] = date + ' 09:00:00';
      ex[14] = '2026-11-03 10:' + String(k % 60).padStart(2, '0') + ':00'; if (st === '예약취소') ex[15] = '2026-11-05 18:00:00';
      list.push(row.concat(ex));
      if (k % 4 === 0) statuses.push([date, no, 'done', '이승주', date + ' 10:00:00', '통화함', 'x']);
      if (wi < dates.length - 1 && k % 25 === 3) absences.push(['A' + no, date, no, nm, sc, '3-2', c['접수명'], '010', '출석부 결석 체크', '당일 무단결석', '', '', '', '이승주', date + ' 12:00:00']);
    }
  });
  // 출석부 차수 3개씩 (반 8개, 학생 포함 JSON)
  const blocks = classes.map((c, bi) => ({ key: c['수업반'] + '#0', title: '제목' + bi, line: '줄', tag: 't', students: list.filter((r) => r[14] === date && r[17] === c['접수명'] && r[12] === '승인').map((r) => ({ no: r[0], name: r[9], school: r[10], ban: r[11], status: '' })) }));
  for (let v = 1; v <= 3; v++) att.push([date, String(v), date + ' 1' + v + ':00:00', '이승주', JSON.stringify({ blocks })]);
});
env.ctx.writeTable_('통합명단', list);
env.ctx.writeTable_('처리기록', statuses);
env.ctx.writeTable_('결석기록', absences);
env.ctx.writeTable_('출석부', att);
const uploads = [];
dates.forEach((d) => classes.forEach((c) => { for (let i = 0; i < 6; i++) uploads.push([d + ' 1' + i + ':00:00', '이승주', 'f.xls', d + 'T1' + i + ':00:00.000', d, c['접수명'], '40', '반영']); }));
env.ctx.writeTable_('업로드기록', uploads);

// ── 서버: 시트 읽기 횟수·칸 수, 계산 시간 ──
const realSS = env.ctx.SpreadsheetApp.getActiveSpreadsheet();
let reads = [];
env.ctx.SpreadsheetApp.getActiveSpreadsheet = () => ({
  ...realSS,
  getSheetByName: (n) => {
    const sh = realSS.getSheetByName(n);
    if (!sh) return sh;
    return { ...sh, getDataRange: () => { const v = sh.getDataRange().getValues(); reads.push({ n, cells: v.length * (v[0] || []).length }); return { getValues: () => v }; } };
  },
  insertSheet: realSS.insertSheet,
  getId: realSS.getId,
  getSheets: realSS.getSheets
});
const TARGET = '2026-11-07';
function measure(action, payload) {
  reads = [];
  const b0 = env.stats.batchGets, c0 = env.stats.batchCells;
  const t0 = process.hrtime.bigint();
  const res = env.call(action, payload);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const cells = reads.reduce((a, r) => a + r.cells, 0) + (env.stats.batchCells - c0);
  const by = {};
  reads.forEach((r) => { by[r.n] = (by[r.n] || 0) + 1; });
  return { ms, reads: reads.length, batch: env.stats.batchGets - b0, cells, by, bytes: JSON.stringify(res).length, ok: res.ok !== false && !res.error, res };
}
env.call('rev', {});
const S1 = measure('state', { date: TARGET });
const S1b = measure('state', { date: TARGET });
const S2 = measure('status', { date: TARGET, no: list.find((r) => r[14] === TARGET && !statuses.some((x) => x[1] === r[0]))[0], status: 'done', memo: '', prevAt: '' });
const S1c = measure('state', { date: TARGET });
const S3 = measure('settings', {});
// Apps Script 추정: 시트 읽기 한 번 ≈ 0.1~0.2초 + 칸 5만 개당 ≈ 0.5~1초 + 계산은 이 PC의 약 3~5배
// 한 번에 읽기(batchGet) 한 번 ≈ 0.3~0.6초 + 칸 수 비례
// 요청마다 기본으로 드는 시간(Apps Script 시작·로그인 확인) ≈ 0.4~0.8초를 더함
const est = (m) => [0.4 + 0.1 * m.reads + 0.3 * m.batch + m.cells / 100000 + m.ms * 3 / 1000, 0.8 + 0.2 * m.reads + 0.6 * m.batch + m.cells / 50000 + m.ms * 5 / 1000].map((x) => x.toFixed(1));
console.log('자료: 통합명단 ' + list.length + '줄 · 처리기록 ' + statuses.length + ' · 결석 ' + absences.length + ' · 출석부 저장본 ' + att.length + '개 · 이번 회차 ' + list.filter((r) => r[14] === TARGET).length + '명');
console.log('Sheets API(한 번에 읽기): ' + (SHEETS ? '켬' : '끔'));
[['처음 열기 (state, 서버 기억 없음)', S1], ['다시 열기·다른 선생님 (state, 바뀐 것 없음)', S1b], ['[완료] 누르기 (status, 뒤에서 저장)', S2], ['[완료] 뒤 다른 선생님 새로 받기 (state)', S1c], ['설정 메뉴 (settings)', S3]].forEach(([k, m]) => {
  console.log(k + ': 따로 읽기 ' + m.reads + '번 · 한 번에 읽기 ' + m.batch + '번 · ' + m.cells.toLocaleString() + '칸 · 이 PC 계산 ' + m.ms.toFixed(0) + 'ms · 응답 ' + Math.round(m.bytes / 1024) + 'KB → Apps Script 추정 ' + est(m).join('~') + '초');
  console.log('   읽은 탭: ' + Object.entries(m.by).map(([n, c]) => n + (c > 1 ? '×' + c : '')).join(', '));
});

// ── 브라우저: 메뉴마다 화면 그리는 시간 ──
const WEB = path.join(__dirname, '..', 'docs');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/config.js') { res.end("window.APP_CONFIG={API_URL:'https://api.test/exec',CLIENT_ID:'test-client'};"); return; }
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(f));
});
(async () => {
  const { chromium } = require('playwright');
  await new Promise((r) => server.listen(0, r));
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  const payload = Buffer.from(JSON.stringify({ email: 'owner@example.com', name: '이승주', exp: Math.floor(Date.now() / 1000) + 3000 })).toString('base64url');
  await page.addInitScript(({ tok, now }) => {
    const RealDate = Date; const off = now - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + off])); } static now() { return RealDate.now() + off; } };
    sessionStorage.setItem('idtoken', tok); localStorage.setItem('guide-v1', '1'); localStorage.setItem('guide-v2', '1');
  }, { tok: 'x.' + payload + '.y', now: new Date('2026-11-06T15:00:00+09:00').getTime() });
  await page.route('https://accounts.google.com/**', (r) => r.fulfill({ body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){}}}};', contentType: 'text/javascript' }));
  await page.route('https://api.test/**', async (route) => {
    const body = JSON.parse(route.request().postData()); delete body.token;
    await route.fulfill({ body: JSON.stringify(env.call(body.action, body)), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('http://localhost:' + server.address().port + '/');
  await page.waitForSelector('.flowbar', { timeout: 30000 });
  const views = ['home', 'review', 'full', 'att', 'abs', 'uploads', 'home', 'full'];
  const out = [];
  for (const v of views) {
    const ms = await page.evaluate((view) => new Promise((resolve) => {
      const btn = document.querySelector('[data-view="' + view + '"]');
      const t0 = performance.now();
      btn.click();
      requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - t0), 0));
    }), v);
    const n = await page.evaluate(() => document.querySelectorAll('#app *').length);
    out.push(v + ' ' + Math.round(ms) + 'ms (요소 ' + n.toLocaleString() + '개)');
  }
  console.log('화면 그리기 (메뉴 누름 → 그려짐): ' + out.join(' · '));
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
