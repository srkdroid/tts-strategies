/**
 * Trade Journal PnL Alert Worker Engine
 * 
 * Aggregates all open option strategies across all users, fetches live quotes
 * in a single consolidated batch from Upstox API v2, computes pure Gross MTM P&L
 * (without deducting brokerage/taxes), and dispatches Target, Stop-Loss, and
 * 90% Early Warning alerts via Telegram, Desktop, and In-App channels.
 * 
 * Market Hours Guardrail: 09:15:00 to 15:40:00 IST (inclusive of CAS).
 */

const { queryKV, queryKVSafe } = require('./common/redis');
const { getUpstoxConfig, fetchOptionChain, fetchBatchLTP, getUnderlyingKey } = require('./upstox');
const { sendTelegramMessage } = require('./common/telegram');

const DEFAULT_HOLIDAYS_2026 = {
    "2026-01-26": "Republic Day",
    "2026-03-03": "Holi",
    "2026-03-26": "Shri Ram Navami",
    "2026-03-31": "Shri Mahavir Jayanti",
    "2026-04-03": "Good Friday",
    "2026-04-14": "Dr. Baba Saheb Ambedkar Jayanti",
    "2026-05-01": "Maharashtra Day",
    "2026-05-28": "Bakri Id",
    "2026-06-26": "Muharram",
    "2026-09-14": "Ganesh Chaturthi",
    "2026-10-02": "Mahatma Gandhi Jayanti",
    "2026-10-20": "Dussehra",
    "2026-11-10": "Diwali-Balipratipada",
    "2026-11-24": "Prakash Gurpurb Sri Guru Nanak Dev",
    "2026-12-25": "Christmas"
};

let marketHolidays = DEFAULT_HOLIDAYS_2026;
try {
    const loaded = require('../../holidays');
    if (loaded && typeof loaded === 'object') {
        marketHolidays = { ...DEFAULT_HOLIDAYS_2026, ...loaded };
    }
} catch (e) {
    marketHolidays = DEFAULT_HOLIDAYS_2026;
}

/**
 * Returns current Indian Standard Time (IST = UTC + 5:30) Date components
 */
function getISTDateComponents() {
    const now = new Date();
    // UTC time in ms + 5.5 hours in ms
    const istTime = new Date(now.getTime() + (5.5 * 60 + now.getTimezoneOffset()) * 60000);
    const year = istTime.getFullYear();
    const month = String(istTime.getMonth() + 1).padStart(2, '0');
    const day = String(istTime.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    const dayOfWeek = istTime.getDay(); // 0 = Sun, 6 = Sat
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const seconds = istTime.getSeconds();
    const totalMinutes = hours * 60 + minutes;

    return {
        istTime,
        dateStr,
        dayOfWeek,
        hours,
        minutes,
        seconds,
        totalMinutes
    };
}

/**
 * Verifies if current time is within active market hours (09:15:00 to 15:40:00 IST)
 * and not a weekend or trading holiday.
 */
function isMarketOpenNow() {
    const { dateStr, dayOfWeek, totalMinutes } = getISTDateComponents();

    // 1. Weekend check (Sunday = 0, Saturday = 6)
    if (dayOfWeek === 0 || dayOfWeek === 6) {
        return { isOpen: false, reason: 'Weekend (Market Closed)' };
    }

    // 2. Holiday check
    if (marketHolidays && marketHolidays[dateStr]) {
        return { isOpen: false, reason: `Trading Holiday: ${marketHolidays[dateStr]}` };
    }

    // 3. Time check: 09:15 IST (555 mins) to 15:40 IST (940 mins, including CAS)
    const MARKET_OPEN_MINS = 9 * 60 + 15;  // 09:15 IST = 555
    const MARKET_CLOSE_MINS = 15 * 60 + 40; // 15:40 IST = 940 (includes CAS)

    if (totalMinutes < MARKET_OPEN_MINS) {
        return { isOpen: false, reason: 'Pre-market (Opens at 09:15 IST)' };
    }
    if (totalMinutes >= MARKET_CLOSE_MINS) {
        return { isOpen: false, reason: 'Post-market (Closed at 15:40 IST after CAS)' };
    }

    return { isOpen: true, reason: 'Market Open' };
}

/**
 * Run a single batch evaluation cycle for all open trades across all users
 */
async function evaluateAlertsCycle(options = {}) {
    const startTime = Date.now();
    const forceRun = Boolean(options.force);

    // 1. Check configuration
    const config = await getUpstoxConfig();
    if (!config.token) {
        return {
            success: false,
            status: 'TOKEN_MISSING',
            message: 'Upstox Analytics Token is not configured. Please add token in Admin Console.'
        };
    }

    // 2. Market hours guardrail
    if (!forceRun && config.marketHoursOnly !== false) {
        const marketCheck = isMarketOpenNow();
        if (!marketCheck.isOpen) {
            return {
                success: true,
                status: 'MARKET_CLOSED',
                message: marketCheck.reason,
                marketCheck
            };
        }
    }

    // 3. Scan all user_trades keys in Redis
    let userTradeKeys = [];
    try {
        const rawKeys = await queryKV(['KEYS', 'user_trades:*']);
        if (Array.isArray(rawKeys)) {
            userTradeKeys = rawKeys;
        }
    } catch (err) {
        console.warn('[AlertWorker] Failed to scan KEYS user_trades:*:', err.message);
    }

    // Fallback: check active_traders set if KEYS returned empty
    if (userTradeKeys.length === 0) {
        try {
            const members = await queryKV(['SMEMBERS', 'active_traders']);
            if (Array.isArray(members)) {
                userTradeKeys = members.map(phone => `user_trades:${phone}`);
            }
        } catch (e) {}
    }

    if (userTradeKeys.length === 0) {
        return {
            success: true,
            status: 'NO_TRADES',
            evaluatedTrades: 0,
            message: 'No user trade records found in database.'
        };
    }

    // 4. Load all open trades with alerts enabled
    const openTradesByUser = {}; // { [phone]: trades[] }
    let totalOpenTrades = 0;
    const requiredChains = new Map(); // key: "UNDERLYING|EXPIRY" -> { underlying, expiry }
    const directInstrumentKeys = new Set();

    for (const kvKey of userTradeKeys) {
        const phone = kvKey.replace('user_trades:', '');
        let trades = [];
        try {
            const raw = await queryKVSafe(['GET', kvKey]);
            if (raw) {
                trades = typeof raw === 'string' ? JSON.parse(raw) : raw;
            }
        } catch (e) {
            trades = [];
        }

        if (!Array.isArray(trades)) continue;

        const openTrades = trades.filter(t => t && t.status === 'OPEN' && t.alerts && t.alerts.enabled !== false);
        if (openTrades.length > 0) {
            openTradesByUser[phone] = trades; // store full array for atomic persistence
            totalOpenTrades += openTrades.length;

            openTrades.forEach(trade => {
                const underlying = trade.index || 'Nifty';
                const expiry = trade.contractExpiry;

                if (underlying && expiry) {
                    const chainKey = `${underlying.toUpperCase()}|${expiry}`;
                    if (!requiredChains.has(chainKey)) {
                        requiredChains.set(chainKey, { underlying, expiry });
                    }
                }

                // If any legs have direct instrument_key, collect them too
                (trade.legs || []).forEach(leg => {
                    if (leg.instrument_key) {
                        directInstrumentKeys.add(leg.instrument_key);
                    }
                });
            });
        }
    }

    if (totalOpenTrades === 0) {
        return {
            success: true,
            status: 'NO_ACTIVE_ALERTS',
            evaluatedTrades: 0,
            message: 'No open trades with alerts enabled.'
        };
    }

    // 5. Fetch live quotes from Upstox (Option Chain + Direct Batch LTP)
    const quoteMap = {}; // key: `${underlying}_${expiry}_${strike}_${optionType}` -> ltp

    // A. Option chain batches (1 network call per underlying-expiry pair)
    for (const [, { underlying, expiry }] of requiredChains.entries()) {
        try {
            const chainRows = await fetchOptionChain(underlying, expiry, config.token);
            if (Array.isArray(chainRows)) {
                chainRows.forEach(row => {
                    const strike = row.strike_price;
                    const uUpper = underlying.toUpperCase();

                    if (row.call_options && row.call_options.market_data) {
                        const ltp = parseFloat(row.call_options.market_data.ltp) || 0;
                        const key = `${uUpper}_${expiry}_${strike}_CE`;
                        quoteMap[key] = ltp;
                        if (row.call_options.instrument_key) {
                            quoteMap[row.call_options.instrument_key] = ltp;
                        }
                    }

                    if (row.put_options && row.put_options.market_data) {
                        const ltp = parseFloat(row.put_options.market_data.ltp) || 0;
                        const key = `${uUpper}_${expiry}_${strike}_PE`;
                        quoteMap[key] = ltp;
                        if (row.put_options.instrument_key) {
                            quoteMap[row.put_options.instrument_key] = ltp;
                        }
                    }
                });
            }
        } catch (chainErr) {
            console.warn(`[AlertWorker] Option chain fetch failed for ${underlying} ${expiry}:`, chainErr.message);
        }
    }

    // B. Direct batch LTP for any custom instrument keys collected
    if (directInstrumentKeys.size > 0) {
        try {
            const directQuotes = await fetchBatchLTP(Array.from(directInstrumentKeys), config.token);
            Object.entries(directQuotes).forEach(([key, q]) => {
                if (q && q.last_price !== undefined) {
                    quoteMap[key] = parseFloat(q.last_price) || 0;
                }
            });
        } catch (ltpErr) {
            console.warn('[AlertWorker] Direct batch LTP fetch failed:', ltpErr.message);
        }
    }

    // 6. Evaluate PnL and alert triggers for each open trade
    const nowIso = new Date().toISOString();
    let triggeredCount = 0;
    let updatedUsersCount = 0;
    const triggeredAlertsList = [];

    for (const [phone, userTrades] of Object.entries(openTradesByUser)) {
        let userModified = false;

        for (let i = 0; i < userTrades.length; i++) {
            const trade = userTrades[i];
            if (trade.status !== 'OPEN' || !trade.alerts || trade.alerts.enabled === false) {
                continue;
            }

            const underlying = (trade.index || 'Nifty').toUpperCase();
            const expiry = trade.contractExpiry;
            let currentGrossMtm = 0;
            let allLegsPriced = true;

            // Compute Pure Gross MTM movement from latest leg LTPs
            (trade.legs || []).forEach(leg => {
                const strike = parseFloat(leg.strike) || 0;
                const optType = (leg.optionType || 'CE').toUpperCase();
                const qty = parseFloat(leg.quantity) || 0;
                const entryPrice = parseFloat(leg.entryPrice) || 0;

                const lookupKey = `${underlying}_${expiry}_${strike}_${optType}`;
                let ltp = quoteMap[lookupKey];

                if (ltp === undefined && leg.instrument_key) {
                    ltp = quoteMap[leg.instrument_key];
                }

                if (ltp !== undefined && !isNaN(ltp)) {
                    leg.currentLtp = ltp;
                    const legPnl = leg.action === 'BUY'
                        ? (ltp - entryPrice) * qty
                        : (entryPrice - ltp) * qty;
                    currentGrossMtm += legPnl;
                } else {
                    allLegsPriced = false;
                }
            });

            if (!allLegsPriced && trade.legs && trade.legs.length > 0) {
                // If quotes couldn't be resolved for all legs, skip trigger to prevent false alarms
                continue;
            }

            trade.currentMtmPnL = Math.round(currentGrossMtm);
            trade.lastLtpUpdate = nowIso;
            userModified = true;

            const a = trade.alerts;
            a.history = a.history || [];

            // A. Evaluate Target Profit Trigger
            const pt = a.profitTarget || {};
            if (pt.enabled && pt.amount !== undefined) {
                const targetAmt = parseFloat(pt.amount) || 0;

                // 100% Target Reached
                if (currentGrossMtm >= targetAmt && !pt.finalTriggeredAt) {
                    pt.finalTriggeredAt = nowIso;
                    triggeredCount++;
                    const alertEvent = {
                        id: `alrt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                        type: 'PROFIT_TARGET_REACHED',
                        title: `🎯 Profit Target Reached (+₹${targetAmt.toLocaleString('en-IN')})`,
                        tradeId: trade.id,
                        strategyName: trade.strategyName || 'Trade',
                        currentGrossMtm,
                        threshold: targetAmt,
                        timestamp: nowIso,
                        channelsDispatched: []
                    };
                    a.history.push(alertEvent);
                    triggeredAlertsList.push({ phone, alertEvent, trade });
                }
                // 90% Early Warning Buffer
                else if (pt.earlyWarning && pt.earlyWarning.enabled && !pt.earlyWarning.triggeredAt && !pt.finalTriggeredAt) {
                    const warnAmt = parseFloat(pt.earlyWarning.amount) || Math.round(targetAmt * 0.9);
                    if (currentGrossMtm >= warnAmt) {
                        pt.earlyWarning.triggeredAt = nowIso;
                        triggeredCount++;
                        const alertEvent = {
                            id: `alrt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                            type: 'PROFIT_EARLY_WARNING',
                            title: `⚠️ 90% Target Profit Warning (+₹${warnAmt.toLocaleString('en-IN')})`,
                            tradeId: trade.id,
                            strategyName: trade.strategyName || 'Trade',
                            currentGrossMtm,
                            threshold: warnAmt,
                            timestamp: nowIso,
                            channelsDispatched: []
                        };
                        a.history.push(alertEvent);
                        triggeredAlertsList.push({ phone, alertEvent, trade });
                    }
                }
            }

            // B. Evaluate Stop Loss Trigger
            const sl = a.stopLoss || {};
            if (sl.enabled && sl.amount !== undefined) {
                const slAmt = parseFloat(sl.amount); // stored as negative value (e.g. -6250)

                // 100% Stop Loss Reached
                if (currentGrossMtm <= slAmt && !sl.finalTriggeredAt) {
                    sl.finalTriggeredAt = nowIso;
                    triggeredCount++;
                    const alertEvent = {
                        id: `alrt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                        type: 'STOP_LOSS_REACHED',
                        title: `🛑 Stop Loss Hit (-₹${Math.abs(slAmt).toLocaleString('en-IN')})`,
                        tradeId: trade.id,
                        strategyName: trade.strategyName || 'Trade',
                        currentGrossMtm,
                        threshold: slAmt,
                        timestamp: nowIso,
                        channelsDispatched: []
                    };
                    a.history.push(alertEvent);
                    triggeredAlertsList.push({ phone, alertEvent, trade });
                }
                // 90% Early Warning Buffer
                else if (sl.earlyWarning && sl.earlyWarning.enabled && !sl.earlyWarning.triggeredAt && !sl.finalTriggeredAt) {
                    const warnSlAmt = parseFloat(sl.earlyWarning.amount) || Math.round(slAmt * 0.9);
                    if (currentGrossMtm <= warnSlAmt) {
                        sl.earlyWarning.triggeredAt = nowIso;
                        triggeredCount++;
                        const alertEvent = {
                            id: `alrt_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
                            type: 'STOP_LOSS_EARLY_WARNING',
                            title: `⚠️ 90% Stop Loss Warning (-₹${Math.abs(warnSlAmt).toLocaleString('en-IN')})`,
                            tradeId: trade.id,
                            strategyName: trade.strategyName || 'Trade',
                            currentGrossMtm,
                            threshold: warnSlAmt,
                            timestamp: nowIso,
                            channelsDispatched: []
                        };
                        a.history.push(alertEvent);
                        triggeredAlertsList.push({ phone, alertEvent, trade });
                    }
                }
            }
        }

        // Persist updated trade records to Redis
        if (userModified) {
            try {
                await queryKV(['SET', `user_trades:${phone}`, JSON.stringify(userTrades)]);
                updatedUsersCount++;
            } catch (saveErr) {
                console.error(`[AlertWorker] Failed to save updated trades for ${phone}:`, saveErr.message);
            }
        }
    }

    // 7. Dispatch multi-channel notifications for newly triggered alerts
    for (const { phone, alertEvent, trade } of triggeredAlertsList) {
        const channels = trade.alerts?.channels || { inApp: true, desktop: true, telegram: true };

        // Telegram dispatch
        if (channels.telegram && config.telegramAlertsEnabled !== false) {
            try {
                // Look up user's Telegram Chat ID
                let chatId = await queryKVSafe(['GET', `tg_chat:${phone}`]);
                if (!chatId) {
                    const suffix10 = phone.replace(/\D/g, '').slice(-10);
                    if (suffix10) {
                        chatId = await queryKVSafe(['GET', `tg_chat:${suffix10}`]);
                    }
                }

                if (chatId) {
                    const isProfit = alertEvent.type.startsWith('PROFIT');
                    const icon = isProfit ? (alertEvent.type.includes('EARLY') ? '⚠️ 🎯' : '🎯 🚀') : (alertEvent.type.includes('EARLY') ? '⚠️ 🛑' : '🛑 🚨');
                    const pnlSign = alertEvent.currentGrossMtm >= 0 ? '+' : '';

                    const message = `${icon} *TTS Strategy P&L Alert*\n\n` +
                        `*Strategy:* ${trade.strategyName} (${trade.index || 'Nifty'})\n` +
                        `*Alert:* ${alertEvent.title}\n` +
                        `*Current Gross MTM:* ₹ ${pnlSign}${alertEvent.currentGrossMtm.toLocaleString('en-IN')}\n` +
                        `*Threshold:* ₹ ${alertEvent.threshold.toLocaleString('en-IN')}\n` +
                        `*Contract Expiry:* ${trade.contractExpiry || 'Active'}\n` +
                        `*Timestamp:* ${new Date().toLocaleTimeString('en-IN')} IST\n\n` +
                        `_Log in to TTS Calendar to review position adjustments._`;

                    await sendTelegramMessage(chatId, message);
                    alertEvent.channelsDispatched.push('telegram');
                }
            } catch (tgErr) {
                console.warn(`[AlertWorker] Telegram dispatch failed for ${phone}:`, tgErr.message);
            }
        }

        if (channels.inApp) alertEvent.channelsDispatched.push('inApp');
        if (channels.desktop) alertEvent.channelsDispatched.push('desktop');
    }

    const durationMs = Date.now() - startTime;

    // 8. Update Engine Telemetry in Redis
    const telemetry = {
        lastRunAt: nowIso,
        status: 'OK',
        totalOpenTrades,
        uniqueChainsFetched: requiredChains.size,
        triggeredCount,
        updatedUsersCount,
        durationMs
    };
    await queryKVSafe(['SET', 'system:alert_worker_telemetry', JSON.stringify(telemetry)]);

    return {
        success: true,
        status: 'EVALUATED',
        totalOpenTrades,
        uniqueChainsFetched: requiredChains.size,
        triggeredCount,
        durationMs
    };
}

module.exports = {
    isMarketOpenNow,
    evaluateAlertsCycle,
    getISTDateComponents
};
