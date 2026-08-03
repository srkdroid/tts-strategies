const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// --- Rate Limiting ---
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key) {
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(key, { windowStart: now, count: 1 });
        return true; // allowed
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return false; // blocked
    }
    return true; // allowed
}

const SECRET = process.env.JWT_SECRET || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL ? 'TTS_STRATEGIES_SECURE_KEY_2026_JULY' : undefined);
if (!SECRET) {
    throw new Error("JWT_SECRET environment variable is missing");
}

function normalizePhoneNumber(phone) {
    if (!phone) return "";
    let cleaned = phone.replace(/[^\d+]/g, '');
    if (!cleaned.startsWith('+')) {
        if (cleaned.length === 10) {
            cleaned = '+91' + cleaned;
        } else {
            cleaned = '+' + cleaned;
        }
    }
    return cleaned;
}

function generateToken(phone) {
    const expires = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
    const data = JSON.stringify({ phone, expires });
    const hmac = crypto.createHmac('sha256', SECRET);
    hmac.update(data);
    const signature = hmac.digest('hex');
    return Buffer.from(JSON.stringify({ data, signature })).toString('base64');
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
        throw new Error(`KV API returned ${response.status}`);
    }
    
    const resJson = await response.json();
    return resJson.result;
}

async function logAuthEvent(phone, method) {
    const timestamp = new Date().toISOString();
    const logEntry = { phone, method, timestamp };
    try {
        await queryKV(['LPUSH', 'auth_audit_logs', JSON.stringify(logEntry)]);
        await queryKV(['LTRIM', 'auth_audit_logs', '0', '999']);
    } catch (e) {
        console.warn('Auth audit log write failed (KV offline):', e.message);
    }
}

// Check PIN against whitelist
async function getStoredPin(phone) {
    try {
        const pin = await queryKV(['HGET', 'whitelist', phone]);
        if (pin) return pin;
        
        // If whitelist is not in database, check local file
        const whitelistPath = path.join(process.cwd(), 'whitelist.json');
        if (fs.existsSync(whitelistPath)) {
            const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
            return whitelist[phone] || null;
        }
        return null;
    } catch (e) {
        // Fallback to local files if database is unconnected/offline
        const whitelistPath = path.join(process.cwd(), 'whitelist.json');
        if (fs.existsSync(whitelistPath)) {
            const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
            return whitelist[phone] || null;
        }
        return null;
    }
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    // Rate limit by IP
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (!checkRateLimit(`pin:${clientIp}`)) {
        return res.status(429).json({ error: 'Too many login attempts. Please try again in 15 minutes.' });
    }

    try {
        const { phone, pin } = req.body || {};

        if (!phone || !pin) {
            return res.status(400).json({ error: 'Phone number and PIN are required' });
        }

        const cleanPhone = normalizePhoneNumber(phone);
        const storedPin = await getStoredPin(cleanPhone);

        if (!storedPin) {
            return res.status(401).json({ error: 'Phone number not registered. Access denied.' });
        }

        if (storedPin !== pin.trim()) {
            return res.status(401).json({ error: 'Invalid PIN. Access denied.' });
        }

        // Generate secure JWT-like session token
        const sessionCookie = generateToken(cleanPhone);
        
        // Log successful login
        await logAuthEvent(cleanPhone, 'pin');

        res.setHeader('Set-Cookie', [
            `session_token=${sessionCookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 60 * 60}`
        ]);

        return res.status(200).json({ success: true, message: 'Login successful' });

    } catch (error) {
        console.error('PIN Auth error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
