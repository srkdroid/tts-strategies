const adminHandler = require('./_lib/admin');
const dataHandler = require('./_lib/data');
const journalHandler = require('./_lib/journal');
const loginPinHandler = require('./_lib/login-pin');
const loginHandler = require('./_lib/login');
const logoutHandler = require('./_lib/logout');
const notesHandler = require('./_lib/notes');
const aiHandler = require('./_lib/ai');
const telegramWebhookHandler = require('./_lib/telegram-webhook');
const trackHandler = require('./_lib/track');
const uploadHandler = require('./_lib/upload');

module.exports = async (req, res) => {
    // 1. Determine host and URL
    const host = (req.headers && req.headers.host) ? req.headers.host : 'localhost';
    let urlObj;
    try {
        urlObj = new URL(req.url || '', `http://${host}`);
    } catch (e) {
        urlObj = { pathname: '', searchParams: new URLSearchParams() };
    }

    // 2. Determine route from query param (set by vercel rewrites) or req.url
    let route = req.query ? req.query.route : null;
    if (!route) {
        route = urlObj.pathname.replace(/^\/api\/?/, '');
    }

    // 3. Temporary database export for migration
    const secret = (req.query && req.query.secret) || urlObj.searchParams.get('secret');
    if ((route === 'export-db' || urlObj.pathname === '/api/export-db') && secret === 'migrate2026') {
        try {
            const { queryKV } = require('./_lib/common/redis');
            const allKeys = await queryKV(['KEYS', '*']) || [];
            const dump = {
                _meta: {
                    exportedAt: new Date().toISOString(),
                    totalKeys: allKeys.length,
                    KV_REST_API_URL: process.env.KV_REST_API_URL || null,
                    KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN || null
                }
            };

            for (const key of allKeys) {
                // Skip short-lived session locks and ephemeral tokens
                if (
                    key.startsWith('auth_token:') ||
                    key.startsWith('auth_session_log:') ||
                    key.startsWith('tg_session:') ||
                    key.startsWith('rate_limit:') ||
                    key.startsWith('ai_rate:')
                ) {
                    continue;
                }
                try {
                    const type = await queryKV(['TYPE', key]);
                    if (type === 'string') {
                        dump[key] = { type, value: await queryKV(['GET', key]) };
                    } else if (type === 'hash') {
                        dump[key] = { type, value: await queryKV(['HGETALL', key]) };
                    } else if (type === 'list') {
                        dump[key] = { type, value: await queryKV(['LRANGE', key, 0, -1]) };
                    } else if (type === 'set') {
                        dump[key] = { type, value: await queryKV(['SMEMBERS', key]) };
                    } else if (type === 'zset') {
                        dump[key] = { type, value: await queryKV(['ZRANGE', key, 0, -1, 'WITHSCORES']) };
                    }
                } catch (keyErr) {
                    console.warn(`Skipping key ${key}:`, keyErr.message);
                }
            }

            res.setHeader('Content-Disposition', 'attachment; filename="kv-backup.json"');
            res.setHeader('Content-Type', 'application/json');
            return res.status(200).send(JSON.stringify(dump, null, 2));
        } catch (err) {
            return res.status(500).json({ error: 'Export failed: ' + err.message });
        }
    }

    // 4. Route admin requests (e.g. /api/admin/login, /api/admin/save, /api/admin/get)
    if (route === 'admin' || (typeof route === 'string' && route.startsWith('admin'))) {
        return adminHandler(req, res);
    }

    // 5. Route all other API requests
    switch (route) {
        case 'data':
            return dataHandler(req, res);
        case 'journal':
            return journalHandler(req, res);
        case 'login-pin':
            return loginPinHandler(req, res);
        case 'login':
            return loginHandler(req, res);
        case 'logout':
            return logoutHandler(req, res);
        case 'notes':
            return notesHandler(req, res);
        case 'ai':
            return aiHandler(req, res);
        case 'telegram-webhook':
            return telegramWebhookHandler(req, res);
        case 'track':
            return trackHandler(req, res);
        case 'upload':
        case 'image':
            return uploadHandler(req, res);
        default:
            return res.status(404).json({ error: `API route '${route}' not found` });
    }
};