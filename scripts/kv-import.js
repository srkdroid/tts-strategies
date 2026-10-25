/**
 * KV Import Script — TTS Strategies Migration
 * 
 * Imports data from kv-backup.json into a NEW Vercel KV (Upstash Redis) store.
 * 
 * Usage:
 *   set NEW_KV_URL=https://xxx.upstash.io
 *   set NEW_KV_TOKEN=AXxxxx...
 *   node scripts/kv-import.js
 * 
 * Or edit the fallback values below directly.
 */

const fs = require('fs');
const path = require('path');

// ── Credentials ──────────────────────────────────────────────
// Option 1: Set via environment variables (recommended)
// Option 2: Paste directly here (remove after use!)
const KV_URL   = process.env.NEW_KV_URL   || 'PASTE_NEW_KV_REST_API_URL_HERE';
const KV_TOKEN = process.env.NEW_KV_TOKEN || 'PASTE_NEW_KV_REST_API_TOKEN_HERE';

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
    if (json.error) throw new Error(json.error);
    return json.result;
}

// ── Import logic ────────────────────────────────────────────
async function importAll() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║   TTS Strategies — KV Data Import            ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    if (KV_URL.includes('PASTE_') || KV_TOKEN.includes('PASTE_')) {
        console.error('❌  Please set NEW_KV_URL and NEW_KV_TOKEN environment variables');
        console.error('   or edit the fallback values at the top of this script.\n');
        process.exit(1);
    }

    // 1. Load backup file
    const backupPath = path.join(process.cwd(), 'kv-backup.json');
    if (!fs.existsSync(backupPath)) {
        console.error(`❌  Backup file not found: ${backupPath}`);
        console.error('   Run kv-export.js first to create the backup.\n');
        process.exit(1);
    }

    const data = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const keys = Object.keys(data);
    console.log(`📄  Loaded ${keys.length} keys from ${backupPath}\n`);

    // 2. Verify connection to new KV store
    console.log('🔌  Testing connection to new KV store...');
    try {
        await queryKV(['PING']);
        console.log('   ✅  Connected successfully\n');
    } catch (err) {
        console.error('❌  Failed to connect to new KV store:', err.message);
        process.exit(1);
    }

    // 3. Check if new store already has data
    const existingKeys = await queryKV(['KEYS', '*']);
    if (existingKeys && existingKeys.length > 0) {
        console.log(`⚠️   New KV store already has ${existingKeys.length} keys.`);
        console.log('   Import will OVERWRITE existing keys with same names.\n');
    }

    // 4. Import each key
    let imported = 0;
    let failed = 0;

    for (const [key, entry] of Object.entries(data)) {
        try {
            if (entry.type === 'string') {
                await queryKV(['SET', key, entry.value]);

            } else if (entry.type === 'hash') {
                // HGETALL returns flat array [field1, val1, field2, val2, ...]
                if (entry.value && entry.value.length >= 2) {
                    // Delete first to ensure clean state
                    await queryKV(['DEL', key]);
                    await queryKV(['HSET', key, ...entry.value]);
                }

            } else if (entry.type === 'list') {
                if (entry.value && entry.value.length > 0) {
                    await queryKV(['DEL', key]);
                    // RPUSH preserves original order (LRANGE 0 -1 returns oldest→newest)
                    for (const item of entry.value) {
                        await queryKV(['RPUSH', key, item]);
                    }
                }

            } else if (entry.type === 'set') {
                if (entry.value && entry.value.length > 0) {
                    await queryKV(['DEL', key]);
                    for (const item of entry.value) {
                        await queryKV(['SADD', key, item]);
                    }
                }

            } else if (entry.type === 'zset') {
                // ZRANGE WITHSCORES returns [member, score, member, score, ...]
                if (entry.value && entry.value.length >= 2) {
                    await queryKV(['DEL', key]);
                    for (let i = 0; i < entry.value.length; i += 2) {
                        await queryKV(['ZADD', key, entry.value[i + 1], entry.value[i]]);
                    }
                }
            }

            imported++;
            console.log(`   ✅  ${key} [${entry.type}]`);

        } catch (err) {
            failed++;
            console.error(`   ❌  ${key}: ${err.message}`);
        }
    }

    // 5. Verify critical keys exist
    console.log('\n🔍  Verifying critical keys...');
    const criticalKeys = ['strategies', 'holidays', 'whitelist', 'user_permissions'];
    for (const ck of criticalKeys) {
        try {
            const type = await queryKV(['TYPE', ck]);
            if (type === 'none') {
                console.log(`   ⚠️  ${ck} — NOT FOUND (may not have existed in backup)`);
            } else {
                console.log(`   ✅  ${ck} — present [${type}]`);
            }
        } catch (err) {
            console.log(`   ❌  ${ck} — verification failed: ${err.message}`);
        }
    }

    console.log('\n' + '─'.repeat(48));
    console.log(`✅  Imported: ${imported} keys`);
    if (failed > 0) console.log(`❌  Failed:   ${failed} keys`);
    console.log('─'.repeat(48));
    console.log('\n🎉  Data migration complete!');
}

importAll().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
