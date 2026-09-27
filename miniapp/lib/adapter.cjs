'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');

function idFor(key) { return crypto.createHash('sha256').update(key).digest('hex').slice(0, 24); }
function loadAdapter(botDir) {
  const filename = path.join(botDir, 'bot.js');
  const source = fs.readFileSync(filename, 'utf8');
  // Load the original helper declarations only. No handlers, polling, or filesystem writes run.
  const boundary = source.indexOf('\nbot.catch(');
  if (boundary < 0 || !source.slice(0, boundary).includes('async function checkSiteWithRetry')) throw new Error('Unsupported bot layout');
  const originalRequire = createRequire(filename);
  const dataDir = originalRequire('../runtime/config.cjs').dataDir;
  const quiet = { log() {}, warn() {}, error() {} };
  const sandbox = { require: name => name === 'telegraf' ? { Telegraf: class {}, Markup: {} } : originalRequire(name), __dirname: botDir, Buffer, setTimeout, clearTimeout, console: quiet, exports: {} };
  vm.runInNewContext(source.slice(0, boundary) + '\nexports.api={SITES,BOT_TOKEN,checkSiteWithRetry,extractCredentials,extractFromImage,readPdfText};', sandbox, { filename: 'existing-bot-helpers.cjs', timeout: 3000 });
  const api = sandbox.exports.api;
  function accounts() {
    // Fail closed on malformed source data instead of restoring or replacing the user's files.
    const data = JSON.parse(fs.readFileSync(path.join(dataDir, 'wallets.json'), 'utf8'));
    if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Account file unavailable');
    return Object.entries(data).filter(([,v]) => v && api.SITES[v.siteId]).map(([key,v]) => ({ ...v, id: idFor(key) }));
  }
  return {
    sites: Object.entries(api.SITES).map(([id,s]) => ({id, name:s.name})), token: api.BOT_TOKEN,
    accounts,
    allowedUsers: () => JSON.parse(fs.readFileSync(path.join(dataDir, 'auth.json'), 'utf8')).filter(x => Number.isSafeInteger(x) && x > 0),
    check: async row => {
      const raw = await api.checkSiteWithRetry(row.siteId, row.phone, row.password);
      const bal = typeof raw.bal === 'number' || typeof raw.bal === 'string' ? Number(raw.bal) : NaN;
      const valid = raw.success && raw.bal !== '' && Number.isFinite(bal) && bal >= 0;
      const retryable = !valid && /try again|later|busy|timeout|429|network|ECONN|socket|ENOTFOUND/i.test(String(raw.errMsg || ''));
      // Explicit projection: login/session tokens never leave this adapter.
      return { success: !!valid, balance: valid ? bal : null, retryable, error: valid ? null : retryable ? 'Temporary site error' : raw.success ? 'Balance unavailable' : 'Login or site request failed' };
    },
    extract: async (buffer, mime) => api.extractCredentials(mime === 'application/pdf' ? await api.readPdfText(buffer) : mime.startsWith('image/') ? await api.extractFromImage(buffer) : buffer.toString('utf8')),
  };
}
function demoAdapter() {
  const sites = [{id:'demo-a',name:'Demo Wallet'},{id:'demo-b',name:'Sample Pay'},{id:'demo-c',name:'Test Wallet'}];
  const rows = Array.from({length:24},(_,i)=>({id:idFor('demo-'+i),siteId:sites[i%3].id,phone:'900000'+String(i).padStart(4,'0'),password:'Demo-only-'+i,mpin:i%3===0?'001234':undefined,userId:1000+i,lastBal:8250-i*290}));
  return {sites,token:'demo-token',allowedUsers:()=>[],accounts:()=>rows,check:async row=>{await new Promise(r=>setTimeout(r,160));return {success:true,balance:row.lastBal+20,retryable:false};},extract:async()=>[{phone:'9000000000',password:'Demo-only',mpin:'001234'}]};
}
module.exports = { loadAdapter, demoAdapter, idFor };
