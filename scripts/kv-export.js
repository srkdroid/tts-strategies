/**
 * KV Export Script — TTS Strategies Migration
 * 
 * Exports ALL data from the OLD Vercel KV (Upstash Redis) store
 * into a local kv-backup.json file.
 * 
 * Usage:
 *   set OLD_KV_URL=https://xxx.upstash.io
 *   set OLD_KV_TOKEN=AXxxxx...
 *   node scripts/kv-export.js
 * 
 * Or edit the fallback values below directly.
 */

const fs = require('fs');
const path = require('path');

// ── Credentials ──────────────────────────────────────────────
// Option 1: Set via environment variables (recommended)
// Option 2: Paste directly here (remove after use!)
const KV_URL   = process.env.OLD_KV_URL   || 'PASTE_OLD_KV_REST_API_URL_HERE';
const KV_TOKEN = process.env.OLD_KV_TOKEN || 'PASTE_OLD_KV_REST_API_TOKEN_HERE';

// ── Known persistent keys used by the app ────────────────────
// These are always exported. KEYS * scan will catch any extras.
const KNOWN_KEYS = [
    'strategies',           // JSON string — all strategy configs
    'holidays',             // JSON string — market holidays
    'notes',                // JSON string — knowledge base notes
    'whitelist',            // HASH — phone → PIN mapping
    'user_permissions',     // HASH — phone → {catalog, journal}
    'user_capital',         // HASH — phone → capital amount
    'user_terms_consent',   // HASH — phone → consent record
    'user_activity_logs',   // LIST — activity log entries (max 2000)
    'auth_audit_logs',      // LIST — auth audit trail (max 1000)
    'system:admin_only_mode', // STRING — maintenance mode flag
];

// ── Redis REST client ────────────────────────────────────────
async function queryKV(command) {
    const res = await fetch(KV_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${KV_TOKEN}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(command)
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`KV API ${res.status}: ${text}`);
    }
    const json = await res.json();
    return json.result;
}

// ── Export logic ─────────────────────────────────────────────
async function exportAll() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   TTS Strategies — KV Data Export            ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    if (KV_URL.includes('PASTE_') || KV_TOKEN.includes('PASTE_')) {
        console.error('❌  Please set OLD_KV_URL and OLD_KV_TOKEN environment variables');
        console.error('   or edit the fallback values at the top of this script.\n');
        process.exit(1);
    }

    // 1. Discover all keys
    console.log('🔍  Scanning all keys...');
    let allKeys;
    try {
        allKeys = await queryKV(['KEYS', '*']);
    } catch (err) {
        console.error('❌  Failed to connect to KV store:', err.message);
        process.exit(1);
    }
    console.log(`   Found ${allKeys.length} keys in Redis\n`);

    // 2. Export each key based on its type
    const data = {};
    let exported = 0;
    let skipped = 0;

    for (const key of allKeys) {
        // Skip ephemeral keys (auth tokens, rate limits, session locks)
        if (key.startsWith('auth_token:') || 
            key.startsWith('auth_session_log:') ||
            key.startsWith('tg_session:') ||
            key.startsWith('tg_user:') ||
            key.startsWith('rate_limit:') ||
            key.startsWith('ai_rate:') ||
            key.startsWith('ai_global_rate:')) {
            console.log(`   ⏭  Skipping ephemeral: ${key}`);
            skipped++;
            continue;
        }

        try {
            const type = await queryKV(['TYPE', key]);

            if (type === 'string') {
                const value = await queryKV(['GET', key]);
                data[key] = { type: 'string', value };
            } else if (type === 'hash') {
                const value = await queryKV(['HGETALL', key]);
                data[key] = { type: 'hash', value };
            } else if (type === 'list') {
                const value = await queryKV(['LRANGE', key, '0', '-1']);
                data[key] = { type: 'list', value };
            } else if (type === 'set') {
                const value = await queryKV(['SMEMBERS', key]);
                data[key] = { type: 'set', value };
            } else if (type === 'zset') {
                const value = await queryKV(['ZRANGE', key, '0', '-1', 'WITHSCORES']);
                data[key] = { type: 'zset', value };
            } else {
                console.log(`   ⚠️  Unknown type "${type}" for key: ${key}`);
                skipped++;
                continue;
            }

            exported++;
            const preview = type === 'string' 
                ? `(${(data[key].value || '').length} chars)` 
                : type === 'hash'
                    ? `(${(data[key].value || []).length / 2} fields)`
                    : `(${(data[key].value || []).length} items)`;
            console.log(`   ✅  ${key} [${type}] ${preview}`);

        } catch (err) {
            console.error(`   ❌  Failed to export "${key}": ${err.message}`);
            skipped++;
        }
    }

    // 3. Write backup file
    const outPath = path.join(process.cwd(), 'kv-backup.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

    console.log('\n' + '─'.repeat(48));
    console.log(`✅  Exported: ${exported} keys`);
    console.log(`⏭  Skipped:  ${skipped} ephemeral/unknown keys`);
    console.log(`📄  Saved to: ${outPath}`);
    console.log(`📦  File size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
    console.log('─'.repeat(48));
}

exportAll().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
