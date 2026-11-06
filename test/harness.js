/* Apps Script 서비스를 흉내 내서 gas/Code.gs 를 Node에서 실행합니다. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

function makeSheet(name) {
  let data = [];
  const sheet = {
    name, data: () => data, protections: [],
    getDataRange: () => ({ getValues: () => (data.length ? data.map(r => r.slice()) : [['']]) }),
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rg = {
        setValues: (v) => {
          for (let i = 0; i < nr; i++) {
            while (data.length < r + i) data.push([]);
            const row = data[r - 1 + i];
            for (let j = 0; j < nc; j++) {
              while (row.length < c + j) row.push('');
              let val = v[i][j];
              if (typeof val === 'string' && /^=/.test(val)) throw new Error('수식이 그대로 저장됨: ' + val);
              if (typeof val === 'string' && val.startsWith("'")) val = val.slice(1);
              row[c - 1 + j] = val;
            }
          }
          return rg;
        },
        setNumberFormat: () => rg, setFontWeight: () => rg
      };
      return rg;
    },
    clearContents: () => { data = []; },
    setFrozenRows: () => {}, setColumnWidth: () => {}, setConditionalFormatRules: () => {},
    getLastRow: () => data.length, getMaxRows: () => Math.max(1000, data.length),
    getProtections: () => sheet.protections,
    protect: () => { const p = { setWarningOnly: () => p, setDescription: () => p }; sheet.protections.push(p); return p; }
  };
  return sheet;
}

function createEnv(opts) {
  opts = opts || {};
  const sheets = {};
  const props = { CLIENT_ID: 'test-client' };
  const cache = {};
  let now = opts.now || new Date('2026-11-04T10:00:00+09:00');
  const pad = (n) => String(n).padStart(2, '0');
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n)),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
    getSheets: () => Object.values(sheets),
    deleteSheet: (s) => { delete sheets[s.name]; }
  };
  const topic = { rows: [] };
  const ctx = {
    console,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      openById: () => ({ getSheetByName: (n) => (n === '하반기' ? { getDataRange: () => ({ getValues: () => topic.rows }) } : null) }),
      getUi: () => { throw new Error('no ui'); },
      newConditionalFormatRule: () => { const b = { whenTextStartsWith: () => b, setBackground: () => b, setFontColor: () => b, setRanges: () => b, build: () => ({}) }; return b; },
      ProtectionType: { SHEET: 'SHEET' }
    },
    ContentService: { createTextOutput: (s) => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s).digest()),
      base64EncodeWebSafe: (b) => Buffer.from(b).toString('base64url'),
      formatDate: (d, tz, fmt) => {
        const k = new Date(d.getTime() + 9 * 3600000);
        const y = k.getUTCFullYear(), M = pad(k.getUTCMonth() + 1), D = pad(k.getUTCDate());
        if (fmt === 'yyyy-MM-dd') return `${y}-${M}-${D}`;
        return `${y}-${M}-${D} ${pad(k.getUTCHours())}:${pad(k.getUTCMinutes())}:${pad(k.getUTCSeconds())}`;
      }
    },
    UrlFetchApp: {
      fetch: (url) => {
        const m = /id_token=([^&]+)/.exec(url);
        const tok = m ? decodeURIComponent(m[1]) : '';
        if (!tok.startsWith('tok:')) return { getResponseCode: () => 400, getContentText: () => '{}' };
        const email = tok.slice(4);
        return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ aud: props.CLIENT_ID, iss: 'https://accounts.google.com', email_verified: 'true', exp: String(Math.floor(Date.now() / 1000) + 3000), email }) };
      }
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) }
  };
  // 테스트용 시계
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(now.getTime()); } static now() { return RealDate.now(); } }
  ctx.Date = FakeDate;
  vm.createContext(ctx);
  const root = path.join(__dirname, '..');
  // Apps Script 처럼 Code.gs 가 Core.gs 보다 먼저 실행되어도 동작해야 합니다
  vm.runInContext(fs.readFileSync(path.join(root, 'gas/Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  vm.runInContext(fs.readFileSync(path.join(root, 'gas/Core.gs'), 'utf8'), ctx, { filename: 'Core.gs' });
  return {
    ctx, sheets, props, topic,
    setNow: (d) => { now = d; },
    call: (action, payload, email) => {
      const out = ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ action, token: 'tok:' + (email || 'owner@example.com') }, payload || {})) } });
      return JSON.parse(out.s);
    },
    table: (n) => (sheets[n] ? sheets[n].data() : [])
  };
}

module.exports = { createEnv };
