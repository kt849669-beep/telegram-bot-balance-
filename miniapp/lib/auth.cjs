'use strict';
const crypto = require('node:crypto');
function validateTelegram(data, token, allowed, now = Date.now()) {
  if (typeof data !== 'string' || data.length > 12000) return null;
  const params = new URLSearchParams(data);
  if (new Set(params.keys()).size !== [...params.keys()].length) return null;
  const hash = params.get('hash') || '';
  if (!/^[a-f0-9]{64}$/i.test(hash)) return null;
  const age = now / 1000 - Number(params.get('auth_date'));
  if (!Number.isFinite(age) || age < -30 || age > 300) return null;
  params.delete('hash');
  const check = [...params].sort(([a],[b])=>a < b ? -1 : a > b ? 1 : 0).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256','WebAppData').update(token).digest();
  const expected = crypto.createHmac('sha256',secret).update(check).digest();
  if (!crypto.timingSafeEqual(expected,Buffer.from(hash,'hex'))) return null;
  try { const user = JSON.parse(params.get('user')); return Number.isSafeInteger(user.id) && user.id > 0 && allowed.includes(user.id) ? {id:String(user.id)} : null; } catch { return null; }
}
module.exports = {validateTelegram};
