const fs = require('fs');
const path = require('path');
const { generateToken, normalizePhoneNumber } = require('./common/auth');
const { queryKV } = require('./common/redis');

// --- Redis-Based Rate Limiting ---
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECS = 900; // 15 minutes

async function checkRateLimit(phone, queryKVFn) {
    try {
        const key = `rate_limit:pin:${phone}`;
        const count = await queryKVFn(['INCR', key]);
        if (count === 1) {
            // First attempt — set TTL for the window
            await queryKVFn(['EXPIRE', key, RATE_LIMIT_WINDOW_SECS]);
        }
        return count <= RATE_LIMIT_MAX;
    } catch (e) {
        // Fail open if Redis is down — don't block legitimate users
        return true;
    }
}

async function logAuthEvent(phone, method) {
    const timestamp = new Date().toISOString();
    const logEntry = { phone, method, timestamp };
    try {
        await queryKV(['LPUSH', 'auth_audit_logs', JSON.stringify(logEntry)]);
        await queryKV(['LTRIM', 'auth_audit_logs', 0, 999]);
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

    try {
        const { phone, pin } = req.body || {};

        if (!phone || !pin) {
            return res.status(400).json({ error: 'Phone number and PIN are required' });
        }

        const cleanPhone = normalizePhoneNumber(phone);

        // Rate limit check — 5 attempts per phone per 15-minute window
        const allowed = await checkRateLimit(cleanPhone, queryKV);
        if (!allowed) {
            return res.status(429).json({ error: 'Too many login attempts. Please wait 15 minutes before trying again.' });
        }

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
