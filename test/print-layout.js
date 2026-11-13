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
  await browser.close();
  console.log('인쇄 모양 확인 통과');
})().catch((e) => { console.error(e); process.exit(1); });
