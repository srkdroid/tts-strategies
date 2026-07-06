const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SECRET = 'TTS_STRATEGIES_ADMIN_SECURE_KEY_2026';

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

module.exports = async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie);
        const adminToken = cookies['admin_token'];
        
        if (!adminToken || !verifyAdminToken(adminToken)) {
            return res.status(401).json({ error: 'Unauthorized. Admin session required.' });
        }

        let strategies = null;
        let holidays = null;
        let whitelist = null;
        let dbStatus = "connected";

        try {
            // Fetch strategies from KV
            const stratRes = await queryKV(['GET', 'strategies']);
            if (stratRes) {
                strategies = JSON.parse(stratRes);
            }
            
            // Fetch holidays from KV
            const holRes = await queryKV(['GET', 'holidays']);
            if (holRes) {
                holidays = JSON.parse(holRes);
            }

            // Fetch whitelist hash from KV
            const wlRes = await queryKV(['HGETALL', 'whitelist']);
            if (wlRes && Array.isArray(wlRes) && wlRes.length > 0) {
                whitelist = {};
                for (let i = 0; i < wlRes.length; i += 2) {
                    whitelist[wlRes[i]] = wlRes[i+1];
                }
            }
        } catch (dbErr) {
            if (dbErr.message === "KV_DATABASE_UNCONNECTED") {
                dbStatus = "unconnected";
            } else {
                console.error("DB Query Error:", dbErr);
                dbStatus = "error";
            }
        }

        // Fallbacks: If database is unconnected, erroring, or empty, return local files' contents
        if (!strategies) {
            const stratPath = path.join(process.cwd(), 'strategies.js');
            if (fs.existsSync(stratPath)) {
                const content = fs.readFileSync(stratPath, 'utf8');
                const cleanJson = content
                    .replace('// Options Trading Strategies Data', '')
                    .replace('// Generated dynamically from Excel parsed data', '')
                    .replace('const strategiesData = ', '')
                    .trim();
                const cleaned = cleanJson.endsWith(';') ? cleanJson.slice(0, -1) : cleanJson;
                strategies = JSON.parse(cleaned);
            }
        }

        if (!holidays) {
            // Read holidays from holidays.js
            const holPath = path.join(process.cwd(), 'holidays.js');
            if (fs.existsSync(holPath)) {
                const content = fs.readFileSync(holPath, 'utf8');
                // Extract const marketHolidays2026 = { ... };
                const match = content.match(/(?:const|let)\s+marketHolidays2026\s*=\s*(\{[\s\S]*?\});/);
                if (match) {
                    holidays = JSON.parse(match[1]);
                }
            }
        }

        if (!whitelist) {
            const wlPath = path.join(process.cwd(), 'whitelist.json');
            if (fs.existsSync(wlPath)) {
                whitelist = JSON.parse(fs.readFileSync(wlPath, 'utf8'));
            }
        }

        return res.status(200).json({
            dbStatus,
            strategies: strategies || [],
            holidays: holidays || {},
            whitelist: whitelist || {}
        });

    } catch (error) {
        console.error('Admin get error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
