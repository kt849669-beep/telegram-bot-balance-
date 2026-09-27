'use strict';

function validMpin(value) {
    return typeof value === 'string' && /^\d{6}$/.test(value);
}

function extractCredentialsWithMpin(text, legacyExtract) {
    const source = String(text).replace(/\r\n?/g, '\n');
    const phones = [...source.matchAll(/\b\d{10}\b/g)];
    const found = [];
    const parsedPhones = new Set();
    for (let i = 0; i < phones.length; i++) {
        const match = phones[i];
        const phone = match[0];
        const block = source.slice(match.index + phone.length, phones[i + 1]?.index ?? source.length);
        const labelled = /\b(?:password|pass|pwd)\s*[:=\-]\s*([^\s|,;]{4,})/i.exec(block);
        let passwordMatch = labelled;
        if (!passwordMatch) {
            passwordMatch = /^[\s|,;:=-]*([^\s|,;]{4,})/.exec(block);
            if (passwordMatch && /^(?:m[\s-]*pin|pin|password|pass|pwd|phone|mobile|number)[:=-]?$/i.test(passwordMatch[1])) {
                passwordMatch = /\b(?:password|pass|pwd|pin)\s*[:=\-]\s*([^\s|,;]{4,})/i.exec(block);
            }
        }
        if (!passwordMatch || /^\d{10}$/.test(passwordMatch[1]) || /^(?:m[\s-]*pin)[:=-]?$/i.test(passwordMatch[1])) continue;
        const password = passwordMatch[1];
        const passwordStart = passwordMatch.index + passwordMatch[0].lastIndexOf(password);
        const remainder = block.slice(0, passwordStart) + ' '.repeat(password.length) + block.slice(passwordStart + password.length);
        const candidates = [...remainder.matchAll(/\b(?:m[\s-]*pin|pin)\s*[:=\-]?\s*(\d{6})\b/gi)].map(m => m[1]);
        // A PIN label used as the legacy password is not a second credential.
        if (!candidates.length && !/\b(?:m[\s-]*pin|pin)\b/i.test(remainder)) {
            const afterPassword = block.slice(passwordStart + password.length);
            const trailing = /^[\s|,;]+(\d{6})(?!\d)(?=\s|[|,;]|$)/.exec(afterPassword);
            if (trailing) candidates.push(trailing[1]);
        }
        const pins = [...new Set(candidates)];
        const entry = { phone, password };
        if (pins.length === 1) entry.mpin = pins[0];
        if (pins.length > 1) entry.mpinConflict = true;
        found.push(entry);
        parsedPhones.add(phone);
    }
    if (typeof legacyExtract === 'function') {
        for (const item of legacyExtract(source)) {
            if (!parsedPhones.has(item.phone) && !/^(?:m[\s-]*pin|password|pass|pwd)[:=-]?$/i.test(item.password)) found.push(item);
        }
    }
    const unique = new Map();
    for (const item of found) {
        const key = item.phone + '_' + item.password;
        const previous = unique.get(key);
        if (!previous) unique.set(key, item);
        else if (previous.mpinConflict || item.mpinConflict || (previous.mpin && item.mpin && previous.mpin !== item.mpin)) {
            delete previous.mpin;
            previous.mpinConflict = true;
        } else if (!previous.mpin && item.mpin) previous.mpin = item.mpin;
    }
    return [...unique.values()];
}

function preserveMpin(existing, incoming) {
    if (validMpin(incoming)) return { mpin: incoming };
    return existing && Object.prototype.hasOwnProperty.call(existing, 'mpin') ? { mpin: existing.mpin } : {};
}

function formatMpinLookup(wallets, sites) {
    const values = [...new Set(wallets.filter(w => validMpin(w.mpin)).map(w => w.mpin))];
    if (values.length === 0) return '🔢 *MPIN:*\n_Not saved_\n\n';
    if (values.length === 1 && wallets.every(w => validMpin(w.mpin))) return '🔢 *MPIN:*\n`' + values[0] + '`\n\n';
    return '🔢 *MPIN (site-wise):*\n' + wallets.map(w => (sites[w.siteId]?.name || w.siteId) + ': ' + (validMpin(w.mpin) ? '`' + w.mpin + '`' : '_Not saved_')).join('\n') + '\n\n';
}

async function readPdfText(buffer, Reader) {
    const PdfReader = Reader || require('pdfreader').PdfReader;
    // pdf2json reads the backing ArrayBuffer; give it an exact, unpooled copy.
    const pdfBuffer = Buffer.alloc(buffer.length);
    buffer.copy(pdfBuffer);
    return new Promise((resolve, reject) => {
        const pages = [];
        let rows = new Map();
        const finishPage = () => {
            if (rows.size) pages.push([...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, items]) => items.sort((a, b) => a.x - b.x).map(item => item.text).join(' ')).join('\n'));
            rows = new Map();
        };
        new PdfReader({ debug: false }).parseBuffer(pdfBuffer, (error, item) => {
            if (error) return reject(new Error('PDF text read nahi hua. Clear photo ya selectable-text PDF bhejein.'));
            if (!item) { finishPage(); return resolve(pages.join('\n\n')); }
            if (item.page) finishPage();
            else if (typeof item.text === 'string') {
                const y = Math.round(item.y * 10) / 10;
                if (!rows.has(y)) rows.set(y, []);
                rows.get(y).push({ x: item.x, text: item.text });
            }
        });
    });
}

module.exports = { validMpin, extractCredentialsWithMpin, preserveMpin, formatMpinLookup, readPdfText };
