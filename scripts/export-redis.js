const fs = require('fs');
const path = require('path');
const { createClient } = require('redis');

// 1. Read REDIS_URL directly from .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
    console.error("❌ .env.local not found!");
    process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/REDIS_URL=["']?([^"'\r\n]+)["']?/);
if (!match || !match[1] || match[1].includes('[SENSITIVE]')) {
    console.error("❌ Could not find valid REDIS_URL in .env.local");
    process.exit(1);
}

const REDIS_URL = match[1];

async function exportAll() {
    console.log('🔌 Connecting to Redis via REDIS_URL...');
    const client = createClient({ url: REDIS_URL });
    client.on('error', err => console.error('Redis error:', err.message));

    await client.connect();
    console.log('✅ Connected successfully!\n');

    console.log('🔍 Scanning all keys...');
    const allKeys = await client.keys('*');
    console.log(`Found ${allKeys.length} total keys in Redis.\n`);

    const data = {};
    let exported = 0;
    let skipped = 0;

    for (const key of allKeys) {
        // Skip short-lived session locks and ephemeral tokens
        if (
            key.startsWith('auth_token:') ||
            key.startsWith('auth_session_log:') ||
            key.startsWith('tg_session:') ||
            key.startsWith('rate_limit:') ||
            key.startsWith('ai_rate:') ||
            key.startsWith('ai_global_rate:')
        ) {
            console.log(`⏭️  Skipping ephemeral: ${key}`);
            skipped++;
            continue;
        }

        try {
            const type = await client.type(key);

            if (type === 'string') {
                const value = await client.get(key);
                data[key] = { type, value };
            } else if (type === 'hash') {
                const value = await client.hGetAll(key);
                data[key] = { type, value };
            } else if (type === 'list') {
                const value = await client.lRange(key, 0, -1);
                data[key] = { type, value };
            } else if (type === 'set') {
                const value = await client.sMembers(key);
                data[key] = { type, value };
            } else if (type === 'zset') {
                const value = await client.zRangeWithScores(key, 0, -1);
                data[key] = { type, value };
            }

            exported++;
            console.log(`✅ Exported: ${key} [${type}]`);
        } catch (err) {
            console.error(`❌ Error exporting ${key}:`, err.message);
        }
    }

    const outPath = path.join(process.cwd(), 'kv-backup.json');
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2));

    console.log('\n' + '='.repeat(40));
    console.log(`🎉 Backup complete! ${exported} keys saved to kv-backup.json`);
    console.log(`📦 File size: ${(fs.statSync(outPath).size / 1024).toFixed(1)} KB`);
    console.log('='.repeat(40));

    await client.quit();
}

exportAll().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});