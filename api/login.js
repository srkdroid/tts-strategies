const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

async function logAuthEvent(phone, method) {
    const timestamp = new Date().toISOString();
    const logEntry = { phone, method, timestamp };
    try {
        await queryKV(['LPUSH', 'auth_audit_logs', JSON.stringify(logEntry)]);
        await queryKV(['LTRIM', 'auth_audit_logs', '0', '999']);
    } catch (e) {
        const logsPath = path.join(process.cwd(), 'auth_logs.json');
        let logs = [];
        if (fs.existsSync(logsPath)) {
            try {
                logs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
            } catch (err) {}
        }
        logs.unshift(logEntry);
        if (logs.length > 100) logs = logs.slice(0, 100);
        fs.writeFileSync(logsPath, JSON.stringify(logs, null, 4), 'utf8');
    }
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

// Check if a phone number is whitelisted
async function isWhitelisted(phone) {
    try {
        const pin = await queryKV(['HGET', 'whitelist', phone]);
        if (pin) return true;
        
        // If whitelist hash is empty, check length to trigger auto-migration
        const size = await queryKV(['HLEN', 'whitelist']);
        if (size === 0 || !size) {
            // Trigger auto-migration
            const whitelistPath = path.join(process.cwd(), 'whitelist.json');
            if (fs.existsSync(whitelistPath)) {
                const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
                const hmsetCmd = ["HMSET", "whitelist"];
                Object.entries(whitelist).forEach(([k, v]) => {
                    hmsetCmd.push(k, v);
                });
                await queryKV(hmsetCmd);
                return whitelist[phone] !== undefined;
            }
        }
        return false;
    } catch (e) {
        // Fallback to local files if database is not connected
        const whitelistPath = path.join(process.cwd(), 'whitelist.json');
        if (fs.existsSync(whitelistPath)) {
            const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
            return whitelist[phone] !== undefined;
        }
        return false;
    }
}

module.exports = async (req, res) => {
    // 1. Polling verification check (GET /api/login?check=token)
    if (req.method === 'GET') {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const token = url.searchParams.get('check');
        const completeToken = url.searchParams.get('complete');

        // --- Complete login: set cookie via browser navigation + 302 redirect ---
        if (completeToken) {
            try {
                let sessionStr = null;
                try {
                    sessionStr = await queryKV(['GET', `auth_token:${completeToken}`]);
                } catch (err) {
                    return res.writeHead(302, { Location: '/login.html' }).end();
                }
                if (!sessionStr) {
                    return res.writeHead(302, { Location: '/login.html' }).end();
                }
                const session = JSON.parse(sessionStr);
                if (!session.verified) {
                    return res.writeHead(302, { Location: '/login.html' }).end();
                }
                const sessionCookie = generateToken(session.phone);
                try { await logAuthEvent(session.phone, 'telegram'); } catch(e) {}
                res.setHeader('Set-Cookie', [
                    `session_token=${sessionCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
                ]);
                return res.writeHead(302, { Location: '/index.html' }).end();
            } catch (error) {
                console.error('Complete login error:', error);
                return res.writeHead(302, { Location: '/login.html' }).end();
            }
        }

        // --- Polling check: just returns verified status, no cookie ---
        if (!token) {
            return res.status(400).json({ error: 'Token is required for verification check' });
        }

        try {
            let sessionStr = null;
            try {
                sessionStr = await queryKV(['GET', `auth_token:${token}`]);
            } catch (err) {
                // If KV unconnected, check local memory/mock (which shouldn't happen unless simulated)
                return res.status(200).json({ verified: false, error: 'Database unconnected' });
            }

            if (!sessionStr) {
                return res.status(400).json({ error: 'Token expired or invalid' });
            }

            const session = JSON.parse(sessionStr);

            if (session.verified) {
                // Don't set cookie here — Set-Cookie from fetch() responses is unreliable.
                // The client will redirect to /api/login?complete=token which sets the
                // cookie via a proper 302 redirect (browser navigation).
                return res.status(200).json({ success: true, verified: true });
            }

            return res.status(200).json({ success: true, verified: false });

        } catch (error) {
            console.error('Polling error:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    // 2. Auth request initiating (POST /api/login)
    if (req.method === 'POST') {
        try {
            const { phone, simulate_local } = req.body || {};

            if (!phone) {
                return res.status(400).json({ error: 'Phone number is required' });
            }

            const cleanPhone = normalizePhoneNumber(phone);
            const whitelisted = await isWhitelisted(cleanPhone);

            if (!whitelisted) {
                return res.status(401).json({ error: 'Phone number not registered. Access denied.' });
            }

            // A. Local simulation bypass for local offline testing (disabled in production)
            if (simulate_local) {
                const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
                if (isProduction) {
                    return res.status(403).json({ error: 'Local simulation bypass is disabled in production.' });
                }
                const sessionCookie = generateToken(cleanPhone);
                await logAuthEvent(cleanPhone, 'telegram');
                res.setHeader('Set-Cookie', [
                    `session_token=${sessionCookie}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${30 * 24 * 60 * 60}`
                ]);
                return res.status(200).json({ success: true, message: 'Local simulation successful' });
            }

            // B. Standard production flow: generate Telegram OTP token
            // Generate a secure 6-digit random token
            const token = Math.floor(100000 + Math.random() * 900000).toString();

            const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'TTSStrategiesBot';

            try {
                // Save in Vercel KV with 5 minutes (300s) TTL
                await queryKV(['SET', `auth_token:${token}`, JSON.stringify({ phone: cleanPhone, verified: false }), 'EX', '300']);
            } catch (err) {
                // If database unconnected, tell client to run local simulation bypass
                return res.status(200).json({ 
                    success: true, 
                    token, 
                    local_simulation_required: true,
                    botUsername,
                    message: 'Database unconnected. Local simulation button is available.' 
                });
            }

            return res.status(200).json({ success: true, token, botUsername });

        } catch (error) {
            console.error('Auth request error:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    res.setHeader('Allow', ['POST', 'GET']);
    return res.status(405).json({ error: 'Method Not Allowed' });
};
