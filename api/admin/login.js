const crypto = require('crypto');

// --- Rate Limiting ---
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 15;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(key, { windowStart: now, count: 1 });
        return true;
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return false;
    }
    return true;
}

const SECRET = process.env.ADMIN_JWT_SECRET || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL ? 'TTS_STRATEGIES_ADMIN_SECURE_KEY_2026' : undefined);
if (!SECRET) {
    throw new Error("ADMIN_JWT_SECRET environment variable is missing");
}
const ADMIN_PASS = process.env.ADMIN_PASSWORD || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL ? 'admin123' : undefined);
if (!ADMIN_PASS) {
    throw new Error("ADMIN_PASSWORD environment variable is missing");
}

function generateAdminToken() {
    const expires = Date.now() + 2 * 60 * 60 * 1000; // 2 hours admin session
    const data = JSON.stringify({ role: 'admin', expires });
    const hmac = crypto.createHmac('sha256', SECRET);
    hmac.update(data);
    const signature = hmac.digest('hex');
    return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
}

module.exports = (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(455).json({ error: 'Method Not Allowed' });
    }

    try {
        const { password } = req.body || {};
        
        if (!password) {
            return res.status(400).json({ error: 'Password is required' });
        }

        if (password === ADMIN_PASS) {
            const token = generateAdminToken();
            
            // Set secure, short-lived HTTP-only admin cookie
            res.setHeader('Set-Cookie', [
                `admin_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`
            ]);
            
            return res.status(200).json({ success: true, message: 'Admin login successful' });
        } else {
            return res.status(401).json({ error: 'Invalid admin password' });
        }
    } catch (error) {
        console.error('Admin login error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
