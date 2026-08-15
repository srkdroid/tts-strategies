const crypto = require('crypto');
const { verifyToken, verifyAdminToken, parseCookies } = require('./common/auth');
const { queryKV } = require('./common/redis');

module.exports = async (req, res) => {
    // 1. Authenticate Request (User or Admin)
    const cookies = parseCookies(req.headers.cookie);
    const sessionToken = cookies['session_token'];
    const adminToken = cookies['admin_token'];

    const userPhone = verifyToken(sessionToken);
    const isAdmin = verifyAdminToken(adminToken);

    if (!userPhone && !isAdmin) {
        return res.status(401).json({ error: 'Unauthorized: Valid member session required' });
    }

    // 2. Handle POST /api/upload (Save new image)
    if (req.method === 'POST') {
        try {
            const body = req.body || {};
            const { image, mimeType } = body;

            if (!image || typeof image !== 'string') {
                return res.status(400).json({ error: 'Image data is required' });
            }

            // Enforce max upload size (approx 1.5MB base64 payload max)
            if (image.length > 2 * 1024 * 1024) {
                return res.status(413).json({ error: 'Image exceeds maximum allowed size (1.5MB)' });
            }

            // Extract base64 payload
            const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            let rawMime = mimeType || 'image/webp';
            let rawBase64 = image;

            if (matches && matches.length === 3) {
                rawMime = matches[1];
                rawBase64 = matches[2];
            }

            // Generate unique media ID
            const imageId = 'img_' + crypto.randomBytes(12).toString('hex');
            const record = {
                id: imageId,
                mimeType: rawMime,
                data: rawBase64,
                uploadedBy: userPhone || 'admin',
                uploadedAt: new Date().toISOString()
            };

            // Store in Redis with key: media:<imageId>
            await queryKV(['SET', `media:${imageId}`, JSON.stringify(record)]);

            const imageUrl = `/api/image?id=${imageId}`;
            return res.status(200).json({
                success: true,
                id: imageId,
                url: imageUrl
            });

        } catch (err) {
            console.error('Image Upload Error:', err);
            return res.status(500).json({ error: 'Failed to save image' });
        }
    }

    // 3. Handle GET /api/image?id=... (Serve image with authentication check)
    if (req.method === 'GET') {
        try {
            let imageId = req.query ? req.query.id : null;
            if (!imageId && req.url) {
                const parsedUrl = new URL(req.url, 'http://localhost');
                imageId = parsedUrl.searchParams.get('id');
            }

            if (!imageId || !/^[A-Za-z0-9_-]+$/.test(imageId)) {
                return res.status(400).json({ error: 'Valid image ID is required' });
            }

            // Fetch from Redis
            const rawRecord = await queryKV(['GET', `media:${imageId}`]);
            if (!rawRecord) {
                return res.status(404).json({ error: 'Image not found' });
            }

            const record = typeof rawRecord === 'string' ? JSON.parse(rawRecord) : rawRecord;
            const imgBuffer = Buffer.from(record.data, 'base64');

            res.setHeader('Content-Type', record.mimeType || 'image/webp');
            res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
            return res.status(200).end(imgBuffer);

        } catch (err) {
            console.error('Image Fetch Error:', err);
            return res.status(500).json({ error: 'Failed to retrieve image' });
        }
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).json({ error: 'Method Not Allowed' });
};
