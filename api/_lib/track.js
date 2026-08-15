const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
    throw new Error("JWT_SECRET environment variable is missing");
}

const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET;
if (!ADMIN_SECRET) {
    throw new Error("ADMIN_JWT_SECRET environment variable is missing");
}

function verifyToken(token) {
    if (!token) return null;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', SECRET);
        hmac.update(data);
        if (signature !== hmac.digest('hex')) return null;
        
        const { phone, expires } = JSON.parse(data);
        if (!expires || Date.now() > expires) return null;
        return phone;
    } catch (e) {
        return null;
    }
}

function verifyAdminToken(token) {
    if (!token) return false;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', ADMIN_SECRET);
        hmac.update(data);
        if (signature !== hmac.digest('hex')) return false;
        
        const parsed = JSON.parse(data);
        return parsed.role === 'admin' && parsed.expires && parsed.expires > Date.now();
    } catch (e) {
        return false;
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
    if (!url || !token) return null;

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(command)
        });
        if (!response.ok) return null;
        const resJson = await response.json();
        return resJson.result;
    } catch (e) {
        return null;
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const cookies = parseCookies(req.headers.cookie);
        const phone = verifyToken(cookies['session_token']);
        const isAdmin = verifyAdminToken(cookies['admin_token']);

        if (isAdmin || !phone || phone === 'Admin' || (phone && phone.toLowerCase() === 'admin')) {
            // Admin activity logging is not required
            return res.status(200).json({ success: true, skipped: true });
        }

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }
        body = body || {};

        const eventType = body.eventType || 'PAGE_VIEW';
        const details = body.details || '';
        const meta = body.meta || {};

        const logEntry = {
            id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            phone: phone,
            eventType: eventType,
            details: details,
            meta: meta,
            timestamp: new Date().toISOString()
        };

        const logStr = JSON.stringify(logEntry);

        // Store in Upstash Redis List user_activity_logs (capped at 2000 entries)
        await queryKV(['LPUSH', 'user_activity_logs', logStr]);
        await queryKV(['LTRIM', 'user_activity_logs', 0, 1999]);

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Tracking API error:', err);
        return res.status(500).json({ error: 'Failed to record tracking event' });
    }
};
