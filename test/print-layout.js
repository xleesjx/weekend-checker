/*
 * 인쇄 모양 확인 (A4, 여백 20mm): 반마다 한 장, 네 면 여백이 20mm 안팎, 명렬표도 한 장에 들어가는지
 * 실행: node test/print-layout.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
global.Core = require('../docs/core.js');
const R = require('../docs/roster.js');
const { chromium } = require('playwright');

const css = fs.readFileSync(path.join(__dirname, '..', 'docs', 'style.css'), 'utf8');
const MM = 96 / 25.4;
const mk = (n) => { const a = []; for (let i = 0; i < n; i++) a.push({ name: '학생' + i, school: '가온초등학교', ban: '3-1', parent: '보호자', phone: '010-1234-5678', state: '대기' }); return a; };
const fail = (m) => { console.error('실패: ' + m); process.exit(1); };

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'print-'));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const run = async (name, body) => {
    const f = path.join(dir, name + '.html');
    fs.writeFileSync(f, '<!doctype html><meta charset="utf-8"><style>' + css + '</style><body class="printing"><div id="print-area">' + body + '</div></body>');
    await page.goto('file://' + f);
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  };

  // 출석부: 학생 16명 가득 찬 반 3개 (제목 색이 달라도 같은 크기)
  const blk = (c) => ({ title: '11월 7일 주말SW프로그램 기초코딩 오전1반 수강생 명단', line: '1-2교시 창의실, 3-4교시 혜윰실(a/b)', tag: '기초1', color: c, students: mk(16) });
  const sheets = ['FFF2CC', 'BDD7EE', 'FEBEC9'].map((c) => '<div class="pa-page">' + R.sheetHtml(blk(c), { print: true }) + '</div>').join('');
  const pages = await run('att', sheets);
  if (pages !== 3) fail('출석부 3개 반이 ' + pages + '쪽으로 나옴 (반마다 한 장이어야 함)');
  const m = await page.evaluate(() => {
    const t = document.querySelector('.xls').getBoundingClientRect(), pg = document.querySelector('.pa-page').getBoundingClientRect();
    return { w: t.width, h: t.height, l: t.left - pg.left, t: t.top - pg.top };
  });
  const L = m.l / MM, T = m.t / MM, W = m.w / MM, H = m.h / MM;
  const Rr = 210 - L - W, B = 297 - T - H;
  console.log('출석부 여백(mm): 왼쪽 ' + L.toFixed(1) + ' 위 ' + T.toFixed(1) + ' 오른쪽 ' + Rr.toFixed(1) + ' 아래 ' + B.toFixed(1) + ' · 표 ' + W.toFixed(1) + '×' + H.toFixed(1));
  [['왼쪽', L], ['위', T], ['오른쪽', Rr], ['아래', B]].forEach(([n, v]) => { if (Math.abs(v - 20) > 0.8) fail('출석부 ' + n + ' 여백 ' + v.toFixed(1) + 'mm (20mm여야 함)'); });

  // 명렬표: 대기자가 많아도 한 장에 들어감
  for (const [s, w] of [[16, 0], [16, 14], [16, 26], [14, 30]]) {
    const n = await run('cb', R.contactHtml([{ title: '11월 7일 기초코딩 오전1반 수강생 명단', line: 'L', color: 'FFF2CC', students: mk(s), waits: mk(w) }]));
    if (n !== 1) fail('명렬표(학생 ' + s + ' · 대기 ' + w + ')가 ' + n + '쪽으로 나옴');
  }
  console.log('명렬표: 학생 16 + 대기 26까지 한 장');

  // 게시용: 반마다 3장씩 → 한 장씩 나옴, 모든 반 표 크기 같음(학생 수와 무관), 긴 제목·교실도 한 줄, 굵은 바깥 테두리
  const pb = (n, o) => Object.assign({ title: 'x', line: 'x', program: 'SW', name: '기초코딩 오전1반', same: false, room1: '라온실', room2: '놀이실', tool1: '기어목걸이 만들기', tool2: '템플, 언더워터', color: 'BDD7EE',
    students: Array.from({ length: n }, (_, i) => ({ name: '학생' + i, school: i % 5 === 0 ? '울산광역시교육청초등학교' : '울산효문초등학교', ban: '3-3' })) }, o || {});
  const classes = [pb(16), pb(8, { color: 'FEBEC9' }), pb(3, { same: true, room2: '', name: '마스터코딩 오전반', tool1: '파이썬', tool2: '' }), pb(16, { program: '창의', name: '메이커1반', room1: '창의실', room2: '혜윰실', tool1: '핏츠, 코너드', tool2: '펑펑 눈내리는 마을' })];
  const post = classes.map((b) => [1, 2, 3].map(() => '<div class="pa-page post">' + R.postSheetHtml(b, '2026-11-14') + '</div>').join('')).join('');
  const np = await run('post', post);
  if (np !== classes.length * 3) fail('게시용 ' + classes.length + '개 반 × 3장이 ' + np + '쪽으로 나옴');
  const pm = await page.evaluate(() => [...document.querySelectorAll('table.post')].map((t) => {
    const r = t.getBoundingClientRect(), pg = t.closest('.pa-page').getBoundingClientRect(), cs = getComputedStyle(t);
    const t1 = t.querySelector('.po-t1'), room = t.querySelector('.po-room');
    return { w: r.width, h: r.height, l: r.left - pg.left, t: r.top - pg.top, outer: parseFloat(cs.borderTopWidth), inner: parseFloat(getComputedStyle(t.querySelector('tbody td')).borderTopWidth),
      t1h: t1.getBoundingClientRect().height, roomh: room.getBoundingClientRect().height, t1o: t1.scrollWidth > t1.clientWidth + 1 || [...t.querySelectorAll('td')].some((c) => c.scrollWidth > c.clientWidth + 1), roomo: room.scrollWidth > room.clientWidth + 1 };
  }));
  const hs = pm.map((x) => x.h);
  if (Math.max(...hs) - Math.min(...hs) > 0.5) fail('게시용 표 길이가 반마다 다름: ' + hs.map((h) => (h / MM).toFixed(1)).join(', '));
  pm.forEach((x, i) => {
    const Bm = 297 - x.t / MM - x.h / MM;
    if (Math.abs(x.l / MM - 20) > 0.8 || Math.abs(x.t / MM - 20) > 0.8 || Bm < 18.5) fail('게시용 여백 (왼 ' + (x.l / MM).toFixed(1) + ' 위 ' + (x.t / MM).toFixed(1) + ' 아래 ' + Bm.toFixed(1) + ')');
    if (x.t1o || x.roomo) fail('게시용 제목·교실 줄이 넘침 (' + i + ')');
    if (x.outer < 2.5 || x.inner > 1.5) fail('게시용 테두리 굵기: 바깥 ' + x.outer + 'px · 안쪽 ' + x.inner + 'px');
  });
  console.log('게시용 여백(mm): 왼쪽 ' + (pm[0].l / MM).toFixed(1) + ' 위 ' + (pm[0].t / MM).toFixed(1) + ' 아래 ' + (297 - pm[0].t / MM - pm[0].h / MM).toFixed(1) + ' · 표 ' + (pm[0].w / MM).toFixed(1) + '×' + (pm[0].h / MM).toFixed(1) + ' · 모든 반 같은 크기, 반마다 3장');

  // 출석부·명렬표 테두리: 굵은 선과 가는 선이 구분됨
  await run('att2', '<div class="pa-page">' + R.sheetHtml(blk('FFF2CC'), { print: true }) + '</div>');
  const bw = await page.evaluate(() => { const td = document.querySelector('.xls td'); return parseFloat(getComputedStyle(td).borderLeftWidth); });
  if (bw < 2.0) fail('출석부 바깥 테두리가 가늘음: ' + bw + 'px');
  await run('cb2', R.contactHtml([{ title: 'T', line: 'L', color: 'FFF2CC', students: mk(5), waits: [] }]));
  const cbw = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('table.cb')).borderTopWidth));
  if (cbw < 2.5) fail('명렬표 바깥 테두리가 가늘음: ' + cbw + 'px');
  console.log('테두리: 출석부 ' + bw + 'px · 명렬표 ' + cbw + 'px · 게시용 ' + pm[0].outer.toFixed(1) + 'px (안쪽은 1px 안팎)');

  await browser.close();
  console.log('인쇄 모양 확인 통과');
})().catch((e) => { console.error(e); process.exit(1); });
