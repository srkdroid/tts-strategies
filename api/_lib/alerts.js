/**
 * PnL Alerts Engine API Handler
 * 
 * Routes:
 * - GET /api/alerts?action=telemetry  -> Returns live worker telemetry & market hours state
 * - POST /api/alerts?action=evaluate  -> Triggers an alert evaluation cycle (admin or cron authenticated)
 */

const { queryKVSafe } = require('./common/redis');
const { parseCookies, verifyAdminToken } = require('./common/auth');
const { evaluateAlertsCycle, isMarketOpenNow, getISTDateComponents } = require('./alert-worker');
const { getUpstoxConfig, maskToken } = require('./upstox');

module.exports = async (req, res) => {
    try {
        let isAdmin = false;
        try {
            const cookies = parseCookies(req);
            if (cookies && cookies['admin_token']) {
                isAdmin = Boolean(verifyAdminToken(cookies['admin_token']));
            }
        } catch (authErr) {
            isAdmin = false;
        }

        const authHeader = req.headers['authorization'] || '';
        const cronSecret = process.env.CRON_SECRET || process.env.ADMIN_PASSWORD;
        const isCronAuthorized = Boolean(cronSecret && (
            authHeader === `Bearer ${cronSecret}` ||
            authHeader === cronSecret ||
            req.query?.secret === cronSecret
        ));

        const action = req.query?.action || (req.body && req.body.action) || 'status';

        // 1. GET /api/alerts -> Return live telemetry & market hours status
        if (req.method === 'GET') {
            const telemetryRaw = await queryKVSafe(['GET', 'system:alert_worker_telemetry']);
            let telemetry = null;
            if (telemetryRaw) {
                telemetry = typeof telemetryRaw === 'string' ? JSON.parse(telemetryRaw) : telemetryRaw;
            }

            const marketStatus = isMarketOpenNow();
            const istTime = getISTDateComponents();
            const config = await getUpstoxConfig();

            return res.status(200).json({
                success: true,
                marketStatus,
                istTime: {
                    dateStr: istTime.dateStr,
                    time: `${String(istTime.hours).padStart(2, '0')}:${String(istTime.minutes).padStart(2, '0')}:${String(istTime.seconds).padStart(2, '0')} IST`
                },
                config: {
                    hasToken: Boolean(config.token),
                    tokenMasked: maskToken(config.token),
                    pollInterval: config.pollInterval,
                    telegramAlertsEnabled: config.telegramAlertsEnabled !== false,
                    marketHoursOnly: config.marketHoursOnly !== false
                },
                telemetry: telemetry || { status: 'STANDBY', message: 'No evaluation cycles executed yet.' }
            });
        }

        // 2. POST /api/alerts -> Trigger evaluation cycle
        if (req.method === 'POST') {
            if (!isAdmin && !isCronAuthorized) {
                return res.status(401).json({ error: 'Unauthorized. Admin credentials or CRON_SECRET required.' });
            }

            const force = req.query?.force === 'true' || (req.body && req.body.force === true);

            const result = await evaluateAlertsCycle({ force });
            return res.status(200).json({
                success: true,
                triggeredBy: isAdmin ? 'ADMIN' : 'CRON',
                result
            });
        }

        return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (err) {
        console.error('[AlertAPI] Uncaught Handler Error:', err);
        return res.status(500).json({
            success: false,
            error: err.message || 'Internal Server Error'
        });
    }
};
