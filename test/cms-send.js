/*
 * 통합예약 관리자 화면(가짜) → 즐겨찾기 버튼(downloader.js) → [점검 웹앱으로 보내기] → 점검 웹앱이 받아 올리기
 * 실행: node test/cms-send.js [스크린샷 폴더]   (downloader.js 위치: DOWNLOADER_JS, 기본 ../excel-down/downloader.js)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createEnv } = require('./harness');
const { files, toXls } = require('./fake-data');

const OUT = process.argv[2] || path.join(__dirname, 'shots-cms');
fs.mkdirSync(OUT, { recursive: true });
const DL = process.env.DOWNLOADER_JS || path.join(__dirname, '..', '..', 'excel-down', 'downloader.js');
if (!fs.existsSync(DL)) { console.log('downloader.js 없음 — 건너뜀: ' + DL); process.exit(0); }

const env = createEnv({ now: new Date('2026-11-04T10:00:00+09:00') });
env.ctx.setupSheets();
env.ctx.writeTable_('설정_학교', [['가온초등학교', '초'], ['해솔초등학교', '초'], ['새솔초등학교', '초'], ['다솜초등학교', '초'], ['누리중학교', '중']]);
env.ctx.writeTable_('점검자', [['owner@example.com', '이승주']]);

// 브라우저 날짜를 11/6(금)으로 고정: 11/7 수업이 접수 기간 안
const NOW = new Date('2026-11-06T15:00:00+09:00');

// 마스터 반은 12명(가짜)으로 늘려 신청자 화면이 10명씩 두 쪽으로 나뉘는 경우를 시험
const MASTER12 = files.master.rows.concat(Array.from({ length: 9 }, (_, k) => {
  const r = files.master.rows[0].slice();
  r[0] = String(250900 + k); r[2] = '보호자' + k; r[3] = '010-0000-09' + String(k).padStart(2, '0'); r[9] = '가짜' + k; r[10] = '가온초등학교'; r[11] = '6-' + (k + 1); r[12] = k === 8 ? '예약취소' : '승인'; r[13] = 'fake_m' + k;
  r[8] = r[9] + ' ' + r[10] + ' ' + r[11];
  return r;
}));
// 신청자 목록 화면 (실제 화면과 같은 구조, 가짜 사람). 실제 서버처럼 한 쪽에 10명씩
const CANCEL_AT = '2026-11-06 19:16:58';
function aplyPage(c, page) {
  const rows = c.rows.slice((page - 1) * 10, page * 10);
  return '<!doctype html><meta charset="utf-8"><table><tbody>' + rows.map((r, k) => `<tr>
    <td class="text-center"><input type="checkbox" name="sns" value="${r[0]}"></td><td class="text-center">${(page - 1) * 10 + k + 1}</td>
    <td><a href="#AplyView" onclick="opAplyView('${r[0]}');return false;">${r[2]}</a></td><td class="text-center">${r[3]}</td>
    <td class="text-center">2026-11-05 1${k % 10}:18:45.0</td><td class="text-center">\n  개인\n</td>
    <td class="text-center">\n\n ${r[12] === '예약취소' ? '예약취소<br>(' + CANCEL_AT + '.0)' : r[12]}\n</td>
    <td class="text-center"><div class="text-info"><span>${r[12] === '예약취소' ? '승인취소' : '승인'}</span></div></td>
    <td class="text-center"><a href="#5" onclick="opUpdateAplyFnsh('${r[0]}');"><div><span>미이수</span></div></a></td><td class="text-center"></td>
    <td class="text-center">${r[8]}</td></tr>`).join('') + '</tbody></table>';
}
let excelCalls = 0, screenCalls = 0;
async function cmsHandler(route) {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith('BD_selectReservationMngList.do')) return route.fulfill({ body: listPage, contentType: 'text/html; charset=utf-8' });
  if (u.pathname.endsWith('BD_selectReservationAplyList.do')) {
    screenCalls++;
    const c = CLASSES.find((x) => x.sn === u.searchParams.get('q_rsvtRegSn'));
    return route.fulfill({ body: aplyPage(c, +u.searchParams.get('q_currPage') || 1), contentType: 'text/html; charset=utf-8' });
  }
  if (u.pathname.endsWith('ND_excelDownload.do')) {
    excelCalls++;
    const q = new URLSearchParams(route.request().postData());
    const c = CLASSES.find((x) => x.sn === q.get('q_rsvtRegSn'));
    if (!c || q.get('excelKey') !== 'reservationNoContsCceAplyList') return route.fulfill({ status: 200, body: '<html><body>로그인이 필요합니다</body></html>', contentType: 'text/html' });
    return route.fulfill({ body: toXls(c.rows), contentType: 'application/vnd.ms-excel',
      headers: { 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent('통합예약신청자목록.xls') } });
  }
  return route.fulfill({ status: 404, body: '' });
}

// 가짜 관리자 목록 화면: 11/7 수업 3개(접수중·접수마감) + 다음 주 수업 1개(체크 안 됨)
const CLASSES = [
  { sn: '4790', title: files.basic.rows[0][1].trim(), date: '2026-11-07 ~ 2026-11-07', status: '접수중', rows: files.basic.rows },
  { sn: '4791', title: files.explore.rows[0][1].trim(), date: '2026-11-07 ~ 2026-11-07', status: '접수마감', rows: files.explore.rows },
  { sn: '4792', title: files.master.rows[0][1].trim(), date: '2026-11-07 ~ 2026-12-05', status: '접수중', rows: MASTER12 },
  { sn: '4793', title: '[초2~3학년]11월14일 주말SW교실 기초코딩 오전반', date: '2026-11-14 ~ 2026-11-14', status: '접수중', rows: [] }
];
const listPage = '<!doctype html><meta charset="utf-8"><title>통합예약</title><table><thead><tr><th>순번</th><th>누리집명</th><th>예약구분</th><th>신청명</th><th>운영일시</th><th>신청현황</th><th>접수상태</th><th>콘텐츠관리</th><th>휴일관리</th><th>신청관리</th></tr></thead><tbody>' +
  CLASSES.map((c, i) => `<tr><td>${i + 1}</td><td>울산창의융합교육센터</td><td>교육</td><td><a href="#">${c.title}</a></td><td>${c.date}<br>09:20 ~ 12:20</td><td>${c.rows.length}명</td><td>${c.status}</td><td></td><td></td><td><button onclick="opViewApplyList('${c.sn}', '1010', '34')">신청 관리</button></td></tr>`).join('') +
  '</tbody></table>';

const WEB = path.join(__dirname, '..', 'docs');
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  if (p === '/config.js') { res.end("window.APP_CONFIG={API_URL:'https://api.test/exec',CLIENT_ID:'test-client',CMS_ORIGIN:'https://cms.test'};"); return; }
  const f = path.join(WEB, p);
  if (!f.startsWith(WEB) || !fs.existsSync(f)) { res.statusCode = 404; res.end(); return; }
  res.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise((r) => server.listen(0, r));
  const APP = 'http://localhost:' + server.address().port + '/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const errors = [];
  const payload = Buffer.from(JSON.stringify({ email: 'owner@example.com', name: '이승주', exp: Math.floor(Date.now() / 1000) + 3000 })).toString('base64url');
  await ctx.addInitScript(({ tok, now }) => {
    // 시계 고정
    const RealDate = Date; const off = now - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + off])); } static now() { return RealDate.now() + off; } };
    if (location.hostname === 'localhost') { sessionStorage.setItem('idtoken', tok); localStorage.setItem('guide-v1', '1'); }
  }, { tok: 'x.' + payload + '.y', now: NOW.getTime() });
  await ctx.route('https://accounts.google.com/**', (r) => r.fulfill({ body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){}}}};', contentType: 'text/javascript' }));
  await ctx.route('https://api.test/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    delete body.token;
    const out = env.call(body.action, body);
    await route.fulfill({ body: JSON.stringify(out), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await ctx.route('https://cms.test/**', cmsHandler);

  const cms = await ctx.newPage();
  cms.on('pageerror', (e) => errors.push('관리자: ' + e.message));
  await cms.goto('https://cms.test/intra/reservation/BD_selectReservationMngList.do');
  // 즐겨찾기 버튼 누르기 = downloader.js 실행
  await cms.evaluate((u) => { window.__excelDownWebapp = u; }, APP);
  await cms.addScriptTag({ content: fs.readFileSync(DL, 'utf8') });
  await cms.waitForSelector('#excelDownPanel');
  const checked = await cms.$$eval('#excelDownPanel .xd-chk', (cs) => cs.map((c) => c.checked));
  if (checked.join() !== 'true,true,true,false') throw new Error('기본 체크가 다름: ' + checked);
  const sendLabel = await cms.textContent('#excelDownPanel .xd-primary');
  if (!/3개 점검 웹앱으로 보내기/.test(sendLabel)) throw new Error('보내기 버튼: ' + sendLabel);
  await cms.screenshot({ path: path.join(OUT, '1-panel.png') });

  const [app] = await Promise.all([ctx.waitForEvent('page'), cms.click('#excelDownPanel .xd-primary')]);
  app.on('pageerror', (e) => errors.push('웹앱: ' + e.message));
  // 웹앱이 받으면 확인창
  await app.waitForSelector('[data-m=yes]', { timeout: 30000 });
  const modalText = await app.textContent('.modal');
  if (!/명단 3개가 왔습니다/.test(modalText) || !/11월 7일/.test(modalText)) throw new Error('확인창: ' + modalText);
  await app.screenshot({ path: path.join(OUT, '2-app-confirm.png') });
  const midText = await cms.textContent('#excelDownPanel .xd-result');
  if (!/3개를 점검 웹앱으로 보냈습니다/.test(midText)) throw new Error('보낸 뒤 패널: ' + midText);
  await app.click('[data-m=yes]');
  await app.waitForSelector('.result-line', { timeout: 20000 });
  const lines = await app.$$eval('.result-line', (ls) => ls.map((l) => l.textContent));
  console.log('웹앱 올리기 결과:', lines.join(' / '));
  if (lines.filter((l) => /반영/.test(l)).length !== 3) throw new Error('3개 반영이 아님');
  await app.screenshot({ path: path.join(OUT, '3-app-result.png') });
  // 관리자 화면 패널에 결과가 돌아옴
  await cms.waitForFunction(() => /점검 웹앱에 올렸습니다/.test((document.querySelector('#excelDownPanel .xd-result') || {}).textContent || ''), null, { timeout: 15000 });
  const final = await cms.textContent('#excelDownPanel .xd-result');
  console.log('패널 결과:', final.replace(/\s+/g, ' ').slice(0, 160));
  await cms.screenshot({ path: path.join(OUT, '4-panel-done.png') });
  const up = env.ctx.readTable_('업로드기록').rows;
  if (up.length !== 3) throw new Error('업로드 기록 수: ' + up.length);
  if (excelCalls !== 3) throw new Error('엑셀 요청 수: ' + excelCalls);
  if (screenCalls !== 4) throw new Error('화면 요청 수(마스터 2쪽 포함 4): ' + screenCalls);
  // 화면에서 읽은 신청일시·취소 시각이 저장됨
  const st = env.call('state', { date: '2026-11-07' });
  const cx = st.rows.filter((r) => r.cancelAt);
  if (cx.length !== 2 || !cx.every((r) => r.cancelAt === CANCEL_AT && r.cells[12] === '예약취소')) throw new Error('취소 시각: ' + JSON.stringify(cx.map((r) => [r.no, r.cancelAt])));
  if (st.rows.filter((r) => r.appliedAt).length !== 23) throw new Error('신청일시 수: ' + st.rows.filter((r) => r.appliedAt).length);
  console.log('화면 값: 신청일시 23명, 취소 시각 2명 저장 (2쪽 화면 포함)');
  const panelDetail = await cms.$$eval('#excelDownPanel .xd-s', (x) => x.map((e) => e.textContent));
  console.log('패널 표시:', panelDetail.slice(0, 3).join(' | '));
  // 전체 명단에 취소 시각 표시
  await app.click('[data-view=full]');
  await app.waitForSelector('text=11/6 19:16 취소');
  await app.screenshot({ path: path.join(OUT, '3b-full-cancel.png'), fullPage: false });
  // 폴더 업로드처럼 화면 값 없이 다시 올려도 이미 아는 값은 유지
  const env2res = env.call('upload', { date: '2026-11-07', files: [require('./fake-data').parseXls(toXls(files.explore.rows), '통합예약신청자목록 - 2026-11-06T160000.000.xls')] });
  if (env2res.results[0].result !== '반영') throw new Error('다시 올리기: ' + JSON.stringify(env2res.results));
  if (!env.call('state', { date: '2026-11-07' }).rows.some((r) => r.cancelAt === CANCEL_AT && r.cells[12] === '예약취소')) throw new Error('화면 값 없이 다시 올렸더니 취소 시각이 사라짐');
  // 기한 후 취소 자동 후보 (기본: 수업 전날 18:00 이후 → 11/6 19:16 취소 2명)
  await app.click('[data-act=refresh]');
  await app.waitForTimeout(800);
  await app.click('[data-view=abs]');
  await app.waitForSelector('text=기한 후 취소 자동 후보 2명');
  if (!(await app.textContent('body')).includes('수업 2일 전 16:00 이후 취소')) throw new Error('기본 취소 기한이 2일 전 16:00이 아님');
  await app.screenshot({ path: path.join(OUT, '6-late.png'), fullPage: true });
  await app.click('[data-x=late-skip]');
  await app.waitForSelector('text=기한 후 취소 자동 후보 1명');
  for (let k = 0; k < 30 && !env.ctx.readTable_('확인표시').rows.length; k++) await app.waitForTimeout(100);
  if (!env.ctx.readTable_('확인표시').rows.some((r) => r[1] === 'skip')) throw new Error('[제외]가 공유 저장되지 않음');
  await app.click('[data-x=late-unskip]');
  await app.click('[data-x=late-all]');
  await app.waitForSelector('text=기한 후 취소 자동 후보 0명');
  await app.waitForFunction(() => /모두 저장됨/.test((document.getElementById('abs-sync') || {}).textContent || ''));
  const absRows = env.ctx.readTable_('결석기록').rows;
  if (absRows.length !== 2 || !absRows.every((r) => r[9] === '기한 후 취소' && r[10] === '11/6 19:16' && /자동 후보/.test(r[8]))) throw new Error('자동 후보 등록: ' + JSON.stringify(absRows.map((r) => [r[8], r[9], r[10]])));
  // 기준 바꾸기 → 설정 메뉴: 수업 전날 20:00
  await app.click('[data-x=late-rule]');
  await app.waitForSelector('#ld');
  await app.selectOption('#ld', '1');
  await app.fill('#lt', '20:00');
  await app.click('[data-x=rule-save]');
  await app.waitForFunction(() => /수업 전날 20:00/.test(document.getElementById('toast').textContent));
  if (JSON.parse(env.props.CANCEL_RULE || '{}').time !== '20:00') throw new Error('기준 저장 안 됨');
  console.log('기한 후 취소 자동 후보: 2명 표시·제외·모두 등록·기준 바꾸기 확인');
  await app.click('[data-view=home]');

  // 다른 곳에서 온 메시지는 무시
  const ignored = await app.evaluate(() => new Promise((resolve) => {
    let got = false;
    window.addEventListener('message', (e) => { if (e.data && e.data.type === 'xd-files') got = true; });
    window.postMessage({ type: 'xd-files', files: [{ name: '통합예약신청자목록.xls', at: Date.now(), bytes: new ArrayBuffer(10) }] }, '*');
    setTimeout(() => resolve(got && !document.querySelector('.modal-bg')), 500);
  }));
  if (!ignored) throw new Error('다른 출처의 메시지를 받아들임');

  // 두 번째 보내기: 이미 열린 웹앱 창을 그대로 씀 (새 창·새로고침 없음) + 취소하면 패널에 취소로 표시
  await app.evaluate(() => { window.__mark = 'kept'; });
  let extra = 0;
  const onPage = () => { extra++; };
  ctx.on('page', onPage);
  await cms.click('#excelDownPanel .xd-primary'); // 닫기
  await cms.addScriptTag({ content: fs.readFileSync(DL, 'utf8') });
  await cms.waitForSelector('#excelDownPanel');
  await cms.click('#excelDownPanel .xd-primary');
  await app.waitForSelector('[data-m=no]', { timeout: 30000 });
  if (extra || (await app.evaluate(() => window.__mark)) !== 'kept') throw new Error('두 번째 보내기에서 웹앱 창을 새로 열거나 새로고침함');
  console.log('두 번째 보내기: 열린 웹앱 창 그대로 사용');
  await app.click('[data-m=no]');
  await cms.waitForFunction(() => /취소했습니다/.test((document.querySelector('#excelDownPanel .xd-result') || {}).textContent || ''), null, { timeout: 15000 });
  console.log('취소 흐름 확인');
  // 관리자 창에서 다시 웹앱 버튼을 눌러도 새 관리자 창이 생기지 않음
  await app.click('[data-act=cms]');
  await app.waitForTimeout(500);
  if (extra) throw new Error('웹앱의 [통합예약 관리자] 버튼이 열린 관리자 창 대신 새 창을 엶');
  ctx.off('page', onPage);

  /* 반대 순서: 웹앱을 먼저 열고 → [통합예약 관리자 ↗]로 관리자 화면 열기 → 그 창의 즐겨찾기 버튼이 먼저 연 웹앱 창으로 보냄 */
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx2.addInitScript(({ tok, now }) => {
    const RealDate = Date; const off = now - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + off])); } static now() { return RealDate.now() + off; } };
    if (location.hostname === 'localhost') { sessionStorage.setItem('idtoken', tok); localStorage.setItem('guide-v1', '1'); }
  }, { tok: 'x.' + payload + '.y', now: NOW.getTime() });
  await ctx2.route('https://accounts.google.com/**', (r) => r.fulfill({ body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){}}}};', contentType: 'text/javascript' }));
  await ctx2.route('https://api.test/**', async (route) => {
    const body = JSON.parse(route.request().postData()); delete body.token;
    await route.fulfill({ body: JSON.stringify(env.call(body.action, body)), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await ctx2.route('https://cms.test/**', cmsHandler);
  const app2 = await ctx2.newPage();
  app2.on('pageerror', (e) => errors.push('웹앱2: ' + e.message));
  await app2.goto(APP);
  await app2.waitForSelector('[data-act=cms]');
  await app2.evaluate(() => { window.__mark = 'first'; });
  const [cms2] = await Promise.all([ctx2.waitForEvent('page'), app2.click('[data-act=cms]')]);
  await cms2.waitForURL(/BD_selectReservationMngList/, { timeout: 10000 });
  if (!/BD_selectReservationMngList/.test(cms2.url())) throw new Error('관리자 목록 화면이 아님: ' + cms2.url());
  cms2.on('pageerror', (e) => errors.push('관리자2: ' + e.message));
  let extra2 = 0;
  ctx2.on('page', () => { extra2++; });
  await cms2.evaluate((u) => { window.__excelDownWebapp = u; }, APP);
  await cms2.addScriptTag({ content: fs.readFileSync(DL, 'utf8') });
  await cms2.waitForSelector('#excelDownPanel');
  await cms2.click('#excelDownPanel .xd-primary');
  await app2.waitForSelector('[data-m=yes]', { timeout: 30000 });
  if (extra2 || (await app2.evaluate(() => window.__mark)) !== 'first') throw new Error('먼저 연 웹앱 창으로 가지 않음');
  await app2.click('[data-m=yes]');
  await cms2.waitForFunction(() => /점검 웹앱에 올렸습니다/.test((document.querySelector('#excelDownPanel .xd-result') || {}).textContent || ''), null, { timeout: 20000 });
  // 웹앱의 버튼을 다시 누르면 열린 관리자 창으로 (새 창 없음)
  await app2.click('[data-act=cms]');
  await app2.waitForTimeout(500);
  if (extra2) throw new Error('관리자 창이 하나 더 열림');
  console.log('웹앱 먼저 → 관리자 열기 → 열린 웹앱 창으로 보내기 확인');
  await app2.screenshot({ path: path.join(OUT, '5-app-first.png') });

  console.log('페이지 오류:', errors.length ? errors.join(' | ') : '없음');
  if (errors.length) process.exitCode = 1;
  await browser.close();
  server.close();
})().catch((e) => { console.error(e); process.exit(1); });
