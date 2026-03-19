const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');
const { supabase, getConfig } = require('../services/supabase');

// GET /api/export/txt?type=full|summaries|range&from=1&to=20
router.get('/txt', requireAuth, async (req, res) => {
    const { type = 'full', from = 1, to = 999 } = req.query;
    const novelTitle = await getConfig('novel_title', 'رواية');

    let query = supabase.from('chapters').select('chapter_num,title,content,summary,genre').order('chapter_num');
    if (type === 'range') query = query.gte('chapter_num', parseInt(from)).lte('chapter_num', parseInt(to));

    const { data: chapters, error } = await query;
    if (error) return res.status(500).json({ ok: false, error: error.message });

    let output = '';
    const dt   = new Date().toLocaleDateString('ar-SA');

    if (type === 'summaries') {
        output = `ملخصات ${novelTitle}\n${'─'.repeat(40)}\n\n`;
        for (const ch of chapters) {
            output += `الفصل ${ch.chapter_num}${ch.title ? ': ' + ch.title : ''}\n`;
            output += (ch.summary || 'لا يوجد ملخص') + '\n\n';
        }
    } else {
        output = `${'═'.repeat(50)}\n  ${novelTitle}\n  تصدير — ${dt}\n  ${chapters.length} فصل\n${'═'.repeat(50)}\n`;
        for (const ch of chapters) {
            output += `\n\n${'─'.repeat(50)}\nالفصل ${ch.chapter_num}${ch.title ? ': ' + ch.title : ''}\n${'─'.repeat(50)}\n\n`;
            output += ch.content || '[لا يوجد محتوى]';
            if (ch.summary) output += `\n\n── ملخص: ${ch.summary}`;
        }
    }

    const safeName = novelTitle.replace(/[^\u0600-\u06FFa-zA-Z0-9_\- ]/g, '').substring(0, 50);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(safeName)}.txt"`);
    res.send(output);
});

// GET /api/export/json — تصدير JSON كامل
router.get('/json', requireAuth, async (req, res) => {
    const [chapters, characters, config] = await Promise.all([
        supabase.from('chapters').select('*').order('chapter_num'),
        supabase.from('characters').select('*'),
        supabase.from('config').select('key, value'),
    ]);

    res.json({
        ok:         true,
        exported_at: new Date().toISOString(),
        chapters:   chapters.data || [],
        characters: characters.data || [],
        config:     (config.data || []).reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {}),
    });
});

module.exports = router;
