const express = require('express');
const router  = express.Router();
const { generateToken } = require('../middleware/auth');

// POST /api/auth/login
router.post('/login', (req, res) => {
    const { password } = req.body;
    if (!password || password !== process.env.APP_PASSWORD) {
        return res.status(401).json({ ok: false, error: 'كلمة المرور غير صحيحة' });
    }
    const token = generateToken();
    res.json({ ok: true, token });
});

// GET /api/auth/verify
router.get('/verify', require('../middleware/auth').requireAuth, (req, res) => {
    res.json({ ok: true, authenticated: true });
});

module.exports = router;
