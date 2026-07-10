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
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(455).json({ error: 'Method Not Allowed' });
    }

    try {
        const cookies = parseCookies(req.headers.cookie);
        const adminToken = cookies['admin_token'];
        
        if (!adminToken || !verifyAdminToken(adminToken)) {
            return res.status(401).json({ error: 'Unauthorized. Admin session required.' });
        }

        const { action, data } = req.body || {};
        
        if (!action) {
            return res.status(400).json({ error: 'Action is required' });
        }
        
        const actionsWithoutData = ['sync_local', 'sync_strategies', 'sync_holidays', 'sync_whitelist', 'clear_logs'];
        if (!actionsWithoutData.includes(action) && data === undefined) {
            return res.status(400).json({ error: 'Data is required for this action' });
        }

        try {
            if (action === 'sync_strategies') {
                const strategiesPath = path.join(process.cwd(), 'strategies.js');
                if (fs.existsSync(strategiesPath)) {
                    const content = fs.readFileSync(strategiesPath, 'utf8');
                    const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*\])\s*;?/);
                    if (match) {
                        await queryKV(['SET', 'strategies', match[1]]);
                    }
                }
                return res.status(200).json({ success: true, message: 'Successfully synced strategies from codebase file to KV' });
            }

            else if (action === 'sync_holidays') {
                const holPath = path.join(process.cwd(), 'holidays.js');
                if (fs.existsSync(holPath)) {
                    const content = fs.readFileSync(holPath, 'utf8');
                    const match = content.match(/(?:const|let)\s+marketHolidays2026\s*=\s*(\{[\s\S]*?\});/);
                    if (match) {
                        await queryKV(['SET', 'holidays', match[1]]);
                    }
                }
                return res.status(200).json({ success: true, message: 'Successfully synced holidays from codebase file to KV' });
            }

            else if (action === 'sync_whitelist') {
                const whitelistPath = path.join(process.cwd(), 'whitelist.json');
                if (fs.existsSync(whitelistPath)) {
                    const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
                    const hmsetCmd = ["HMSET", "whitelist"];
                    Object.entries(whitelist).forEach(([phone, pin]) => {
                        hmsetCmd.push(phone, pin.toString());
                    });
                    if (hmsetCmd.length > 2) {
                        await queryKV(hmsetCmd);
                    }
                }
                return res.status(200).json({ success: true, message: 'Successfully synced whitelist from codebase file to KV' });
            }

            else if (action === 'sync_local') {
                const strategiesPath = path.join(process.cwd(), 'strategies.js');
                if (fs.existsSync(strategiesPath)) {
                    const content = fs.readFileSync(strategiesPath, 'utf8');
                    const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*\])\s*;?/);
                    if (match) {
                        await queryKV(['SET', 'strategies', match[1]]);
                    }
                }
                const holPath = path.join(process.cwd(), 'holidays.js');
                if (fs.existsSync(holPath)) {
                    const content = fs.readFileSync(holPath, 'utf8');
                    const match = content.match(/(?:const|let)\s+marketHolidays2026\s*=\s*(\{[\s\S]*?\});/);
                    if (match) {
                        await queryKV(['SET', 'holidays', match[1]]);
                    }
                }
                
                // Sync whitelist.json to KV hash
                const whitelistPath = path.join(process.cwd(), 'whitelist.json');
                if (fs.existsSync(whitelistPath)) {
                    const whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
                    const hmsetCmd = ["HMSET", "whitelist"];
                    Object.entries(whitelist).forEach(([phone, pin]) => {
                        hmsetCmd.push(phone, pin.toString());
                    });
                    if (hmsetCmd.length > 2) {
                        await queryKV(hmsetCmd);
                    }
                }
                
                return res.status(200).json({ success: true, message: 'Successfully synced Vercel KV with server strategies, holidays, and whitelist' });
            }
            
            else if (action === 'save_strategies') {
                await queryKV(['SET', 'strategies', JSON.stringify(data)]);
                return res.status(200).json({ success: true, message: 'Strategies saved successfully to KV' });
            } 
            
            else if (action === 'save_holidays') {
                await queryKV(['SET', 'holidays', JSON.stringify(data)]);
                return res.status(200).json({ success: true, message: 'Holidays saved successfully to KV' });
            } 
            
            else if (action === 'save_user') {
                if (!data.phone || !data.pin) {
                    return res.status(400).json({ error: 'Phone number and PIN are required' });
                }
                // HSET whitelist phone pin
                await queryKV(['HSET', 'whitelist', data.phone.trim(), data.pin.trim()]);
                return res.status(200).json({ success: true, message: `User ${data.phone} saved successfully to KV` });
            } 
            
            else if (action === 'delete_user') {
                if (!data.phone) {
                    return res.status(400).json({ error: 'Phone number is required' });
                }
                // HDEL whitelist phone
                await queryKV(['HDEL', 'whitelist', data.phone.trim()]);
                return res.status(200).json({ success: true, message: `User ${data.phone} deleted successfully from KV` });
            } 
            
            else if (action === 'clear_logs') {
                try {
                    await queryKV(['DEL', 'auth_audit_logs']);
                } catch (dbErr) {
                    console.warn("DB offline during logs clear, proceeding with local fallback file reset.");
                }
                const logsPath = path.join(process.cwd(), 'auth_logs.json');
                fs.writeFileSync(logsPath, '[]', 'utf8');
                return res.status(200).json({ success: true, message: 'Logs cleared successfully' });
            } 
            
            else {
                return res.status(400).json({ error: 'Unknown admin action' });
            }
        } catch (dbErr) {
            if (dbErr.message === "KV_DATABASE_UNCONNECTED") {
                if (action === 'sync_whitelist' || action === 'sync_strategies' || action === 'sync_holidays' || action === 'sync_local') {
                    return res.status(200).json({ success: true, message: 'Local files are already matching codebase (KV offline)' });
                }
                
                const whitelistPath = path.join(process.cwd(), 'whitelist.json');
                
                if (action === 'save_user') {
                    let whitelist = {};
                    if (fs.existsSync(whitelistPath)) {
                        try {
                            whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
                        } catch (e) {
                            whitelist = {};
                        }
                    }
                    whitelist[data.phone.trim()] = data.pin.trim();
                    fs.writeFileSync(whitelistPath, JSON.stringify(whitelist, null, 2), 'utf8');
                    return res.status(200).json({ success: true, message: `User ${data.phone} saved successfully to local file (KV offline)` });
                }
                
                if (action === 'delete_user') {
                    let whitelist = {};
                    if (fs.existsSync(whitelistPath)) {
                        try {
                            whitelist = JSON.parse(fs.readFileSync(whitelistPath, 'utf8'));
                        } catch (e) {
                            whitelist = {};
                        }
                    }
                    delete whitelist[data.phone.trim()];
                    fs.writeFileSync(whitelistPath, JSON.stringify(whitelist, null, 2), 'utf8');
                    return res.status(200).json({ success: true, message: `User ${data.phone} deleted successfully from local file (KV offline)` });
                }
                
                return res.status(400).json({ 
                    error: 'Database is not connected to your Vercel project. Please link a Vercel KV database in your Vercel settings to enable editing.' 
                });
            }
            console.error("DB Save Error:", dbErr);
            return res.status(500).json({ error: 'Failed to write change to KV database.' });
        }

    } catch (error) {
        console.error('Admin save error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
