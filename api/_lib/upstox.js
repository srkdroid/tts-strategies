/**
 * Upstox Market Quote & Option Chain Client (API v2)
 * 
 * Provides:
 * - Upstox Analytics Token persistence in Redis (system:upstox_config)
 * - Connection testing against Upstox v2 market quote endpoint
 * - Batch LTP quote retrieval (up to 500 instrument keys in a single GET request)
 * - Native Upstox Option Chain retrieval by underlying and contract expiry
 * - Underlying index symbol mapping
 */

const { queryKV, queryKVSafe } = require('./common/redis');

const UPSTOX_BASE_URL = 'https://api.upstox.com/v2';
const REDIS_CONFIG_KEY = 'system:upstox_config';

// Map common index display names to Upstox underlying instrument keys
const INDEX_INSTRUMENT_MAP = {
    'NIFTY': 'NSE_INDEX|Nifty 50',
    'NIFTY 50': 'NSE_INDEX|Nifty 50',
    'BANKNIFTY': 'NSE_INDEX|Nifty Bank',
    'BANK NIFTY': 'NSE_INDEX|Nifty Bank',
    'SENSEX': 'BSE_INDEX|SENSEX',
    'FINNIFTY': 'NSE_INDEX|Nifty Fin Service',
    'FIN NIFTY': 'NSE_INDEX|Nifty Fin Service',
    'MIDCPNIFTY': 'NSE_INDEX|NIFTY MID SELECT',
    'MIDCAP NIFTY': 'NSE_INDEX|NIFTY MID SELECT'
};

/**
 * Retrieve current Upstox configuration from Redis with env fallback
 */
async function getUpstoxConfig() {
    let config = {
        token: process.env.UPSTOX_ANALYTICS_TOKEN || '',
        pollInterval: 60, // seconds
        telegramAlertsEnabled: true,
        marketHoursOnly: true,
        updatedAt: null
    };

    try {
        const raw = await queryKVSafe(['GET', REDIS_CONFIG_KEY]);
        if (raw) {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed && typeof parsed === 'object') {
                config = { ...config, ...parsed };
                // Ensure env token fallback if redis token is empty
                if (!config.token && process.env.UPSTOX_ANALYTICS_TOKEN) {
                    config.token = process.env.UPSTOX_ANALYTICS_TOKEN;
                }
            }
        }
    } catch (err) {
        console.warn('[Upstox] Failed to read config from Redis:', err.message);
    }

    return config;
}

/**
 * Save Upstox configuration to Redis
 */
async function saveUpstoxConfig(updates) {
    const existing = await getUpstoxConfig();
    const merged = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString()
    };

    // If token provided as empty string or whitespace, keep existing if not explicitly cleared
    if (updates.token !== undefined) {
        merged.token = (updates.token || '').trim();
    }
    if (updates.pollInterval !== undefined) {
        const intervalNum = parseInt(updates.pollInterval, 10);
        merged.pollInterval = isNaN(intervalNum) || intervalNum < 10 ? 60 : intervalNum;
    }
    if (updates.telegramAlertsEnabled !== undefined) {
        merged.telegramAlertsEnabled = Boolean(updates.telegramAlertsEnabled);
    }
    if (updates.marketHoursOnly !== undefined) {
        merged.marketHoursOnly = Boolean(updates.marketHoursOnly);
    }

    await queryKV(['SET', REDIS_CONFIG_KEY, JSON.stringify(merged)]);
    return merged;
}

/**
 * Mask bearer token for secure display in Admin UI
 */
function maskToken(token) {
    if (!token || typeof token !== 'string') return '';
    const trimmed = token.trim();
    if (trimmed.length <= 12) return '••••••••';
    return `${trimmed.slice(0, 6)}••••••••${trimmed.slice(-4)}`;
}

/**
 * Test connectivity and token validity against Upstox v2 API
 * Pings the Nifty 50 Index quote endpoint
 */
async function testUpstoxConnection(candidateToken) {
    const token = candidateToken ? candidateToken.trim() : (await getUpstoxConfig()).token;
    if (!token) {
        return { success: false, error: 'No Upstox token provided or configured.' };
    }

    const testInstrument = 'NSE_INDEX|Nifty 50';
    const url = `${UPSTOX_BASE_URL}/market-quote/ltp?instrument_key=${encodeURIComponent(testInstrument)}`;

    try {
        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await resp.json();

        if (!resp.ok || data.status === 'error') {
            const errorMsg = (data.errors && data.errors[0]?.message) || data.message || `HTTP ${resp.status}: ${resp.statusText}`;
            return {
                success: false,
                status: resp.status,
                error: errorMsg
            };
        }

        // Upstox formats keys in response as 'NSE_INDEX:Nifty 50'
        const normalizedKey = 'NSE_INDEX:Nifty 50';
        const quote = data.data?.[normalizedKey] || Object.values(data.data || {})[0];

        return {
            success: true,
            status: 200,
            message: 'Connected to Upstox API successfully.',
            testQuote: {
                instrument: testInstrument,
                last_price: quote?.last_price || null
            }
        };
    } catch (err) {
        return {
            success: false,
            error: `Network error connecting to Upstox: ${err.message}`
        };
    }
}

/**
 * Fetch live LTP quotes for an array of instrument keys in a single batch call
 * Upstox supports up to 500 comma-separated keys per request.
 * 
 * @param {string[]} instrumentKeys - e.g. ['NSE_FO|48212', 'NSE_INDEX|Nifty 50']
 * @param {string} [overrideToken] - Optional bearer token override
 * @returns {Promise<Object>} Map of instrumentKey to quote data { last_price, ... }
 */
async function fetchBatchLTP(instrumentKeys, overrideToken = null) {
    if (!Array.isArray(instrumentKeys) || instrumentKeys.length === 0) {
        return {};
    }

    const token = overrideToken || (await getUpstoxConfig()).token;
    if (!token) {
        throw new Error('UPSTOX_TOKEN_NOT_CONFIGURED');
    }

    // De-duplicate keys
    const uniqueKeys = Array.from(new Set(instrumentKeys.map(k => (k || '').trim()).filter(Boolean)));
    if (uniqueKeys.length === 0) return {};

    // Chunk into batches of 450 (below 500 safety limit)
    const BATCH_SIZE = 450;
    const results = {};

    for (let i = 0; i < uniqueKeys.length; i += BATCH_SIZE) {
        const chunk = uniqueKeys.slice(i, i + BATCH_SIZE);
        const url = `${UPSTOX_BASE_URL}/market-quote/ltp?instrument_key=${encodeURIComponent(chunk.join(','))}`;

        const resp = await fetch(url, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!resp.ok) {
            const errBody = await resp.text();
            throw new Error(`Upstox API quote error (HTTP ${resp.status}): ${errBody.slice(0, 200)}`);
        }

        const json = await resp.json();
        if (json.status === 'success' && json.data) {
            // Upstox response keys replace '|' with ':', normalize back
            Object.entries(json.data).forEach(([respKey, quote]) => {
                const standardKey = respKey.replace(':', '|');
                results[standardKey] = quote;
                results[respKey] = quote; // also keep original key for direct matching
            });
        }
    }

    return results;
}

/**
 * Fetch full option chain from Upstox v2 for an underlying and expiry date
 * Endpoint: /v2/option/chain?instrument_key=NSE_INDEX|Nifty 50&expiry_date=YYYY-MM-DD
 * 
 * Returns an array of strike rows containing call_options and put_options with live market_data (ltp).
 */
async function fetchOptionChain(underlyingKey, expiryDate, overrideToken = null) {
    const token = overrideToken || (await getUpstoxConfig()).token;
    if (!token) throw new Error('UPSTOX_TOKEN_NOT_CONFIGURED');

    const normUnderlying = INDEX_INSTRUMENT_MAP[underlyingKey.toUpperCase()] || underlyingKey;
    const url = `${UPSTOX_BASE_URL}/option/chain?instrument_key=${encodeURIComponent(normUnderlying)}&expiry_date=${encodeURIComponent(expiryDate)}`;

    const resp = await fetch(url, {
        method: 'GET',
        headers: {
            'Accept': 'application/json',
            'Authorization': `Bearer ${token}`
        }
    });

    if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Option chain error (HTTP ${resp.status}): ${errText.slice(0, 200)}`);
    }

    const data = await resp.json();
    return data.data || [];
}

/**
 * Resolve an underlying index name to Upstox instrument key
 */
function getUnderlyingKey(indexName) {
    if (!indexName) return 'NSE_INDEX|Nifty 50';
    const upper = indexName.toUpperCase().trim();
    for (const [key, val] of Object.entries(INDEX_INSTRUMENT_MAP)) {
        if (upper.includes(key) || key.includes(upper)) {
            return val;
        }
    }
    return 'NSE_INDEX|Nifty 50';
}

module.exports = {
    getUpstoxConfig,
    saveUpstoxConfig,
    maskToken,
    testUpstoxConnection,
    fetchBatchLTP,
    fetchOptionChain,
    getUnderlyingKey,
    INDEX_INSTRUMENT_MAP
};
