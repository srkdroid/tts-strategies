/**
 * Shared Redis / Upstash KV Client
 * 
 * Extracted from duplicated copies across api/_lib handlers.
 * Provides a unified queryKV function for all Redis operations.
 */

/**
 * Execute a Redis command via Upstash REST API.
 * @param {Array} command - Redis command as an array, e.g. ['GET', 'key']
 * @returns {*} Redis command result
 * @throws {Error} If KV credentials are missing or the API returns an error
 */
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

/**
 * Execute a Redis command via Upstash REST API, returning null on any failure.
 * Use this for non-critical operations (telemetry, activity logging) where
 * failures should not break the main request flow.
 * @param {Array} command - Redis command as an array
 * @returns {*|null} Redis command result, or null on any error
 */
async function queryKVSafe(command) {
    try {
        return await queryKV(command);
    } catch (e) {
        return null;
    }
}

module.exports = { queryKV, queryKVSafe };
