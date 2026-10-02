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
    let route = req.query ? req.query.route : null;
    if (!route) {
        try {
            const host = (req.headers && req.headers.host) ? req.headers.host : 'localhost';
            const urlObj = new URL(req.url || '', `http://${host}`);
            route = urlObj.pathname.replace(/^\/api\/?/, '');
        } catch (e) {
            route = '';
        }
    }

    if (route === 'admin' || (typeof route === 'string' && route.startsWith('admin'))) {
        return adminHandler(req, res);
    }

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