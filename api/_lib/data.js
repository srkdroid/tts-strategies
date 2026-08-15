const fs = require('fs');
const path = require('path');
const { verifyToken, verifyAdminToken, parseCookies } = require('./common/auth');
const { queryKV } = require('./common/redis');

async function runStrategiesMigration() {
    try {
        const strategiesPath = path.join(process.cwd(), 'strategies.js');
        if (fs.existsSync(strategiesPath)) {
            const content = fs.readFileSync(strategiesPath, 'utf8');
            const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*\])\s*;?/);
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

        // Log active session auth event once per 15 minutes per user
        if (userPhone && !isAdmin && userPhone !== 'Admin' && userPhone.toLowerCase() !== 'admin') {
            try {
                const lockKey = `auth_session_log:${userPhone}`;
                const hasLogged = await queryKV(['GET', lockKey]);
                if (!hasLogged) {
                    await queryKV(['SET', lockKey, '1', 'EX', '900']);
                    const logEntry = { phone: userPhone, method: 'session', timestamp: new Date().toISOString() };
                    await queryKV(['LPUSH', 'auth_audit_logs', JSON.stringify(logEntry)]);
                    await queryKV(['LTRIM', 'auth_audit_logs', 0, 999]);
                }
            } catch (e) {}
        }

        let strategiesData = null;
        let holidaysData = null;

        try {
            // Fetch strategies from KV
            const stratRes = await queryKV(['GET', 'strategies']);
            if (stratRes) {
                try {
                    strategiesData = JSON.parse(stratRes);
                } catch (parseErr) {
                    console.error("Failed to parse strategies from Redis (corrupted). Deleting key for automatic migration fallback:", parseErr);
                    try {
                        await queryKV(['DEL', 'strategies']);
                    } catch (delErr) {
                        console.error("Failed to delete corrupted strategies key:", delErr);
                    }
                }
            } 
            
            if (!strategiesData) {
                strategiesData = await runStrategiesMigration();
            }

            // Fetch holidays from KV
            const holRes = await queryKV(['GET', 'holidays']);
            if (holRes) {
                try {
                    holidaysData = JSON.parse(holRes);
                } catch (parseErr) {
                    console.error("Failed to parse holidays from Redis (corrupted). Deleting key for automatic migration fallback:", parseErr);
                    try {
                        await queryKV(['DEL', 'holidays']);
                    } catch (delErr) {
                        console.error("Failed to delete corrupted holidays key:", delErr);
                    }
                }
            } 
            
            if (!holidaysData) {
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
                const match = content.match(/(?:const|let)?\s*strategiesData\s*=\s*(\[[\s\S]*\])\s*;?/);
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

        // Auto-heal/sanitize legacy benchmark ATMs from Redis KV
        if (Array.isArray(strategiesData)) {
            strategiesData.forEach(strat => {
                if (strat.index && strat.index.includes("Bank Nifty")) {
                    if (!strat.strike_example || !strat.strike_example.ATM || strat.strike_example.ATM < 40000) {
                        strat.strike_example = strat.strike_example || {};
                        strat.strike_example.ATM = 57500;
                    }
                }
                if (strat.index && strat.index.includes("Sensex")) {
                    if (!strat.strike_example || !strat.strike_example.ATM || strat.strike_example.ATM < 60000) {
                        strat.strike_example = strat.strike_example || {};
                        strat.strike_example.ATM = 87000;
                    }
                }
            });
        }

        let userPermissions = { catalog: false, journal: false };
        if (isAdmin) {
            userPermissions = { catalog: true, journal: true };
        } else if (userPhone) {
            try {
                const permStr = await queryKV(['HGET', 'user_permissions', userPhone]);
                if (permStr) {
                    const parsedPerm = JSON.parse(permStr);
                    userPermissions = {
                        catalog: parsedPerm.catalog === true,
                        journal: parsedPerm.journal === true
                    };
                }
            } catch (permErr) {
                console.warn("User permissions fetch failed:", permErr.message);
            }
        }

        return res.status(200).json({ 
            strategies: strategiesData || [],
            holidays: holidaysData || {},
            isAdmin: !!isAdmin,
            userPhone: userPhone || 'Admin',
            permissions: userPermissions
        });

    } catch (error) {
        console.error('Data endpoint error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
