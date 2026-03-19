const express = require('express');
const router  = express.Router();
const { requireAuth }   = require('../middleware/auth');
const { supabase }      = require('../services/supabase');
const { generate }      = require('../services/ai');

// GET /api/library/refs
router.get('/refs', requireAuth, async (req, res) => {
    const { data, error } = await supabase.from('references_lib').select('id,name,type,char_count,word_count,style_analysis,created_at').order('id', { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, refs: data || [] });
});

// POST /api/library/refs — إضافة مرجع
router.post('/refs', requireAuth, async (req, res) => {
    const { name, type = 'novel', content } = req.body;
    if (!name || !content) return res.status(400).json({ ok: false, error: 'الاسم والمحتوى مطلوبان' });
    const { data, error } = await supabase.from('references_lib').insert({
        name, type, content, char_count: content.length, word_count: content.split(/\s+/).length,
    }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, ref: data });
});

// POST /api/library/analyze/:id
router.post('/analyze/:id', requireAuth, async (req, res) => {
    const { data: ref, error } = await supabase.from('references_lib').select('id,name,content').eq('id', req.params.id).single();
    if (error || !ref) return res.status(404).json({ ok: false, error: 'المرجع غير موجود' });

    const text   = ref.content;
    const sample = text.substring(0, 3000) + (text.length > 7000 ? '\n...\n' + text.substring(Math.floor(text.length/2), Math.floor(text.length/2)+2000) : '');

    const prompt = `أنت ناقد أدبي. حلّل الأسلوب الأدبي للنص. أجب بـ JSON فقط:
{"style_summary":"...","sentence_structure":"...","dialogue_style":"...","pacing":"...","vocabulary":"...","unique_features":["..."],"prompt_instruction":"تعليمات للنموذج AI في جملتين"}

النص:
"""
${sample}
"""`;

    const result = await generate(prompt, { max_tokens: 800 });
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });

    // استخرج JSON
    let analysis;
    try {
        const text  = result.text.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
        const start = text.indexOf('{');
        const end   = text.lastIndexOf('}');
        analysis    = JSON.parse(text.substring(start, end + 1));
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'فشل تحليل الاستجابة' });
    }

    await supabase.from('references_lib').update({ style_analysis: JSON.stringify(analysis) }).eq('id', req.params.id);
    res.json({ ok: true, analysis });
});

// POST /api/library/activate/:id — تفعيل بصمة
router.post('/activate/:id', requireAuth, async (req, res) => {
    const { data: ref } = await supabase.from('references_lib').select('name,style_analysis').eq('id', req.params.id).single();
    if (!ref?.style_analysis) return res.status(400).json({ ok: false, error: 'حلّل الأسلوب أولاً' });

    const analysis = JSON.parse(ref.style_analysis);
    const profile  = analysis.prompt_instruction || analysis.style_summary || '';
    if (!profile)  return res.status(400).json({ ok: false, error: 'التحليل غير مكتمل' });

    await supabase.from('style_profiles').update({ is_active: false }).neq('id', 0);
    await supabase.from('style_profiles').insert({ name: ref.name, source: 'references_lib', profile, is_active: true });
    res.json({ ok: true, profile });
});

// GET /api/library/prompts
router.get('/prompts', requireAuth, async (req, res) => {
    const { data, error } = await supabase.from('custom_prompts').select('*').order('id', { ascending: false });
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, prompts: data || [] });
});

// POST /api/library/prompts
router.post('/prompts', requireAuth, async (req, res) => {
    const { name, category = 'عام', prompt_text } = req.body;
    if (!name || !prompt_text) return res.status(400).json({ ok: false, error: 'الاسم والنص مطلوبان' });
    const { data, error } = await supabase.from('custom_prompts').insert({ name, category, prompt_text }).select().single();
    if (error) return res.status(500).json({ ok: false, error: error.message });
    res.json({ ok: true, prompt: data });
});

// POST /api/library/research
router.post('/research', requireAuth, async (req, res) => {
    const { topic } = req.body;
    if (!topic) return res.status(400).json({ ok: false, error: 'الموضوع مطلوب' });

    const prompt = `أنت باحث أدبي. اجمع معلومات مفيدة عن "${topic}" لاستخدامها في الكتابة الروائية العربية. قدم: خلفية الموضوع، تفاصيل حسية، أمثلة روائية، الجانب النفسي. 500-700 كلمة.`;
    const result = await generate(prompt, { max_tokens: 1200 });
    if (!result.ok) return res.status(500).json({ ok: false, error: result.error });

    // حفظ كمرجع
    const { data } = await supabase.from('references_lib').insert({
        name: `بحث: ${topic.substring(0, 80)}`,
        type: 'web_research',
        content: result.text,
        char_count: result.text.length,
    }).select().single();

    res.json({ ok: true, content: result.text, id: data?.id });
});

// DELETE /api/library/refs/:id
router.delete('/refs/:id', requireAuth, async (req, res) => {
    await supabase.from('references_lib').delete().eq('id', req.params.id);
    res.json({ ok: true });
});

// DELETE /api/library/prompts/:id
router.delete('/prompts/:id', requireAuth, async (req, res) => {
    await supabase.from('custom_prompts').delete().eq('id', req.params.id);
    res.json({ ok: true });
});

module.exports = router;
