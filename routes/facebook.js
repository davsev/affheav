const express = require('express');
const router = express.Router();
const { refreshToken, getTokenInfo } = require('../services/facebook');
const { getSubjects } = require('../services/googleSheets');

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

// GET /api/facebook/token-info?subjectId=xxx  — check token for a specific niche
// GET /api/facebook/token-info                 — check global token from .env
router.get('/token-info', async (req, res) => {
  try {
    let credentials = {};
    if (req.query.subjectId) {
      const subjects = await getSubjects();
      const subject = subjects.find(s => s.id === req.query.subjectId);
      if (!subject) return res.status(404).json({ success: false, error: 'Subject not found' });
      credentials = {
        facebookToken:     subject.facebookToken,
        facebookAppId:     subject.facebookAppId,
        facebookAppSecret: subject.facebookAppSecret,
      };
    }
    const info = await getTokenInfo(credentials);
    res.json({ success: true, ...info });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
