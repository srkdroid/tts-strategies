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

        // Prevent browser/CDN caching of dynamic DB data
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        let strategies = null;
        let holidays = null;
        let whitelist = null;
        let dbStatus = "connected";

        try {
            // Fetch strategies from KV
            const stratRes = await queryKV(['GET', 'strategies']);
            if (stratRes) {
                try {
                    strategies = JSON.parse(stratRes);
                } catch (parseErr) {
                    console.error("Failed to parse strategies from Redis (corrupted). Deleting key:", parseErr);
                    try {
                        await queryKV(['DEL', 'strategies']);
                    } catch (delErr) {
                        console.error("Failed to delete corrupted strategies key:", delErr);
                    }
                }
            }
            
            // Fetch holidays from KV
            const holRes = await queryKV(['GET', 'holidays']);
            if (holRes) {
                try {
                    holidays = JSON.parse(holRes);
                } catch (parseErr) {
                    console.error("Failed to parse holidays from Redis (corrupted). Deleting key:", parseErr);
                    try {
                        await queryKV(['DEL', 'holidays']);
                    } catch (delErr) {
                        console.error("Failed to delete corrupted holidays key:", delErr);
                    }
                }
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

        if (!strategies) {
            const stratPath = path.join(process.cwd(), 'strategies.js');
            if (fs.existsSync(stratPath)) {
                const content = fs.readFileSync(stratPath, 'utf8');
                const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*?\])\s*;?/);
                if (match) {
                    strategies = JSON.parse(match[1]);
                }
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

        let auditLogs = [];
        try {
            const logsRes = await queryKV(['LRANGE', 'auth_audit_logs', '0', '99']);
            if (logsRes && Array.isArray(logsRes)) {
                auditLogs = logsRes.map(item => {
                    try {
                        return typeof item === 'string' ? JSON.parse(item) : item;
                    } catch (e) {
                        return { error: 'Failed to parse log entry', raw: item };
                    }
                });
            }
        } catch (dbErr) {
            const logsPath = path.join(process.cwd(), 'auth_logs.json');
            if (fs.existsSync(logsPath)) {
                try {
                    auditLogs = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
                } catch (e) {
                    console.error("Failed to parse local auth logs:", e);
                }
            }
        }

        return res.status(200).json({
            dbStatus,
            strategies: strategies || [],
            holidays: holidays || {},
            whitelist: whitelist || {},
            auditLogs: auditLogs
        });

    } catch (error) {
        console.error('Admin get error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
