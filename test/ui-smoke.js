/* 브라우저 화면 점검: 가짜 서버(harness)에 연결해 각 화면을 열고 스크린샷을 찍습니다. */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { createEnv } = require('./harness');
const { files, toXls, parseXls } = require('./fake-data');

const OUT = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const env = createEnv({ now: new Date('2026-11-04T10:00:00+09:00'), sheetsApi: !!process.env.SHEETS_API });
env.ctx.setupSheets();
env.ctx.writeTable_('설정_학교', [['가온초등학교', '초'], ['해솔초등학교', '초'], ['새솔초등학교', '초'], ['다솜초등학교', '초'], ['누리중학교', '중']]);
env.ctx.writeTable_('신청제한', [['2026-10-31', '정우진', '다솜초', '결석', '', '', '관리자'], ['2026-10-31', '학생03', '다솜초', '기한 후 취소', '', '', '관리자']]);
env.ctx.writeTable_('점검자', [['owner@example.com', '이승주']]);
const load = (f) => parseXls(toXls(f.rows), f.name);
const up = env.call('upload', { date: '2026-11-07', files: [files.basic, files.explore, files.master].map(load) });
const maps = {};
env.call('upload', { date: '2026-11-07', files: [files.c1, files.c2].map(load) }).needMap.forEach((n) => { maps[n.key] = /초1학년/.test(n.title) ? '창의 1,2반 [1학년]' : '창의 1,2반 [2~3학년]'; });
env.call('upload', { date: '2026-11-07', files: [files.c1, files.c2].map(load), mappings: maps });
env.call('status', { date: '2026-11-07', no: '251230', status: 'done', memo: '통화 후 취소', prevAt: '' });
// 출석부 시험용: 기초 1,2반에 승인 30명 (학교 여러 곳)
const BT = '[초2~3학년]11월7일 주말SW교실 기초코딩 오전반';
const SCH = ['가온초', '해솔초등학교', '새솔초', '다솜초등학교', '누리초', '하늘초', '바다초', '푸른초', '은빛초', '샛별초'];
const big = [];
for (let i = 0; i < 30; i++) big.push([String(260000 + i), BT, '부모' + i, '010-0000-' + (2000 + i), '', '개인', '', '', '', '학생' + String(i).padStart(2, '0'), SCH[i % 10], (2 + (i % 2)) + '-' + (1 + (i % 4)), i === 29 ? '예약취소' : '승인', 'id' + i]);
env.call('upload', { date: '2026-11-07', files: [parseXls(toXls(big), '통합예약신청자목록 - 2026-11-04T090000.000.xls')] });
env.topic.rows = [['날짜', '요일', '시간', '영역', '반', '소속', '강사명', '주제', '교구'], ['11/7', '토', '오전', 'SW', '기초1', '', '', 'AI 게임', '노트북 8대'], ['11/7', '토', '오전', 'SW', '기초2', '', '', '헬로메이플', '헬로메이플, 태블릿PC']];

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
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: +(process.env.VW || 1360), height: +(process.env.VH || 900) } });
  const errors = [];
  page.on('pageerror', (e) => { errors.push(e.message); if (process.env.DEBUG_ERR) console.log('PAGE ERROR:', e.message, e.stack); });
  const payload = Buffer.from(JSON.stringify({ email: 'owner@example.com', name: '이승주', exp: Math.floor(Date.now() / 1000) + 3000 })).toString('base64url');
  // 브라우저 시계를 11/6(금) 15:00으로 고정 (11/7 수업 접수 기간 안, 출석부 작업일)
  await page.addInitScript(({ tok, now }) => {
    const RealDate = Date; const off = now - RealDate.now();
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate { constructor(...a) { super(...(a.length ? a : [RealDate.now() + off])); } static now() { return RealDate.now() + off; } };
    sessionStorage.setItem('idtoken', tok); localStorage.setItem('guide-v1', '1'); localStorage.setItem('guide-v2', '1');
  }, { tok: 'x.' + payload + '.y', now: new Date('2026-11-06T15:00:00+09:00').getTime() });
  await page.route('https://accounts.google.com/**', (r) => r.fulfill({ body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){}}}};', contentType: 'text/javascript' }));
  const calls = {};
  await page.route('https://api.test/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    delete body.token;
    calls[body.action] = (calls[body.action] || 0) + 1;
    const out = env.call(body.action, body);
    await route.fulfill({ body: JSON.stringify(out), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('http://localhost:' + port + '/');
  await page.waitForSelector('.flowbar', { timeout: 8000 }).catch(async (e) => { console.log(await page.content()); throw e; });
  await page.screenshot({ path: path.join(OUT, '1-home.png'), fullPage: true });
  // 시각 없는 이름의 파일을 직접 올리기 (파일 선택 창 대신)
  const xbuf = toXls(files.explore.rows.slice(0, 3));
  // 파일 저장 시각을 고정한 시계로 만들기 위해 페이지 안에서 파일을 만들어 넣음
  await page.evaluate(({ b64, name }) => {
    const bin = atob(b64); const arr = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    const dt = new DataTransfer(); dt.items.add(new File([arr], name, { lastModified: Date.now() }));
    const inp = document.getElementById('pick'); inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, { b64: xbuf.toString('base64'), name: '통합예약신청자목록 (1).xls' });
  await page.waitForSelector('.result-line', { timeout: 15000 });
  const line = await page.$eval('.result-line', (e) => e.textContent);
  console.log('직접 올리기 결과:', line);
  if (!/반영|이미 더 최근/.test(line)) throw new Error('시각 없는 파일 이름 업로드 실패: ' + line);
  await page.screenshot({ path: path.join(OUT, '0-upload.png') });
  await page.click('[data-view=review]');
  await page.waitForSelector('details.rcard');
  const rtext = await page.textContent('details.rcard');
  if (!/신청 제한 2명/.test(rtext) || !/신청함 1명/.test(rtext) || !/정우진[^]*아직 신청 안 함/.test(rtext)) throw new Error('신청 제한 명단 카드: ' + rtext.slice(0, 160));
  console.log('점검 목록 위 신청 제한 명단: 2명 · 신청함 1명(학생03) · 아직 신청 안 함 1명 확인');
  await page.screenshot({ path: path.join(OUT, '2-review.png'), fullPage: true });
  const memoBox = page.locator('[data-done="251210"]:visible').locator('xpath=..').locator('.memo');
  await memoBox.fill('통화함');
  const stateBefore = calls.state || 0;
  const tClick = Date.now();
  await page.locator('[data-done="251210"]:visible').click();
  await page.waitForFunction(() => !document.querySelector('[data-done="251210"]'));
  const tShown = Date.now() - tClick;
  for (let k = 0; k < 30 && !env.ctx.readTable_('처리기록').rows.some((r) => r[1] === '251210'); k++) await page.waitForTimeout(100);
  if (!env.ctx.readTable_('처리기록').rows.some((r) => r[1] === '251210' && r[5] === '통화함')) throw new Error('[완료]가 시트에 저장되지 않음');
  await page.waitForTimeout(500);
  if ((calls.state || 0) !== stateBefore) throw new Error('[완료] 뒤에 전체를 다시 받음');
  console.log('[완료]: 화면 바로 바뀜(' + tShown + 'ms) · 시트 저장 · 전체 다시 받기 없음');
  const memoSaved = await page.evaluate(() => document.body.textContent.includes('통화함'));
  if (!memoSaved) throw new Error('메모가 저장되지 않음');
  await page.click('[data-view=full]');
  await page.click('[data-expand="251188"]');
  await page.screenshot({ path: path.join(OUT, '3-full.png'), fullPage: false });
  await page.fill('#q', '김하늘');
  await page.waitForTimeout(200);
  await page.type('#q', '');
  await page.keyboard.type('');
  const shown = await page.$$eval('table.fixed tbody tr:not(.group)', (rs) => rs.length);
  const qv = await page.$eval('#q', (e) => e.value);
  const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  if (qv !== '김하늘' || focused !== 'q') throw new Error('검색칸 값/포커스 유지 실패: ' + qv + ' ' + focused);
  // 정렬·빠른 필터
  await page.fill('#q', '');
  await page.click('[data-sort="9"]');
  await page.click('[data-fq="result:red"]');
  const reds = await page.$$eval('table.fixed tbody tr:not(.group):not(.expand)', (rs) => rs.map((r) => r.className));
  if (!reds.length || reds.some((c) => c !== 'lv-red')) throw new Error('취소 대상 필터 실패: ' + reds.join(','));
  await page.screenshot({ path: path.join(OUT, '3b-filter.png') });
  await page.click('[data-act=clear-filter]');
  // 홈 카드 → 승인 대상(대기)
  await page.click('[data-view=home]');
  await page.click('[data-go=wait]');
  const states = await page.$$eval('table.fixed tbody tr:not(.group):not(.expand)', (rs) => rs.map((r) => r.children[9] && r.children[9].textContent));
  if (!states.length || states.some((v) => v !== '대기')) throw new Error('대기 필터 실패: ' + states.join(','));
  await page.screenshot({ path: path.join(OUT, '3c-wait.png') });
  await page.click('[data-act=clear-filter]');
  page.on('dialog', (d) => d.accept());
  // 같은 반 요청 묶기
  await page.click('[data-view=full]');
  await page.check('[data-sel="260000"]');
  await page.check('[data-sel="260001"]');
  await page.click('[data-x=sel-link]');
  await page.click('[data-m=ok]');
  await page.waitForSelector('.badge.link');
  // 결석 표시 (예약취소 줄과 일반 줄)
  await page.click('[data-keepabs="260029"]');
  await page.waitForSelector('[data-keepabs="260029"].absent-on');
  await page.click('[data-keepabs="260003"]');
  await page.waitForSelector('[data-keepabs="260003"].absent-on');
  // 전체 명단 원본 내려받기
  const [rawDl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=raw-export]')]);
  await rawDl.saveAs(path.join(OUT, 'raw.xlsx'));
  // 결석 화면
  await page.click('[data-view=abs]');
  const absCount = await page.$$eval('.abs-tbl tbody tr', (c) => c.length);
  if (absCount !== 2) throw new Error('결석 기록 수: ' + absCount);
  await page.selectOption('.abs-tbl tbody tr:first-child select', '질병');
  // 기한 후 취소 학생 직접 등록 (학생명·학교·학년반만)
  await page.fill('#abs-new .abs-new:nth-child(1) .an', '테스트학생'); await page.fill('#abs-new .abs-new:nth-child(1) .as', '가온초'); await page.fill('#abs-new .abs-new:nth-child(1) .ab', '3학년 2반');
  await page.fill('#abs-new .abs-new:nth-child(2) .an', '빈칸학생');
  await page.click('[data-x=abs-add]');
  await page.waitForSelector('.abs-new.bad');
  await page.fill('#abs-new .abs-new:nth-child(2) .as', '해솔초'); await page.fill('#abs-new .abs-new:nth-child(2) .ab', '4-1');
  await page.click('[data-x=abs-addrow]');
  if ((await page.$$('#abs-new .abs-new')).length !== 4) throw new Error('줄 추가 안 됨');
  await page.fill('#abs-new .abs-new:nth-child(4) .an', '넷째학생'); await page.fill('#abs-new .abs-new:nth-child(4) .as', '다솜초'); await page.fill('#abs-new .abs-new:nth-child(4) .ab', '2-3');
  await page.click('[data-x=abs-add]');
  await page.waitForFunction(() => document.querySelectorAll('.abs-tbl tbody tr').length === 5);
  const firstCols = await page.$$eval('.abs-tbl tbody tr td.cls-name', (t) => t.map((x) => x.textContent));
  console.log('결석 목록 반:', firstCols.join(' | '));
  await page.waitForFunction(() => /모두 저장됨/.test((document.getElementById('abs-sync') || {}).textContent || ''));
  {
    const rows = env.ctx.readTable_('결석기록').rows;
    const man = rows.filter((r) => r[3] === '테스트학생')[0];
    if (rows.length !== 5 || !man || man[9] !== '기한 후 취소' || man[5] !== '3-2' || man[4] !== '가온초등학교') throw new Error('결석 기록 시트: ' + JSON.stringify(rows.map((r) => [r[3], r[9]])));
    if (!rows.some((r) => r[9] === '질병')) throw new Error('사유 변경이 시트에 저장되지 않음');
    console.log('결석: 한 줄 목록 5명, 여러 명 한꺼번에 등록·사유 변경 시트 저장 확인');
  }
  await page.screenshot({ path: path.join(OUT, '6-abs.png'), fullPage: true });
  // 출석부: 작업 시작 전 미리보기 (새 명단이 오면 자동으로 다시 분반)
  const lastAtt = () => { const rows = env.ctx.readTable_('출석부').rows; const r = rows[rows.length - 1]; return r ? { v: +r[1], data: JSON.parse(r[4]) } : null; };
  await page.click('[data-view=att]');
  await page.waitForSelector('text=작업 시작 전 미리보기');
  await page.screenshot({ path: path.join(OUT, '7a-preview.png'), fullPage: true });
  const big3 = big.map((r) => r.slice());
  big3.push(['260101', BT, '또보호자', '010-0000-3001', '', '개인', '', '', '', '또학생', '해솔초', '3-1', '승인', 'idnew2']);
  env.call('upload', { date: '2026-11-07', files: [parseXls(toXls(big3), '통합예약신청자목록 - 2026-11-05T080000.000.xls')] });
  await page.click('[data-act=refresh]');
  await page.waitForFunction(() => /분반을 다시 했습니다/.test(document.getElementById('toast').textContent));
  if (!(await page.textContent('body')).includes('또학생')) throw new Error('작업 시작 전 자동 재분반 안 됨');
  console.log('작업 시작 전: 새 명단으로 자동 재분반 확인');
  // 참가 신청 최종 확정 · 출석부 작업 시작 → 분반 고정 (1차)
  await page.click('[data-x=att-start-work]');
  await page.waitForSelector('text=출석부 작업 중');
  if (!lastAtt() || lastAtt().v !== 1) throw new Error('작업 시작 저장 안 됨');
  // 반 설정은 고정된 출석부에서
  const openSet = async (i) => { await page.click('[data-x=att-setopen] >> nth=' + i); await page.waitForSelector('[data-xc=att-b][data-i="' + i + '"][data-f=room1]'); };
  for (let i = 0; i < 4; i++) await openSet(i);
  const sel = async (i, f, v) => page.selectOption('[data-xc=att-b][data-i="' + i + '"][data-f=' + f + ']', v);
  const typ = async (i, f, v) => page.fill('[data-xi=att-b][data-i="' + i + '"][data-f=' + f + ']', v);
  await sel(0, 'room1', '라온실'); await sel(0, 'room2', '놀이실');
  await sel(1, 'room1', '놀이실'); await sel(1, 'room2', '라온실');
  await sel(2, 'room1', '라온실');
  if (!(await page.textContent('body')).includes('겹칩니다')) throw new Error('교실 겹침 검사가 안 됨');
  await sel(2, 'room1', '혜윰실');
  await sel(3, 'room1', '창의실');
  await typ(0, 'tool1', '스케치북'); await typ(0, 'tool2', '3D펜');
  await typ(1, 'tool1', '3D펜'); await typ(1, 'tool2', '스케치북');
  await typ(2, 'tool1', '파이썬'); await typ(3, 'tool1', '핏츠, 코너드');
  await typ(0, 'name', '기초코딩 오전1반');
  const tag0 = await page.inputValue('[data-xi=att-b][data-i="0"][data-f=tag]');
  if (tag0 !== '기초1') throw new Error('신청반 자동: ' + tag0);
  await page.screenshot({ path: path.join(OUT, '7b-settings.png'), fullPage: true });
  await page.click('[data-x=att-save2]');
  await page.waitForFunction(() => /2차로 저장/.test(document.getElementById('toast').textContent));
  if (lastAtt().v !== 2 || !/기초코딩 오전1반/.test(lastAtt().data.blocks[0].title) || lastAtt().data.blocks[0].tool1 !== '스케치북') throw new Error('반 설정 저장 안 됨');
  // 웹앱에서 바로 인쇄 → 인쇄한 반 기록 (PRINT_PDF=1이면 인쇄 화면을 PDF로 저장해 모양 확인)
  if (process.env.PRINT_PDF) {
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('[data-x=att-print][data-what=all]');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, 'print-all.pdf'), preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.print = () => {}; });
    await page.click('[data-x=att-print][data-what=contacts]');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(OUT, 'print-contacts.pdf'), preferCSSPageSize: true, printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.waitForTimeout(1200);
  } else await page.click('[data-x=att-print][data-what=all]');
  for (let k = 0; k < 30 && !lastAtt().data.printed; k++) await page.waitForTimeout(100);
  const pr = lastAtt().data.printed || {};
  if (Object.keys(pr).length !== lastAtt().data.blocks.length) throw new Error('인쇄 기록: ' + JSON.stringify(pr));
  await page.waitForSelector('[data-x=att-print][data-what=changed][disabled]');
  console.log('웹앱 인쇄: 전체 인쇄 → 인쇄한 반 기록, 아직 인쇄 안 한 반 0');
  // 엑셀·명렬표도 내려받기 가능
  await page.click('details.more summary');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-x=att-redl]')]);
  await dl.saveAs(path.join(OUT, 'att1.xlsx'));
  const [dlc] = await Promise.all([page.waitForEvent('download'), page.click('[data-x=att-contacts]')]);
  await dlc.saveAs(path.join(OUT, 'contacts1.xlsx'));
  {
    const X = require(process.env.XLSX_PATH || 'xlsx');
    const wb = X.readFile(path.join(OUT, 'contacts1.xlsx'));
    const aoa = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const flat = aoa.map((r) => r.join('|'));
    if (!flat.some((t) => /명렬표/.test(t)) || !flat.some((t) => /대기자 \d+명/.test(t))) throw new Error('명렬표 내용 이상');
    if (!flat.some((t) => /010-0000-\d{4}/.test(t))) throw new Error('명렬표에 연락처 없음');
    console.log('명렬표:', aoa.length + '줄, 대기자 구역 있음');
  }
  // 작업 시작 뒤 새 명단: 학생00 예약취소 + 새 승인 + 대기 → 바뀌지 않고 「변동 사항」
  {
    const big2 = big3.map((r) => r.slice());
    big2[0][12] = '예약취소';
    big2.push(['260100', BT, '새보호자', '010-0000-3000', '', '개인', '', '', '', '새학생', '가온초', '2-1', '승인', 'idnew']);
    big2.push(['260102', BT, '대기보호자', '010-0000-3002', '', '개인', '', '', '', '대기학생', '해솔초', '2-2', '대기', 'idwait']);
    const up2 = env.call('upload', { date: '2026-11-07', files: [parseXls(toXls(big2), '통합예약신청자목록 - 2026-11-05T090000.000.xls')] });
    if (up2.results[0].result !== '반영') throw new Error('새 명단 업로드: ' + JSON.stringify(up2.results));
  }
  await page.click('[data-act=refresh]');
  await page.waitForSelector('text=변동 사항 2건');
  const stillThere = await page.$$eval('.xls td', (tds) => tds.some((td) => td.textContent === '학생00'));
  if (!stillThere) throw new Error('작업 중 출석부가 자동으로 바뀜');
  // 대기자 연락표: 참석 확정 기록 (공유)
  await page.click('details.wl summary');
  await page.click('[data-x=wl][data-no="260102"][data-r="참석 확정"]');
  for (let k = 0; k < 30 && !env.ctx.readTable_('대기자연락').rows.length; k++) await page.waitForTimeout(100);
  if (!env.ctx.readTable_('대기자연락').rows.some((r) => r[1] === '260102' && r[2] === '참석 확정')) throw new Error('대기자 연락 결과가 저장되지 않음');
  await page.screenshot({ path: path.join(OUT, '8a-changes.png'), fullPage: false });
  const optFirst = await page.$eval('[id^=rep-] option', (o) => o.textContent);
  if (!/^★/.test(optFirst)) throw new Error('참석 확정 대기자가 교체 후보 맨 위가 아님: ' + optFirst);
  await page.selectOption('[id^=rep-]', '260100');
  await page.click('[data-x=chg-replace]');
  // 저장 전에 다른 점검자가 먼저 저장하면: 내 변경을 말없이 지우지 않고 알림
  {
    const la = lastAtt();
    const other = env.call('attSave', { date: '2026-11-07', data: la.data, baseVersion: la.v });
    if (!other.version) throw new Error('다른 점검자 저장 흉내 실패');
    await page.click('[data-act=refresh]');
    await page.waitForSelector('text=먼저 저장했습니다');
    if (!(await page.$('[data-x=att-save2][disabled]'))) throw new Error('먼저 저장된 뒤에도 저장 버튼이 눌림');
    const kept = await page.$$eval('.xls td', (tds) => tds.some((td) => td.textContent === '새학생'));
    if (!kept) throw new Error('저장 안 한 내 변경이 말없이 사라짐');
    await page.click('[data-x=att-reload]');
    await page.waitForSelector('text=변동 사항 2건');
    console.log('다른 점검자가 먼저 저장: 내 변경 유지 + 안내 → 새로 불러오기 확인');
    await page.selectOption('[id^=rep-]', '260100');
    await page.click('[data-x=chg-replace]');
  }
  await page.click('[data-x=att-save2]');
  await page.waitForFunction(() => /\d차로 저장/.test(document.getElementById('toast').textContent));
  {
    const d3 = lastAtt().data;
    const allNames = d3.blocks.flatMap((b) => b.students.filter((x) => x.status !== '취소').map((x) => x.name));
    if (!allNames.includes('새학생') || allNames.includes('학생00')) throw new Error('교체가 저장되지 않음');
    if (!(d3.changed || []).length) throw new Error('바뀐 반 기록 없음');
  }
  await page.waitForSelector('[data-x=att-print][data-what=changed]:not([disabled])');
  const upLabel = await page.textContent('[data-x=att-print][data-what=changed]');
  if (!/바뀐 반 인쇄/.test(upLabel)) throw new Error('바뀐 반 인쇄 버튼: ' + upLabel);
  if (!/\(1\)/.test(upLabel)) throw new Error('아직 인쇄 안 한 바뀐 반: ' + upLabel);
  await page.click('[data-x=att-print][data-what=changed]');
  await page.waitForSelector('[data-x=att-print][data-what=changed][disabled]');
  console.log('작업 중 변동: 알림 → 대기자 연락 기록 → 교체 → 저장 → 바뀐 반만 인쇄 확인');
  // 늦게 저장하는 쪽은 막힘
  const conflict = env.call('attSave', { date: '2026-11-07', data: { blocks: [] }, baseVersion: 1 });
  if (conflict.code !== 'CONFLICT') throw new Error('차수 충돌을 막지 않음');
  await page.click('[data-x=att-cancel][data-i="0"]');
  await page.click('[data-x=att-save2]');
  await page.waitForFunction(() => /\d차로 저장/.test(document.getElementById('toast').textContent) && !document.querySelector('[data-x=att-save2]:not([disabled])'));
  // 당일 결석 체크
  await page.check('[data-xc=att-absent][data-i="1"][data-j="0"]');
  await page.waitForSelector('.abs-chk.on');
  for (let k = 0; k < 40 && !env.ctx.readTable_('결석기록').rows.some((r) => r[8] === '출석부 결석 체크'); k++) await page.waitForTimeout(100);
  if (!env.ctx.readTable_('결석기록').rows.some((r) => r[8] === '출석부 결석 체크' && r[9] === '당일 무단결석')) throw new Error('출석부 결석 체크가 시트에 저장되지 않음');
  console.log('출석부 결석 체크 → 결석 기록 저장 확인');
  await page.screenshot({ path: path.join(OUT, '8-att-saved.png'), fullPage: true });
  await page.click('[data-view=abs]');
  const labels2 = await page.$$eval('.abs-tbl tbody tr td.cls-name', (t) => t.map((x) => x.textContent));
  console.log('출석부 저장 뒤 결석 목록 반:', labels2.join(' | '));
  await page.screenshot({ path: path.join(OUT, '6b-abs-after.png'), fullPage: true });
  await page.click('[data-view=att]');
  // 처음부터 다시 만들기: 미리보기 → 다시 시작해도 반 설정(이름·교실·교구)은 이어짐
  await page.click('details.more summary');
  await page.click('[data-x=att-rebuild]');
  await page.waitForSelector('[data-x=att-start-work]');
  await page.click('[data-x=att-start-work]');
  await page.waitForFunction(() => /새로 나눈 출석부/.test(document.getElementById('toast').textContent));
  const rb = lastAtt().data.blocks[0];
  if (rb.tool1 !== '스케치북' || rb.room1 !== '라온실' || rb.name !== '기초코딩 오전1반') throw new Error('다시 만들 때 반 설정이 사라짐: ' + JSON.stringify([rb.tool1, rb.room1, rb.name]));
  console.log('처음부터 다시 만들기: 반 설정 유지 확인');
  console.log('내려받은 파일:', rawDl.suggestedFilename(), dl.suggestedFilename(), dlc.suggestedFilename());
  await page.click('[data-view=settings]');
  await page.waitForSelector('text=수업일');
  await page.waitForSelector('#set-dates');
  // 설정 메뉴에서 고치기: 수업일 비고 고치고 줄 추가 → 저장
  await page.fill('#set-dates tbody tr:nth-child(2) [data-c="2"]', '테스트 비고');
  await page.waitForSelector('#set-dates .badge.warn');
  await page.click('[data-x=set-add][data-tab=dates]');
  if ((await page.inputValue('#set-dates tbody tr:nth-child(2) [data-c="2"]')) !== '테스트 비고') throw new Error('줄 추가하면서 입력이 사라짐');
  await page.fill('#set-dates tbody tr:last-child [data-c="0"]', '11');
  await page.fill('#set-dates tbody tr:last-child [data-c="1"]', '2026-12-12');
  await page.click('[data-x=set-save][data-tab=dates]');
  await page.waitForFunction(() => /수업일 설정을 저장/.test(document.getElementById('toast').textContent));
  const dr = env.ctx.readTable_('설정_수업일').rows;
  if (!dr.some((r) => r[2] === '테스트 비고') || !dr.some((r) => r[1] === '2026-12-12')) throw new Error('설정 저장이 시트에 반영되지 않음');
  // 잘못된 값은 표 위에 이유
  await page.waitForSelector('#set-classes');
  await page.selectOption('#set-classes tbody tr:first-child [data-c="4"]', '초1');
  await page.fill('#set-classes tbody tr:first-child [data-c="6"]', '열여섯');
  await page.click('[data-x=set-save][data-tab=classes]');
  await page.waitForSelector('#set-classes >> text=정원은 숫자입니다');
  await page.click('[data-x=set-reset][data-tab=classes]');
  console.log('설정 메뉴: 수업일 고치기·줄 추가·저장, 잘못된 값 안내 확인');
  await page.screenshot({ path: path.join(OUT, '4-settings.png'), fullPage: true });
  await page.click('[data-act=guide]');
  await page.waitForSelector('text=지금 할 일');
  await page.screenshot({ path: path.join(OUT, '5-guide.png'), fullPage: true });
  await browser.close();
  server.close();
  console.log('검색 결과 줄 수:', shown, '/ 페이지 오류:', errors.length ? errors : '없음');
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
