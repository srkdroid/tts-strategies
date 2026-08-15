const crypto = require('crypto');

const SECRET = process.env.JWT_SECRET;
if (!SECRET) {
    throw new Error("JWT_SECRET environment variable is missing");
}

function verifyToken(token) {
    if (!token) return null;
    try {
        const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
        const { data, signature } = decoded;
        const hmac = crypto.createHmac('sha256', SECRET);
        hmac.update(data);
        const expectedSignature = hmac.digest('hex');
        if (signature !== expectedSignature) return null;
        
        const { phone, expires } = JSON.parse(data);
        if (!expires || Date.now() > expires) return null;
        return phone;
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

// Compute P&L and RoI for a single trade record
function calculateTradePnL(trade) {
    if (!trade || !Array.isArray(trade.legs)) return trade;

    let grossPnl = 0;
    const isClosed = trade.status === 'CLOSED';

    trade.legs.forEach(leg => {
        const qty = parseFloat(leg.quantity) || 0;
        const entry = parseFloat(leg.entryPrice) || 0;
        const exit = isClosed && leg.exitPrice !== undefined && leg.exitPrice !== null ? parseFloat(leg.exitPrice) || 0 : 0;

        if (isClosed) {
            if (leg.action === 'BUY') {
                leg.pnl = (exit - entry) * qty;
            } else {
                leg.pnl = (entry - exit) * qty;
            }
            grossPnl += leg.pnl;
        } else {
            leg.pnl = 0;
        }
    });

    trade.grossPnl = grossPnl;

    const brokerage = parseFloat(trade.charges?.brokerage) || 0;
    const stt = parseFloat(trade.charges?.sttAndTaxes) || 0;
    const totalCharges = brokerage + stt;

    trade.netPnl = isClosed ? grossPnl - totalCharges : -totalCharges;

    const margin = parseFloat(trade.marginUsed) || 0;
    if (margin > 0 && isClosed) {
        trade.roiPct = (trade.netPnl / margin) * 100;
    } else {
        trade.roiPct = 0;
    }

    return trade;
}

async function logActivity(phone, eventType, details, meta) {
    if (!phone || phone === 'Admin' || (typeof phone === 'string' && phone.toLowerCase() === 'admin')) return;
    try {
        const logEntry = {
            id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            phone,
            eventType,
            details,
            meta: meta || {},
            timestamp: new Date().toISOString()
        };
        await queryKV(['LPUSH', 'user_activity_logs', JSON.stringify(logEntry)]);
        await queryKV(['LTRIM', 'user_activity_logs', 0, 1999]);
    } catch (e) {}
}

module.exports = async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie);
        const sessionToken = cookies['session_token'];
        const phone = verifyToken(sessionToken);

        if (!phone) {
            return res.status(401).json({ error: 'Unauthorized. Login required to access Trade Journal.' });
        }

        // Check if user has journal permission enabled
        let hasJournalAccess = false;
        try {
            const permStr = await queryKV(['HGET', 'user_permissions', phone]);
            if (permStr) {
                const parsed = JSON.parse(permStr);
                hasJournalAccess = parsed.journal === true;
            }
        } catch (e) {
            hasJournalAccess = false;
        }

        if (!hasJournalAccess) {
            return res.status(403).json({ error: 'Trade Journal access is disabled for your account. Please contact Admin.' });
        }

        const kvKey = `user_trades:${phone}`;

        // 1. GET /api/journal -> Fetch all user trades
        if (req.method === 'GET') {
            let trades = [];
            try {
                const kvRes = await queryKV(['GET', kvKey]);
                if (kvRes) {
                    try { trades = JSON.parse(kvRes); } catch (e) { trades = []; }
                }
            } catch (kvErr) {
                console.warn("KV fetch error for journal, returning empty list:", kvErr.message);
            }

            // Recalculate PnL and RoI for all trades
            trades = (trades || []).map(calculateTradePnL);

            return res.status(200).json({ success: true, trades });
        }

        // 2. POST /api/journal -> Save, Exit, or Delete Trade
        if (req.method === 'POST') {
            const { action, data } = req.body || {};

            if (!action || !data) {
                return res.status(400).json({ error: 'Action and Data are required' });
            }

            let currentTrades = [];
            try {
                const kvRes = await queryKV(['GET', kvKey]);
                if (kvRes) {
                    try { currentTrades = JSON.parse(kvRes); } catch (e) { currentTrades = []; }
                }
            } catch (kvErr) {
                currentTrades = [];
            }

            if (action === 'save_trade') {
                const trade = calculateTradePnL(data);
                trade.updatedAt = new Date().toISOString();
                if (!trade.createdAt) trade.createdAt = trade.updatedAt;

                const existingIdx = currentTrades.findIndex(t => t.id === trade.id);
                const isNew = existingIdx === -1;
                if (!isNew) {
                    currentTrades[existingIdx] = trade;
                } else {
                    currentTrades.unshift(trade);
                }

                await queryKV(['SET', kvKey, JSON.stringify(currentTrades)]);
                logActivity(phone, isNew ? 'JOURNAL_ADD_TRADE' : 'JOURNAL_EDIT_TRADE', `${isNew ? 'Added new trade' : 'Updated trade'}: ${trade.strategyName || 'Trade'} (${trade.status || 'OPEN'})`, { tradeId: trade.id, strategyName: trade.strategyName, pnl: trade.pnlNet });
                return res.status(200).json({ success: true, message: 'Trade saved successfully', trade });
            }

            if (action === 'exit_trade') {
                const existingIdx = currentTrades.findIndex(t => t.id === data.id);
                if (existingIdx === -1) {
                    return res.status(404).json({ error: 'Trade record not found' });
                }

                let trade = currentTrades[existingIdx];
                trade.status = 'CLOSED';
                trade.exitDate = data.exitDate || new Date().toISOString();
                
                if (data.legs && Array.isArray(data.legs)) {
                    data.legs.forEach(exLeg => {
                        const targetLeg = trade.legs.find(l => l.legId === exLeg.legId || l.strike === exLeg.strike);
                        if (targetLeg) {
                            targetLeg.exitPrice = parseFloat(exLeg.exitPrice) || 0;
                        }
                    });
                }

                if (data.charges) {
                    trade.charges = {
                        brokerage: parseFloat(data.charges.brokerage) || 0,
                        sttAndTaxes: parseFloat(data.charges.sttAndTaxes) || 0
                    };
                }

                if (data.notes && data.notes.exit) {
                    trade.notes = trade.notes || {};
                    trade.notes.exit = data.notes.exit;
                }

                trade = calculateTradePnL(trade);
                trade.updatedAt = new Date().toISOString();
                currentTrades[existingIdx] = trade;

                await queryKV(['SET', kvKey, JSON.stringify(currentTrades)]);
                logActivity(phone, 'JOURNAL_EXIT_TRADE', `Closed trade: ${trade.strategyName || 'Trade'} with Net P&L ₹${(trade.pnlNet || 0).toLocaleString('en-IN')}`, { tradeId: trade.id, strategyName: trade.strategyName, pnl: trade.pnlNet });
                return res.status(200).json({ success: true, message: 'Trade position closed successfully', trade });
            }

            if (action === 'delete_trade') {
                const deletedTrade = currentTrades.find(t => t.id === data.id);
                currentTrades = currentTrades.filter(t => t.id !== data.id);
                await queryKV(['SET', kvKey, JSON.stringify(currentTrades)]);
                logActivity(phone, 'JOURNAL_DELETE_TRADE', `Deleted trade record: ${deletedTrade ? deletedTrade.strategyName : data.id}`, { tradeId: data.id });
                return res.status(200).json({ success: true, message: 'Trade record deleted successfully' });
            }

            return res.status(400).json({ error: 'Unknown journal action' });
        }

        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ error: 'Method Not Allowed' });

    } catch (error) {
        console.error('Journal API error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
