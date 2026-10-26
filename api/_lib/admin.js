const fs = require('fs');
const path = require('path');
const { verifyAdminToken, generateAdminToken, parseCookies } = require('./common/auth');
const { queryKV } = require('./common/redis');
const { getUpstoxConfig, saveUpstoxConfig, maskToken, testUpstoxConnection } = require('./upstox');

const ADMIN_PASS = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASS) {
    throw new Error("ADMIN_PASSWORD environment variable is missing");
}

function normalizePhoneDigits(raw) {
    if (!raw) return '';
    if (typeof raw === 'object') {
        if (raw.user) return String(raw.user).replace(/\D/g, '');
        if (raw.number) return String(raw.number).replace(/\D/g, '');
        if (raw._serialized) return String(raw._serialized).replace(/\D/g, '');
        if (raw.id) return normalizePhoneDigits(raw.id);
    }
    return String(raw).replace(/\D/g, '');
}

function generateRandomPin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = async (req, res) => {
    try {
        let body = req.body || {};
        if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e){} }

        let action = (req.query && req.query.action) ? req.query.action : '';
        if (!action || action === 'admin' || action === 'index.js') {
            if (body && body.action) {
                action = body.action;
            } else if (req.url) {
                const urlPath = req.url.split('?')[0];
                const lastSegment = urlPath.split('/').filter(Boolean).pop() || '';
                if (lastSegment && lastSegment !== 'admin' && lastSegment !== 'index.js') {
                    action = lastSegment;
                }
            }
        }

        // 1. ADMIN LOGIN
        if (action === 'login') {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
            let body = req.body || {};
            if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e){} }
            const { password } = body;
            if (!password) return res.status(400).json({ error: 'Password is required' });

            if (password === ADMIN_PASS) {
                const token = generateAdminToken();
                res.setHeader('Set-Cookie', [
                    `admin_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`
                ]);
                return res.status(200).json({ success: true, message: 'Admin login successful' });
            } else {
                return res.status(401).json({ error: 'Invalid admin password' });
            }
        }

        // 2. ADMIN LOGOUT
        if (action === 'logout') {
            res.setHeader('Set-Cookie', [
                'admin_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; HttpOnly; Secure; SameSite=Strict'
            ]);
            return res.status(200).json({ success: true, message: 'Admin logged out successfully' });
        }

        // All remaining actions require admin authorization
        const cookies = parseCookies(req.headers.cookie);
        if (!verifyAdminToken(cookies['admin_token'])) {
            return res.status(401).json({ error: 'Unauthorized. Admin session required.' });
        }

        // 3. ADMIN GET DATA
        if (action === 'get') {
            let whitelist = {};
            let permissions = {};
            let auditLogs = [];
            let strategies = null;
            let holidays = null;

            try {
                const wlRes = await queryKV(['HGETALL', 'whitelist']);
                if (wlRes && Array.isArray(wlRes) && wlRes.length > 0) {
                    for (let i = 0; i < wlRes.length; i += 2) {
                        whitelist[wlRes[i]] = wlRes[i+1];
                    }
                }
            } catch (e) {}

            try {
                const permRes = await queryKV(['HGETALL', 'user_permissions']);
                if (permRes && Array.isArray(permRes) && permRes.length > 0) {
                    for (let i = 0; i < permRes.length; i += 2) {
                        try { permissions[permRes[i]] = JSON.parse(permRes[i+1]); } catch(err){}
                    }
                }
            } catch (e) {}

            try {
                const stratRes = await queryKV(['GET', 'strategies']);
                if (stratRes) { try { strategies = JSON.parse(stratRes); } catch(err){} }
            } catch (e) {}

            try {
                const holRes = await queryKV(['GET', 'holidays']);
                if (holRes) { try { holidays = JSON.parse(holRes); } catch(err){} }
            } catch (e) {}

            try {
                const logsRes = await queryKV(['LRANGE', 'auth_audit_logs', 0, 999]);
                if (logsRes && Array.isArray(logsRes)) {
                    auditLogs = logsRes.map(l => { try { return JSON.parse(l); } catch(err) { return null; } }).filter(Boolean);
                }
            } catch (e) {}

            let dispatch_settings = null;
            try {
                const dsRes = await queryKV(['GET', 'dispatch_settings']);
                if (dsRes) { try { dispatch_settings = JSON.parse(dsRes); } catch(err){} }
            } catch (e) {}

            let adminOnlyMode = false;
            try {
                const aomRes = await queryKV(['GET', 'system:admin_only_mode']);
                adminOnlyMode = aomRes === 'true' || aomRes === '1';
            } catch (e) {}

            let upstox_config = null;
            try {
                const uCfg = await getUpstoxConfig();
                upstox_config = {
                    hasToken: Boolean(uCfg.token),
                    tokenMasked: maskToken(uCfg.token),
                    pollInterval: uCfg.pollInterval || 60,
                    telegramAlertsEnabled: uCfg.telegramAlertsEnabled !== false,
                    marketHoursOnly: uCfg.marketHoursOnly !== false,
                    updatedAt: uCfg.updatedAt
                };
            } catch (e) {}

            return res.status(200).json({
                success: true,
                adminOnlyMode,
                whitelist,
                permissions,
                auditLogs,
                strategies,
                holidays,
                dispatch_settings,
                upstox_config
            });
        }

        // 4. ADMIN SAVE DATA
        if (action === 'save') {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
            let body = req.body || {};
            if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e){} }
            const { type, data } = body;
            const saveType = type || body.action;

            if (saveType === 'save_upstox_config') {
                const saved = await saveUpstoxConfig(data || {});
                return res.status(200).json({
                    success: true,
                    message: 'Upstox configuration saved successfully',
                    upstox_config: {
                        hasToken: Boolean(saved.token),
                        tokenMasked: maskToken(saved.token),
                        pollInterval: saved.pollInterval,
                        telegramAlertsEnabled: saved.telegramAlertsEnabled,
                        marketHoursOnly: saved.marketHoursOnly,
                        updatedAt: saved.updatedAt
                    }
                });
            }

            if (saveType === 'test_upstox_token') {
                const candidateToken = data && data.token ? data.token : null;
                const testRes = await testUpstoxConnection(candidateToken);
                return res.status(200).json(testRes);
            }

            if (saveType === 'save_admin_only_mode' || saveType === 'admin_only_mode') {
                const isEnabled = Boolean(data && data.enabled);
                await queryKV(['SET', 'system:admin_only_mode', isEnabled ? 'true' : 'false']);
                return res.status(200).json({
                    success: true,
                    adminOnlyMode: isEnabled,
                    message: `Admin-only access mode ${isEnabled ? 'enabled' : 'disabled'}`
                });
            }

            if (saveType === 'clear_logs' || saveType === 'clear_auth_logs') {
                await queryKV(['DEL', 'auth_audit_logs']);
                return res.status(200).json({ success: true, message: 'Auth audit logs cleared' });
            }

            if (saveType === 'save_note' || saveType === 'notes') {
                let notesList = [];
                const kvNotes = await queryKV(['GET', 'notes']);
                if (kvNotes) {
                    try { notesList = JSON.parse(kvNotes); } catch(e){}
                }
                const notePayload = {
                    ...data,
                    isAdminOnly: Boolean(data.isAdminOnly)
                };
                if (!notePayload || !notePayload.id) return res.status(400).json({ error: 'Missing note payload' });

                const idx = notesList.findIndex(n => n && n.id === notePayload.id);
                if (idx >= 0) {
                    notesList[idx] = notePayload;
                } else {
                    notesList.unshift(notePayload);
                }
                await queryKV(['SET', 'notes', JSON.stringify(notesList)]);
                return res.status(200).json({ success: true, message: 'Note saved' });
            }

            if (saveType === 'delete_note') {
                let notesList = [];
                const kvNotes = await queryKV(['GET', 'notes']);
                if (kvNotes) {
                    try { notesList = JSON.parse(kvNotes); } catch(e){}
                }
                if (Array.isArray(notesList)) {
                    notesList = notesList.filter(n => n && n.id !== (data ? data.id : null));
                    await queryKV(['SET', 'notes', JSON.stringify(notesList)]);
                }
                return res.status(200).json({ success: true, message: 'Note deleted' });
            }

            if (saveType === 'save_dispatch_settings' || saveType === 'dispatch_settings') {
                await queryKV(['SET', 'dispatch_settings', JSON.stringify(data)]);
                return res.status(200).json({ success: true, message: 'Dispatch settings saved' });
            }

            if (saveType === 'save_user' || saveType === 'whitelist') {
                if (data && data.phone && data.pin) {
                    await queryKV(['HSET', 'whitelist', data.phone, String(data.pin)]);
                } else if (data && typeof data === 'object') {
                    const entries = Object.entries(data);
                    if (entries.length > 0) {
                        const hsetArgs = ['HSET', 'whitelist'];
                        entries.forEach(([phone, pin]) => {
                            hsetArgs.push(phone, String(pin));
                        });
                        await queryKV(['DEL', 'whitelist']);
                        await queryKV(hsetArgs);
                    } else {
                        await queryKV(['DEL', 'whitelist']);
                    }
                }
                return res.status(200).json({ success: true, message: 'User/whitelist saved' });
            }

            if (saveType === 'delete_user') {
                if (data && data.phone) {
                    await queryKV(['HDEL', 'whitelist', data.phone]);
                    await queryKV(['HDEL', 'user_permissions', data.phone]);
                }
                return res.status(200).json({ success: true, message: 'User deleted' });
            }

            if (saveType === 'sync_whitelist') {
                await queryKV(['DEL', 'whitelist']);
                await queryKV(['DEL', 'user_permissions']);
                return res.status(200).json({ success: true, message: 'Whitelist reset to codebase defaults' });
            }

            if (saveType === 'save_user_permissions' || saveType === 'user_permissions') {
                if (data && data.phone && data.permissions) {
                    await queryKV(['HSET', 'user_permissions', data.phone, JSON.stringify(data.permissions)]);
                } else if (data && typeof data === 'object') {
                    for (const [phone, flags] of Object.entries(data)) {
                        await queryKV(['HSET', 'user_permissions', phone, JSON.stringify(flags)]);
                    }
                }
                return res.status(200).json({ success: true, message: 'Permissions saved' });
            }

            if (saveType === 'bulk_update_user_permissions') {
                const feature = data && data.feature;
                const isEnabled = data ? (typeof data.enabled === 'boolean' ? data.enabled : (typeof data.enable === 'boolean' ? data.enable : null)) : null;

                if (!feature || isEnabled === null) {
                    return res.status(400).json({ error: 'Invalid feature or enabled flag' });
                }

                let whitelistMap = {};
                const wlRes = await queryKV(['HGETALL', 'whitelist']);
                if (wlRes && Array.isArray(wlRes) && wlRes.length > 0) {
                    for (let i = 0; i < wlRes.length; i += 2) { whitelistMap[wlRes[i]] = wlRes[i+1]; }
                }

                let currentPerms = {};
                const permRes = await queryKV(['HGETALL', 'user_permissions']);
                if (permRes && Array.isArray(permRes) && permRes.length > 0) {
                    for (let i = 0; i < permRes.length; i += 2) {
                        try { currentPerms[permRes[i]] = JSON.parse(permRes[i+1]); } catch(err){}
                    }
                }

                const updatedPerms = {};
                const phones = Object.keys(whitelistMap);
                for (const phone of phones) {
                    const userPerm = currentPerms[phone] || { catalog: false, journal: false };
                    if (feature === 'all') {
                        userPerm.catalog = isEnabled;
                        userPerm.journal = isEnabled;
                    } else {
                        userPerm[feature] = isEnabled;
                    }
                    updatedPerms[phone] = userPerm;
                    await queryKV(['HSET', 'user_permissions', phone, JSON.stringify(userPerm)]);
                }

                return res.status(200).json({ 
                    success: true, 
                    count: phones.length,
                    message: `Bulk updated ${feature} permission for ${phones.length} users`, 
                    permissions: updatedPerms 
                });
            }

            if (saveType === 'save_strategies' || saveType === 'strategies') {
                await queryKV(['SET', 'strategies', JSON.stringify(data)]);
                return res.status(200).json({ success: true, message: 'Strategies saved' });
            }

            if (saveType === 'sync_strategies') {
                await queryKV(['DEL', 'strategies']);
                return res.status(200).json({ success: true, message: 'Strategies reset to codebase defaults' });
            }

            if (saveType === 'save_holidays' || saveType === 'holidays') {
                await queryKV(['SET', 'holidays', JSON.stringify(data)]);
                return res.status(200).json({ success: true, message: 'Holidays saved' });
            }

            if (saveType === 'sync_holidays') {
                await queryKV(['DEL', 'holidays']);
                return res.status(200).json({ success: true, message: 'Holidays reset to codebase defaults' });
            }

            return res.status(400).json({ error: 'Unknown save type' });
        }

        // 5. WHATSAPP SYNC
        if (action === 'whatsapp-sync') {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
            let body = req.body || {};
            const { baseUrl, apiKey, sessionId, groupId } = body;
            if (!baseUrl || !sessionId || !groupId) return res.status(400).json({ error: 'Missing OpenWA credentials' });

            let parsedUrl;
            try {
                parsedUrl = new URL(baseUrl.trim());
            } catch(e) {
                return res.status(400).json({ error: 'Invalid OpenWA baseUrl URL format' });
            }
            if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
                return res.status(400).json({ error: 'OpenWA baseUrl must use HTTP or HTTPS protocol' });
            }
            const hostname = parsedUrl.hostname.toLowerCase();
            const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '169.254.169.254', '[::1]', '::1'];
            const isPrivateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(hostname);
            if (blockedHosts.includes(hostname) || isPrivateIp || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
                return res.status(400).json({ error: 'SSRF Protection: Access to private/loopback/internal network endpoints is prohibited' });
            }

            let cleanBase = baseUrl.trim().replace(/\/+$/, '');
            if (!cleanBase.endsWith('/api')) cleanBase += '/api';
            const openwaUrl = `${cleanBase}/sessions/${encodeURIComponent(sessionId.trim())}/groups/${encodeURIComponent(groupId.trim())}`;
            const headers = { 'Content-Type': 'application/json' };
            if (apiKey && apiKey.trim()) headers['X-API-Key'] = apiKey.trim();

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 15000);
            let openwaResponse;

            try {
                openwaResponse = await fetch(openwaUrl, { method: 'GET', headers, signal: controller.signal });
            } catch (fetchErr) {
                clearTimeout(timeoutId);
                return res.status(502).json({ error: `Connection failed: ${fetchErr.message}` });
            }
            clearTimeout(timeoutId);

            if (!openwaResponse.ok) return res.status(openwaResponse.status).json({ error: `OpenWA error ${openwaResponse.status}` });

            const groupData = await openwaResponse.json();
            const participants = groupData.participants || (groupData.groupMetadata && groupData.groupMetadata.participants) || groupData.members || (Array.isArray(groupData) ? groupData : []);

            let whitelistMap = {};
            const wlRes = await queryKV(['HGETALL', 'whitelist']);
            if (wlRes && Array.isArray(wlRes) && wlRes.length > 0) {
                for (let i = 0; i < wlRes.length; i += 2) whitelistMap[wlRes[i]] = wlRes[i+1];
            }

            const existingDigitsMap = {};
            const existing10DigitMap = {};
            Object.keys(whitelistMap).forEach(phone => {
                const digits = normalizePhoneDigits(phone);
                if (digits) {
                    existingDigitsMap[digits] = phone;
                    if (digits.length >= 10) existing10DigitMap[digits.slice(-10)] = phone;
                }
            });

            const groupDigitsSet = new Set();
            const newlyAdded = [];
            let alreadySyncedCount = 0;

            for (const p of participants) {
                let rawNum = '';
                let participantName = '';
                if (typeof p === 'string') rawNum = p;
                else if (p && typeof p === 'object') {
                    participantName = p.name || p.pushname || p.formattedName || p.shortName || '';
                    rawNum = p.number || p.user || p.phone || (typeof p.id === 'string' ? p.id : (p.id ? (p.id.user || p.id._serialized) : '')) || '';
                }

                let digits = normalizePhoneDigits(rawNum);
                if (!digits) continue;
                if (digits.length === 10) digits = '91' + digits;

                const suffix10 = digits.length >= 10 ? digits.slice(-10) : digits;
                groupDigitsSet.add(digits);
                groupDigitsSet.add(suffix10);

                const existingPhone = existingDigitsMap[digits] || (digits.length >= 10 ? existing10DigitMap[suffix10] : null);
                const formattedPhone = '+' + digits;

                if (!existingPhone) {
                    const pin = generateRandomPin();
                    await queryKV(['HSET', 'whitelist', formattedPhone, pin]);
                    newlyAdded.push({ phone: formattedPhone, pin, name: participantName });
                    existingDigitsMap[digits] = formattedPhone;
                    if (suffix10) existing10DigitMap[suffix10] = formattedPhone;
                    whitelistMap[formattedPhone] = pin;
                } else {
                    alreadySyncedCount++;
                }
            }

            const missingInGroup = [];
            Object.keys(whitelistMap).forEach(phone => {
                const digits = normalizePhoneDigits(phone);
                const suffix10 = digits.length >= 10 ? digits.slice(-10) : digits;
                if (digits && !groupDigitsSet.has(digits) && !groupDigitsSet.has(suffix10)) {
                    missingInGroup.push(phone);
                }
            });

            return res.status(200).json({
                success: true,
                groupName: groupData.name || groupId,
                totalParticipants: participants.length,
                alreadySyncedCount,
                newlyAddedCount: newlyAdded.length,
                newlyAdded,
                missingInGroupCount: missingInGroup.length,
                missingInGroup
            });
        }

        // 6. GET ACTIVITY LOGS
        if (action === 'get-activity') {
            const rawLogs = await queryKV(['LRANGE', 'user_activity_logs', 0, 1999]) || [];
            const logs = [];
            for (const item of rawLogs) {
                try {
                    if (typeof item === 'string') logs.push(JSON.parse(item));
                    else if (item && typeof item === 'object') logs.push(item);
                } catch(e){}
            }
            return res.status(200).json({ success: true, totalLogs: logs.length, logs });
        }

        // 7. CLEAR ACTIVITY LOGS
        if (action === 'clear-activity') {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
            await queryKV(['DEL', 'user_activity_logs']);
            return res.status(200).json({ success: true, message: 'Activity logs cleared' });
        }

        return res.status(400).json({ error: 'Unknown admin action' });
    } catch (err) {
        console.error('Admin API error:', err);
        return res.status(500).json({ error: err.message || 'Internal Server Error' });
    }
};
