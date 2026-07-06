module.exports = (req, res) => {
    // Clear admin_token cookie from server-side by setting expiry to epoch
    res.setHeader('Set-Cookie', [
        'admin_token=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; HttpOnly; Secure; SameSite=Strict'
    ]);
    return res.status(200).json({ success: true, message: 'Admin logged out successfully' });
};
