const { verifyToken, verifyAdminToken, parseCookies } = require('./common/auth');
const { queryKVSafe: queryKV } = require('./common/redis');

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const cookies = parseCookies(req.headers.cookie);
        const phone = verifyToken(cookies['session_token']);
        const isAdmin = verifyAdminToken(cookies['admin_token']);

        if (isAdmin || !phone || phone === 'Admin' || (phone && phone.toLowerCase() === 'admin')) {
            // Admin activity logging is not required
            return res.status(200).json({ success: true, skipped: true });
        }

        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }
        body = body || {};

        const eventType = body.eventType || 'PAGE_VIEW';
        const details = body.details || '';
        const meta = body.meta || {};

        const logEntry = {
            id: `act_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            phone: phone,
            eventType: eventType,
            details: details,
            meta: meta,
            timestamp: new Date().toISOString()
        };

        const logStr = JSON.stringify(logEntry);

        // Store in Upstash Redis List user_activity_logs (capped at 2000 entries)
        await queryKV(['LPUSH', 'user_activity_logs', logStr]);
        await queryKV(['LTRIM', 'user_activity_logs', 0, 1999]);

        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Tracking API error:', err);
        return res.status(500).json({ error: 'Failed to record tracking event' });
    }
};
