const crypto = require('crypto');

const SECRET = process.env.ADMIN_JWT_SECRET || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL ? 'TTS_STRATEGIES_ADMIN_SECURE_KEY_2026' : undefined);
if (!SECRET) {
    throw new Error("ADMIN_JWT_SECRET environment variable is missing");
}

function verifyAdminToken(token) {
    if (!token) return false;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', SECRET);
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
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const cookies = parseCookies(req.headers.cookie);
        if (!verifyAdminToken(cookies['admin_token'])) {
            return res.status(401).json({ error: 'Unauthorized. Admin session required.' });
        }

        const rawLogs = await queryKV(['LRANGE', 'user_activity_logs', 0, 1999]) || [];
        const logs = [];

        for (const item of rawLogs) {
            try {
                if (typeof item === 'string') {
                    logs.push(JSON.parse(item));
                } else if (item && typeof item === 'object') {
                    logs.push(item);
                }
            } catch (e) {}
        }

        return res.status(200).json({
            success: true,
            totalLogs: logs.length,
            logs: logs
        });
    } catch (err) {
        console.error('Get Activity API error:', err);
        return res.status(500).json({ error: 'Failed to fetch activity logs' });
    }
};
