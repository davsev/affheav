const express = require('express');
const router = express.Router();
const { refreshToken } = require('../services/facebook');

// POST /api/facebook/refresh-token
router.post('/refresh-token', async (req, res) => {
  try {
    const result = await refreshToken();
    const expiresAt = result.expires_in
      ? new Date(Date.now() + result.expires_in * 1000).toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' })
      : 'unknown';
    res.json({
      success: true,
      access_token: result.access_token,
      expires_in: result.expires_in,
      expires_at: expiresAt,
      note: 'Copy the access_token above into your .env FACEBOOK_ACCESS_TOKEN and restart the server.',
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
