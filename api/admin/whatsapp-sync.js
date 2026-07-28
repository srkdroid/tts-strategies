const crypto = require('crypto');

const SECRET = process.env.ADMIN_JWT_SECRET || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL ? 'TTS_STRATEGIES_ADMIN_SECURE_KEY_2026' : undefined);
if (!SECRET) {
    throw new Error("ADMIN_JWT_SECRET environment variable is missing");
}

function verifyAdminToken(token) {
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', SECRET);
        hmac.update(data);
        const expectedSignature = hmac.digest('hex');
        if (signature !== expectedSignature) return null;
        
        const { role, expires } = JSON.parse(data);
        if (role !== 'admin' || Date.now() > expires) return null;
        return true;
    } catch (e) {
        return null;
    }
}

function parseCookies(cookieHeader) {
    const list = {};
    if (!cookieHeader) return list;
    cookieHeader.split(';').forEach(cookie => {
        const parts = cookie.split('=');
        list[parts.shift().trim()] = decodeURI(parts.join('='));
    });
    return list;
}

async function queryKV(command) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    
    if (!url || !token) {
        throw new Error("KV_DATABASE_UNCONNECTED");
    }
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(command)
    });
    
    if (!response.ok) {
        throw new Error(`KV API returned ${response.status}: ${response.statusText}`);
    }
    
    const resJson = await response.json();
    return resJson.result;
}

function normalizePhoneDigits(raw) {
    if (!raw) return '';
    // Strip everything except digits
    return String(raw).replace(/\D/g, '');
}

function generateRandomPin() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const cookies = parseCookies(req.headers.cookie);
        const adminToken = cookies['admin_token'];
        
        if (!adminToken || !verifyAdminToken(adminToken)) {
            return res.status(401).json({ error: 'Unauthorized. Admin session required.' });
        }

        const { baseUrl, apiKey, sessionId, groupId } = req.body || {};

        if (!baseUrl || !sessionId || !groupId) {
            return res.status(400).json({ error: 'OpenWA Base URL, Session ID, and Group ID are required.' });
        }

        // Clean & normalize OpenWA URL
        let cleanBase = baseUrl.trim().replace(/\/+$/, '');
        if (!cleanBase.endsWith('/api')) {
            cleanBase += '/api';
        }

        const openwaUrl = `${cleanBase}/sessions/${encodeURIComponent(sessionId.trim())}/groups/${encodeURIComponent(groupId.trim())}`;

        // Call OpenWA REST API
        const headers = { 'Content-Type': 'application/json' };
        if (apiKey && apiKey.trim()) {
            headers['X-API-Key'] = apiKey.trim();
        }

        let openwaResponse;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        try {
            openwaResponse = await fetch(openwaUrl, { 
                method: 'GET', 
                headers,
                signal: controller.signal 
            });
        } catch (fetchErr) {
            clearTimeout(timeoutId);
            if (fetchErr.name === 'AbortError') {
                return res.status(504).json({ error: `Connection timed out after 15 seconds connecting to OpenWA VPS (${cleanBase}). Please verify your OpenWA session is connected.` });
            }
            return res.status(502).json({ error: `Failed to connect to OpenWA VPS at ${cleanBase}. Details: ${fetchErr.message}` });
        }
        clearTimeout(timeoutId);

        if (!openwaResponse.ok) {
            const errText = await openwaResponse.text().catch(() => '');
            let cleanErr = errText;
            if (openwaResponse.status === 504) {
                cleanErr = "504 Gateway Timeout — Nginx timed out waiting for OpenWA. Check if the session is connected and WhatsApp web is active.";
            } else if (openwaResponse.status === 502) {
                cleanErr = "502 Bad Gateway — OpenWA service on VPS is offline or restarting.";
            } else if (errText.includes('<html')) {
                cleanErr = errText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
            }
            return res.status(openwaResponse.status).json({ 
                error: `OpenWA Server Error (${openwaResponse.status}): ${cleanErr}` 
            });
        }

        const groupData = await openwaResponse.json();
        const participants = groupData.participants || [];

        if (!Array.isArray(participants)) {
            return res.status(400).json({ error: 'Invalid response from OpenWA: participants list missing' });
        }

        // Fetch current whitelist from Vercel KV
        let whitelistMap = {};
        const wlRes = await queryKV(['HGETALL', 'whitelist']);
        if (wlRes && Array.isArray(wlRes) && wlRes.length > 0) {
            for (let i = 0; i < wlRes.length; i += 2) {
                whitelistMap[wlRes[i]] = wlRes[i+1];
            }
        }

        // Build digit-only index of existing whitelist
        // Key: digits, Value: original phone string in whitelist
        const existingDigitsMap = {};
        Object.keys(whitelistMap).forEach(phone => {
            const digits = normalizePhoneDigits(phone);
            if (digits) {
                existingDigitsMap[digits] = phone;
            }
        });

        // Track participants from WhatsApp group
        const groupDigitsSet = new Set();
        const newlyAdded = [];
        let alreadySyncedCount = 0;

        for (const p of participants) {
            const rawNum = p.number || p.id || '';
            const digits = normalizePhoneDigits(rawNum);
            if (!digits) continue;

            groupDigitsSet.add(digits);
            const formattedPhone = '+' + digits;

            if (!existingDigitsMap[digits]) {
                // Not in whitelist -> Auto-add with random 6-digit PIN
                const pin = generateRandomPin();
                await queryKV(['HSET', 'whitelist', formattedPhone, pin]);
                
                // Record addition
                newlyAdded.push({ phone: formattedPhone, pin: pin, name: p.name || '' });
                existingDigitsMap[digits] = formattedPhone;
                whitelistMap[formattedPhone] = pin;
            } else {
                alreadySyncedCount++;
            }
        }

        // Find Whitelisted Users in app missing from the WhatsApp group
        const missingInGroup = [];
        Object.keys(whitelistMap).forEach(phone => {
            const digits = normalizePhoneDigits(phone);
            if (digits && !groupDigitsSet.has(digits)) {
                missingInGroup.push(phone);
            }
        });

        return res.status(200).json({
            success: true,
            groupName: groupData.name || groupId,
            totalParticipants: participants.length,
            alreadySyncedCount: alreadySyncedCount,
            newlyAddedCount: newlyAdded.length,
            newlyAdded: newlyAdded,
            missingInGroupCount: missingInGroup.length,
            missingInGroup: missingInGroup
        });

    } catch (error) {
        console.error('WhatsApp Sync Error:', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
};
