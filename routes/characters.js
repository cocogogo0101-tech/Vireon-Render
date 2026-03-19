// characters.js
const express  = require('express');
const router   = express.Router();
const { requireAuth } = require('../middleware/auth');
const { supabase }    = require('../services/supabase');

router.get('/', requireAuth, async (req, res) => {
    const { data, error } = await supabase.from('characters').select('*').order('status').order('first_appearance_chapter');
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, characters: data || [] });
});

router.post('/', requireAuth, async (req, res) => {
    const { name, role, status = 'alive', notes = '', first_appearance_chapter = 1 } = req.body;
    if (!name) return res.status(400).json({ ok: false, error: 'الاسم مطلوب' });
    const { data, error } = await supabase.from('characters').insert({ name, role, status, notes, first_appearance_chapter }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, character: data });
});

router.put('/:id', requireAuth, async (req, res) => {
    const { name, role, status, notes, first_appearance_chapter } = req.body;
    const updates = {};
    if (name !== undefined) updates.name = name;
    if (role !== undefined) updates.role = role;
    if (status !== undefined) updates.status = status;
    if (notes !== undefined) updates.notes = notes;
    if (first_appearance_chapter !== undefined) updates.first_appearance_chapter = first_appearance_chapter;
    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('characters').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, character: data });
});

router.delete('/:id', requireAuth, async (req, res) => {
    const { error } = await supabase.from('characters').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true });
});

module.exports = router;
