const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateToken, normalizePhoneNumber } = require('./common/auth');
const { queryKV } = require('./common/redis');

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
                return res.writeHead(302, {
                    Location: '/index.html',
                    'Set-Cookie': `session_token=${sessionCookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`
                }).end();
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

            // Check if System Admin-Only (Maintenance) Mode is active
            let adminOnlyMode = false;
            try {
                const aomRes = await queryKV(['GET', 'system:admin_only_mode']);
                adminOnlyMode = aomRes === 'true' || aomRes === '1';
            } catch (e) {}

            if (adminOnlyMode) {
                return res.status(503).json({
                    error: 'System Under Maintenance',
                    maintenance: true,
                    adminOnlyMode: true,
                    message: 'TTS Strategies is temporarily restricted to administrators for scheduled maintenance. Please check back shortly.'
                });
            }

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
            const token = crypto.randomInt(100000, 1000000).toString();

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
