const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET = 'TTS_STRATEGIES_SECURE_KEY_2026_JULY';

function verifyToken(token) {
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', SECRET);
        hmac.update(data);
        const expectedSignature = hmac.digest('hex');
        if (signature !== expectedSignature) return null;
        
        const { phone, expires } = JSON.parse(data);
        if (Date.now() > expires) return null; // Expired
        return phone;
    } catch (e) {
        return null;
    }
}

const ADMIN_SECRET = 'TTS_STRATEGIES_ADMIN_SECURE_KEY_2026';
function verifyAdminToken(token) {
    if (!token) return false;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        const { data, signature } = decoded;
        
        const hmac = crypto.createHmac('sha256', ADMIN_SECRET);
        hmac.update(data);
        const expectedSignature = hmac.digest('hex');
        if (signature !== expectedSignature) return false;
        
        const parsed = JSON.parse(data);
        if (parsed.expires < Date.now()) return false;
        return parsed.role === 'admin';
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

async function runStrategiesMigration() {
    try {
        const strategiesPath = path.join(process.cwd(), 'strategies.js');
        if (fs.existsSync(strategiesPath)) {
            const content = fs.readFileSync(strategiesPath, 'utf8');
            const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*?\])\s*;?/);
            if (match) {
                await queryKV(['SET', 'strategies', match[1]]);
                console.log("Migration: strategies.js imported to Vercel KV");
                return JSON.parse(match[1]);
            }
        }
    } catch (e) {
        console.error("Strategies migration failed:", e);
    }
    return null;
}

async function runHolidaysMigration() {
    try {
        const holPath = path.join(process.cwd(), 'holidays.js');
        if (fs.existsSync(holPath)) {
            const content = fs.readFileSync(holPath, 'utf8');
            const match = content.match(/(?:const|let)\s+marketHolidays2026\s*=\s*(\{[\s\S]*?\});/);
            if (match) {
                await queryKV(['SET', 'holidays', match[1]]);
                console.log("Migration: holidays.js imported to Vercel KV");
                return JSON.parse(match[1]);
            }
        }
    } catch (e) {
        console.error("Holidays migration failed:", e);
    }
    return null;
}

module.exports = async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies['session_token'];
        const adminToken = cookies['admin_token'];
        
        const userPhone = token ? verifyToken(token) : null;
        const isAdmin = verifyAdminToken(adminToken);
        
        if (!userPhone && !isAdmin) {
            return res.status(401).json({ error: 'Unauthorized. Please login first.' });
        }

        let strategiesData = null;
        let holidaysData = null;

        try {
            // Fetch strategies from KV
            const stratRes = await queryKV(['GET', 'strategies']);
            if (stratRes) {
                strategiesData = JSON.parse(stratRes);
            } else {
                strategiesData = await runStrategiesMigration();
            }

            // Fetch holidays from KV
            const holRes = await queryKV(['GET', 'holidays']);
            if (holRes) {
                holidaysData = JSON.parse(holRes);
            } else {
                holidaysData = await runHolidaysMigration();
            }
        } catch (dbErr) {
            // Fallback to local files if database is not connected
            console.warn("DB connection failed, using local file fallbacks:", dbErr.message);
        }

        // If fallbacks needed because DB is offline/unconnected
        if (!strategiesData) {
            const strategiesPath = path.join(process.cwd(), 'strategies.js');
            if (fs.existsSync(strategiesPath)) {
                const content = fs.readFileSync(strategiesPath, 'utf8');
                const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*?\])\s*;?/);
                if (match) {
                    strategiesData = JSON.parse(match[1]);
                }
            }
        }

        if (!holidaysData) {
            const holPath = path.join(process.cwd(), 'holidays.js');
            if (fs.existsSync(holPath)) {
                const content = fs.readFileSync(holPath, 'utf8');
                const match = content.match(/(?:const|let)\s+marketHolidays2026\s*=\s*(\{[\s\S]*?\});/);
                if (match) {
                    holidaysData = JSON.parse(match[1]);
                }
            }
        }

        return res.status(200).json({ 
            strategies: strategiesData || [],
            holidays: holidaysData || {},
            isAdmin: !!isAdmin,
            userPhone: userPhone || 'Admin'
        });

    } catch (error) {
        console.error('Data endpoint error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
