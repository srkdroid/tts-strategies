/**
 * Shared Telegram Bot Messaging Client
 */

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

async function sendTelegramMessage(chatId, text, replyMarkup = null) {
    if (!BOT_TOKEN) {
        console.warn("[Telegram] TELEGRAM_BOT_TOKEN environment variable not configured.");
        return;
    }
    const body = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown'
    };
    if (replyMarkup) {
        body.reply_markup = replyMarkup;
    }
    try {
        const resp = await fetch(`${TELEGRAM_API}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            const errTxt = await resp.text();
            console.warn(`[Telegram] sendMessage failed (HTTP ${resp.status}): ${errTxt}`);
        }
    } catch (e) {
        console.error("[Telegram] Failed to send telegram message:", e.message);
    }
}

module.exports = {
    sendTelegramMessage
};
