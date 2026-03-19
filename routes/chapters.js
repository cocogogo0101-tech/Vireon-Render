const express  = require('express');
const router   = express.Router();
const { requireAuth } = require('../middleware/auth');
const { fetchAll, fetchOne, update, remove, insert } = require('../services/supabase');
const { supabase } = require('../services/supabase');

// GET /api/chapters
router.get('/', requireAuth, async (req, res) => {
    try {
        const { q, genre, page = 1, per_page = 20 } = req.query;
        let query = supabase
            .from('chapters')
            .select('id, chapter_num, title, summary, genre, char_count, ai_provider, created_at')
            .order('chapter_num', { ascending: true });

        if (q)     query = query.or(`title.ilike.%${q}%,summary.ilike.%${q}%`);
        if (genre) query = query.eq('genre', genre);

        const from = (parseInt(page) - 1) * parseInt(per_page);
        const to   = from + parseInt(per_page) - 1;
        query      = query.range(from, to);

        const { data, error, count } = await query;
        if (error) throw new Error(error.message);

        res.json({ ok: true, chapters: data || [], total: count });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/chapters/:id
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('chapters')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) throw new Error(error.message);
        if (!data) return res.status(404).json({ ok: false, error: 'الفصل غير موجود' });

        // الفصل السابق والتالي
        const [prev, next] = await Promise.all([
            supabase.from('chapters').select('id,chapter_num,title').lt('chapter_num', data.chapter_num).order('chapter_num', { ascending: false }).limit(1).single(),
            supabase.from('chapters').select('id,chapter_num,title').gt('chapter_num', data.chapter_num).order('chapter_num', { ascending: true }).limit(1).single(),
        ]);

        res.json({
            ok: true,
            chapter: data,
            prev: prev.data || null,
            next: next.data || null,
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// PUT /api/chapters/:id
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const { title, summary, content } = req.body;
        const updates = {};
        if (title   !== undefined) updates.title   = title;
        if (summary !== undefined) updates.summary = summary;
        if (content !== undefined) { updates.content = content; updates.char_count = content.length; }
        updates.updated_at = new Date().toISOString();

        const { data, error } = await supabase.from('chapters').update(updates).eq('id', req.params.id).select().single();
        if (error) throw new Error(error.message);
        res.json({ ok: true, chapter: data });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// DELETE /api/chapters/:id
router.delete('/:id', requireAuth, async (req, res) => {
    try {
        const { error } = await supabase.from('chapters').delete().eq('id', req.params.id);
        if (error) throw new Error(error.message);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// GET /api/chapters/stats/overview
router.get('/stats/overview', requireAuth, async (req, res) => {
    try {
        const [chaptersData, charsData] = await Promise.all([
            supabase.from('chapters').select('char_count, genre, created_at, ai_provider'),
            supabase.from('characters').select('status'),
        ]);

        const chapters   = chaptersData.data || [];
        const characters = charsData.data    || [];
        const totalChars = chapters.reduce((s, c) => s + (c.char_count || 0), 0);

        res.json({
            ok:              true,
            chapters_count:  chapters.length,
            total_chars:     totalChars,
            characters_count: characters.length,
            alive_count:     characters.filter(c => c.status === 'alive').length,
            dead_count:      characters.filter(c => c.status === 'dead').length,
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
