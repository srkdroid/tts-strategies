const { verifyToken, verifyAdminToken, parseCookies } = require('./common/auth');
const { queryKV } = require('./common/redis');

let seedStrategies = [];
try {
    seedStrategies = require('../../strategies.js');
} catch (e) {
    console.warn("Could not require strategies.js statically:", e.message);
}

let seedHolidays = {};
try {
    seedHolidays = require('../../holidays.js');
} catch (e) {
    console.warn("Could not require holidays.js statically:", e.message);
}

async function runStrategiesMigration() {
    try {
        if (Array.isArray(seedStrategies) && seedStrategies.length > 0) {
            await queryKV(['SET', 'strategies', JSON.stringify(seedStrategies)]);
            console.log("Migration: strategies.js imported to Vercel KV via require");
            return seedStrategies;
        }
    } catch (e) {
        console.error("Strategies migration failed:", e);
    }
    return null;
}

async function runHolidaysMigration() {
    try {
        if (seedHolidays && typeof seedHolidays === 'object') {
            await queryKV(['SET', 'holidays', JSON.stringify(seedHolidays)]);
            console.log("Migration: holidays.js imported to Vercel KV via require");
            return seedHolidays;
        }
    } catch (e) {
        console.error("Holidays migration failed:", e);
    }
    return null;
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    try {
        const cookies = parseCookies(req.headers.cookie);
        const token = cookies['session_token'];
        const adminToken = cookies['admin_token'];
        
        const userPhone = token ? verifyToken(token) : null;
        const isAdmin = verifyAdminToken(adminToken);
        
        if (!userPhone && !isAdmin) {
            return res.status(401).json({ error: 'Unauthorized. Please login first.' });
        }

        // Support POST /api/data for saving user trading capital or accepting terms
        if (req.method === 'POST') {
            const body = req.body || {};
            const phoneKey = userPhone || (isAdmin ? 'admin' : 'unknown');

            // 1. Accept Terms of Service & Privacy Disclaimers
            if (body.action === 'accept_terms') {
                const consentData = {
                    accepted: true,
                    version: body.version || '1.0',
                    acceptedAt: new Date().toISOString(),
                    ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'
                };
                await queryKV(['HSET', 'user_terms_consent', phoneKey, JSON.stringify(consentData)]);
                return res.status(200).json({ success: true, termsConsent: consentData });
            }

            // 2. Save User Trading Capital
            const capital = parseFloat(body.capital);
            if (isNaN(capital) || capital < 0) {
                return res.status(400).json({ error: 'Invalid capital amount' });
            }
            await queryKV(['HSET', 'user_capital', phoneKey, String(capital)]);
            return res.status(200).json({ success: true, capital });
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

            // Automatic Migration: Rename "Iron Fly - Nifty" to "Axis Fly - Nifty"
            if (Array.isArray(strategiesData)) {
                let renamed = false;
                strategiesData.forEach(s => {
                    if (s && (s.name === 'Iron Fly - Nifty' || s.id === 'monthly-iron-fly-nifty')) {
                        s.name = 'Axis Fly - Nifty';
                        if (s.id === 'monthly-iron-fly-nifty' || !s.id) {
                            s.id = 'monthly-axis-fly-nifty';
                        }
                        renamed = true;
                    }
                });
                if (renamed) {
                    try {
                        await queryKV(['SET', 'strategies', JSON.stringify(strategiesData)]);
                        console.log("Renamed 'Iron Fly - Nifty' to 'Axis Fly - Nifty' in Redis KV");
                    } catch (e) {
                        console.error("Failed to persist renamed strategy:", e);
                    }
                }

                // Auto-merge any missing master strategies from seedStrategies into KV
                if (Array.isArray(strategiesData) && Array.isArray(seedStrategies) && seedStrategies.length > 0) {
                    let added = false;
                    seedStrategies.forEach(diskStrat => {
                        const exists = strategiesData.some(s => s && (s.id === diskStrat.id || s.name === diskStrat.name));
                        if (!exists) {
                            strategiesData.push(diskStrat);
                            added = true;
                        }
                    });
                    if (added) {
                        try {
                            await queryKV(['SET', 'strategies', JSON.stringify(strategiesData)]);
                            console.log("Auto-merged missing seed strategies (including Nifty Sniper & Axis Fly) into KV database");
                        } catch (saveErr) {
                            console.error("Failed to persist auto-merged strategies:", saveErr);
                        }
                    }
                }

                // Remove Volcano Calendar from KV strategies if present (pending verification)
                const hadVolcano = strategiesData.some(s => s && (s.id === 'discretionary-volcano-calendar' || s.name === 'Volcano Calendar'));
                if (hadVolcano) {
                    strategiesData = strategiesData.filter(s => s && s.id !== 'discretionary-volcano-calendar' && s.name !== 'Volcano Calendar');
                    try {
                        await queryKV(['SET', 'strategies', JSON.stringify(strategiesData)]);
                        console.log("Removed Volcano Calendar from KV strategies (pending details verification)");
                    } catch (remErr) {
                        console.error("Failed to update KV after removing Volcano Calendar:", remErr);
                    }
                }
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

        let userCapital = null;
        let termsConsent = { accepted: false, version: '1.0' };
        try {
            const phoneKey = userPhone || (isAdmin ? 'admin' : null);
            if (phoneKey) {
                const capStr = await queryKV(['HGET', 'user_capital', phoneKey]);
                if (capStr) userCapital = parseFloat(capStr);

                const consentStr = await queryKV(['HGET', 'user_terms_consent', phoneKey]);
                if (consentStr) {
                    try {
                        termsConsent = JSON.parse(consentStr);
                    } catch (e) {}
                }
            }
        } catch (capErr) {
            console.warn("User metadata fetch failed:", capErr.message);
        }

        return res.status(200).json({ 
            strategies: strategiesData || [],
            holidays: holidaysData || {},
            isAdmin: !!isAdmin,
            userPhone: userPhone || 'Admin',
            permissions: userPermissions,
            userCapital: userCapital,
            termsConsent: termsConsent
        });

    } catch (error) {
        console.error('Data endpoint error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
