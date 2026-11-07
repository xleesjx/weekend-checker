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

const env = createEnv({ now: new Date('2026-11-04T10:00:00+09:00') });
env.ctx.setupSheets();
env.ctx.writeTable_('설정_학교', [['가온초등학교', '초'], ['해솔초등학교', '초'], ['새솔초등학교', '초'], ['다솜초등학교', '초'], ['누리중학교', '중']]);
env.ctx.writeTable_('신청제한', [['2026-10-31', '정우진', '다솜초', '결석', '', '', '관리자']]);
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
  page.on('pageerror', (e) => errors.push(e.message));
  const payload = Buffer.from(JSON.stringify({ email: 'owner@example.com', name: '이승주', exp: Math.floor(Date.now() / 1000) + 3000 })).toString('base64url');
  await page.addInitScript((tok) => { sessionStorage.setItem('idtoken', tok); localStorage.setItem('guide-v1', '1'); }, 'x.' + payload + '.y');
  await page.route('https://accounts.google.com/**', (r) => r.fulfill({ body: 'window.google={accounts:{id:{initialize(){},renderButton(){},prompt(){}}}};', contentType: 'text/javascript' }));
  await page.route('https://api.test/**', async (route) => {
    const body = JSON.parse(route.request().postData());
    delete body.token;
    const out = env.call(body.action, body);
    await route.fulfill({ body: JSON.stringify(out), contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' } });
  });
  await page.goto('http://localhost:' + port + '/');
  await page.waitForSelector('.steps', { timeout: 8000 }).catch(async (e) => { console.log(await page.content()); throw e; });
  await page.screenshot({ path: path.join(OUT, '1-home.png'), fullPage: true });
  // 시각 없는 이름의 파일을 직접 올리기 (파일 선택 창 대신)
  const xbuf = toXls(files.explore.rows.slice(0, 3));
  await page.setInputFiles('#pick', [{ name: '통합예약신청자목록 (1).xls', mimeType: 'application/vnd.ms-excel', buffer: xbuf }]);
  await page.waitForSelector('.result-line', { timeout: 15000 });
  const line = await page.$eval('.result-line', (e) => e.textContent);
  console.log('직접 올리기 결과:', line);
  if (!/반영|이미 더 최근/.test(line)) throw new Error('시각 없는 파일 이름 업로드 실패: ' + line);
  await page.screenshot({ path: path.join(OUT, '0-upload.png') });
  await page.click('[data-view=review]');
  await page.screenshot({ path: path.join(OUT, '2-review.png'), fullPage: true });
  const memoBox = page.locator('[data-done="251210"]:visible').locator('xpath=..').locator('.memo');
  await memoBox.fill('통화함');
  await page.locator('[data-done="251210"]:visible').click();
  await page.waitForFunction(() => !document.querySelector('[data-done="251210"]'));
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
  await page.fill('#an', '테스트학생'); await page.fill('#as', '가온초'); await page.fill('#ab', '3학년 2반');
  await page.click('[data-x=abs-add]');
  await page.waitForFunction(() => document.querySelectorAll('.abs-tbl tbody tr').length === 3);
  await page.waitForFunction(() => /모두 저장됨/.test((document.getElementById('abs-sync') || {}).textContent || ''));
  {
    const rows = env.ctx.readTable_('결석기록').rows;
    const man = rows.filter((r) => r[3] === '테스트학생')[0];
    if (rows.length !== 3 || !man || man[9] !== '기한 후 취소' || man[5] !== '3-2' || man[4] !== '가온초등학교') throw new Error('결석 기록 시트: ' + JSON.stringify(rows.map((r) => [r[3], r[9]])));
    if (!rows.some((r) => r[9] === '질병')) throw new Error('사유 변경이 시트에 저장되지 않음');
    console.log('결석: 한 줄 목록 3명, 직접 등록·사유 변경 시트 저장 확인');
  }
  await page.screenshot({ path: path.join(OUT, '6-abs.png'), fullPage: true });
  // 출석부: 단계별
  await page.click('[data-view=att]');
  await page.click('[data-x=att-start]');
  await page.screenshot({ path: path.join(OUT, '7a-step1.png') });
  await page.click('[data-x=att-next]');
  // 교실을 고르지 않으면 넘어가지 않음
  await page.click('[data-x=att-next]');
  if (!(await page.$('.xl-t1 select'))) throw new Error('반 설정 화면이 아님');
  const sel = async (i, f, v) => page.selectOption('[data-xc=att-b][data-i="' + i + '"][data-f=' + f + ']', v);
  const typ = async (i, f, v) => page.fill('[data-xi=att-b][data-i="' + i + '"][data-f=' + f + ']', v);
  await sel(0, 'room1', '라온실'); await sel(0, 'room2', '놀이실');
  await sel(1, 'room1', '놀이실'); await sel(1, 'room2', '라온실');
  await sel(2, 'room1', '라온실');
  await page.click('[data-x=att-next]');
  if (!(await page.textContent('body')).includes('겹칩니다')) throw new Error('교실 겹침 검사가 안 됨');
  await sel(2, 'room1', '혜윰실');
  await sel(3, 'room1', '창의실');
  await typ(0, 'tool1', '스케치북'); await typ(0, 'tool2', '3D펜');
  await typ(1, 'tool1', '3D펜'); await typ(1, 'tool2', '스케치북');
  await typ(2, 'tool1', '파이썬'); await typ(3, 'tool1', '핏츠, 코너드');
  await typ(0, 'name', '기초코딩 오전1반');
  const tag0 = await page.inputValue('[data-xi=att-b][data-i="0"][data-f=tag]');
  if (tag0 !== '기초1') throw new Error('신청반 자동: ' + tag0);
  await page.screenshot({ path: path.join(OUT, '7b-step2.png'), fullPage: true });
  await page.click('[data-x=att-next]');
  await page.waitForSelector('.xls');
  await page.screenshot({ path: path.join(OUT, '7c-step3.png'), fullPage: true });
  const parts = await page.$$eval('section .row.between b', (bs) => bs.map((b) => b.textContent).filter((t) => /반|마스터/.test(t)));
  console.log('분반 블록:', parts.join(' | '));
  await page.click('[data-x=att-next]');
  await page.screenshot({ path: path.join(OUT, '7d-step4.png'), fullPage: true });
  const dls = [];
  const onDl = (d) => dls.push(d);
  page.on('download', onDl);
  await page.click('[data-x=att-save]');
  for (let k = 0; k < 40 && dls.length < 2; k++) await page.waitForTimeout(250);
  page.off('download', onDl);
  if (dls.length < 2) throw new Error('출석부와 명렬표가 함께 내려받아지지 않음: ' + dls.length);
  const dl = dls[0];
  await dl.saveAs(path.join(OUT, 'att1.xlsx'));
  await dls[1].saveAs(path.join(OUT, 'contacts1.xlsx'));
  {
    const X = require(process.env.XLSX_PATH || 'xlsx');
    const wb = X.readFile(path.join(OUT, 'contacts1.xlsx'));
    const aoa = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const flat = aoa.map((r) => r.join('|'));
    const waitRow = flat.findIndex((t) => /추가대기 \d+명/.test(t));
    if (!flat.some((t) => /명렬표/.test(t)) || !flat.some((t) => /연락처/.test(t)) || waitRow < 0) throw new Error('명렬표 내용 이상');
    if (!flat.some((t) => /010-0000-\d{4}/.test(t))) throw new Error('명렬표에 연락처 없음');
    console.log('명렬표:', aoa.length + '줄, 추가대기 구역 있음, 첫 반 학생 ' + flat.slice(3).findIndex((t) => !/^\d+\|/.test(t)) + '명');
  }
  await page.waitForSelector('[data-x=att-cancel]');
  await page.click('[data-x=att-cancel][data-i="0"]');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-x=att-save2]')]);
  await dl2.saveAs(path.join(OUT, 'att2.xlsx'));
  // 확정 출석부에서 당일 결석 체크
  await page.check('[data-xc=att-absent][data-i="1"][data-j="0"]');
  await page.waitForSelector('.abs-chk.on');
  await page.waitForFunction(() => /모두 저장됨/.test((document.getElementById('abs-sync') || {}).textContent || '') || !document.getElementById('abs-sync'));
  for (let k = 0; k < 40 && !env.ctx.readTable_('결석기록').rows.some((r) => r[8] === '출석부 결석 체크'); k++) await page.waitForTimeout(100);
  if (!env.ctx.readTable_('결석기록').rows.some((r) => r[8] === '출석부 결석 체크' && r[9] === '당일 무단결석')) throw new Error('출석부 결석 체크가 시트에 저장되지 않음');
  console.log('출석부 결석 체크 → 결석 기록 저장 확인');
  await page.screenshot({ path: path.join(OUT, '8-att-saved.png'), fullPage: true });
  // 처음부터 다시 만들어도 반 설정이 그대로 남아 있어야 함
  await page.click('[data-x=att-rebuild]');
  await page.click('[data-x=att-next]');
  const kept = [await page.inputValue('[data-xi=att-b][data-i="0"][data-f=tool1]'), await page.$eval('[data-xc=att-b][data-i="0"][data-f=room1]', (e) => e.value), await page.inputValue('[data-xi=att-b][data-i="0"][data-f=name]')];
  if (kept.join('|') !== '스케치북|라온실|기초코딩 오전1반') throw new Error('반 설정이 남아 있지 않음: ' + kept.join('|'));
  console.log('다시 만들 때 반 설정 유지:', kept.join(' / '));
  console.log('내려받은 파일:', rawDl.suggestedFilename(), dl.suggestedFilename(), dl2.suggestedFilename());
  await page.click('[data-view=settings]');
  await page.waitForSelector('text=수업일');
  await page.screenshot({ path: path.join(OUT, '4-settings.png'), fullPage: true });
  await page.click('[data-act=guide]');
  await page.screenshot({ path: path.join(OUT, '5-guide.png') });
  await browser.close();
  server.close();
  console.log('검색 결과 줄 수:', shown, '/ 페이지 오류:', errors.length ? errors : '없음');
  if (errors.length) process.exit(1);
})().catch((e) => { console.error(e); server.close(); process.exit(1); });
