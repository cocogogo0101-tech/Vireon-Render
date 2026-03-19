// ============================================================
//  Story Engine v2 — routes/data.js
//  Chapters, Characters, Settings, Wizard, Library
// ============================================================
const express = require('express');
const router  = express.Router();
const { supabase, getConfig, setConfig, getConfigs } = require('../lib/db');
const { generate }  = require('../lib/ai');
const { getGenres } = require('../lib/prompt');

// ════════════════════════════════════════════════════════════
//  CHAPTERS
// ════════════════════════════════════════════════════════════
router.get('/chapters', async (req, res) => {
    const { data, error } = await supabase
        .from('chapters')
        .select('id,chapter_num,title,summary,genre,char_count,ai_provider,created_at')
        .order('chapter_num');
    res.json({ ok: !error, data: data || [], error: error?.message });
});

router.get('/chapters/:id', async (req, res) => {
    const { data, error } = await supabase
        .from('chapters')
        .select('*')
        .eq('id', req.params.id)
        .single();
    res.json({ ok: !error, data, error: error?.message });
});

router.put('/chapters/:id', async (req, res) => {
    const { title, summary, content } = req.body;
    const { data, error } = await supabase
        .from('chapters')
        .update({ title, summary, content, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();
    res.json({ ok: !error, data, error: error?.message });
});

router.delete('/chapters/:id', async (req, res) => {
    const { error } = await supabase.from('chapters').delete().eq('id', req.params.id);
    res.json({ ok: !error, error: error?.message });
});

// ════════════════════════════════════════════════════════════
//  CHARACTERS
// ════════════════════════════════════════════════════════════
router.get('/characters', async (req, res) => {
    const { data, error } = await supabase
        .from('characters')
        .select('*')
        .order('status')
        .order('first_appearance_chapter');
    res.json({ ok: !error, data: data || [], error: error?.message });
});

router.post('/characters', async (req, res) => {
    const { name, role='', status='alive', notes='', first_appearance_chapter=1 } = req.body;
    if (!name) return res.json({ ok:false, error:'الاسم مطلوب' });
    const { data, error } = await supabase
        .from('characters')
        .insert({ name, role, status, notes, first_appearance_chapter })
        .select()
        .single();
    res.json({ ok: !error, data, error: error?.message });
});

router.put('/characters/:id', async (req, res) => {
    const { name, role, status, notes, first_appearance_chapter } = req.body;
    const { data, error } = await supabase
        .from('characters')
        .update({ name, role, status, notes, first_appearance_chapter, updated_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .select()
        .single();
    res.json({ ok: !error, data, error: error?.message });
});

router.delete('/characters/:id', async (req, res) => {
    const { error } = await supabase.from('characters').delete().eq('id', req.params.id);
    res.json({ ok: !error, error: error?.message });
});

// ════════════════════════════════════════════════════════════
//  SETTINGS & CONFIG
// ════════════════════════════════════════════════════════════
router.get('/settings', async (req, res) => {
    const cfg = await getConfigs([
        'novel_title','author_style','default_genre','default_min_chars',
        'default_max_chars','active_provider','gemini_model','openai_model','anthropic_model'
    ]);
    res.json({ ok: true, data: cfg, genres: getGenres() });
});

router.post('/settings', async (req, res) => {
    const allowed = [
        'novel_title','author_style','default_genre','default_min_chars',
        'default_max_chars','active_provider','gemini_model','openai_model','anthropic_model'
    ];
    try {
        for (const key of allowed) {
            if (req.body[key] !== undefined) await setConfig(key, String(req.body[key]));
        }
        res.json({ ok: true, msg: 'تم الحفظ' });
    } catch(e) {
        res.json({ ok: false, error: e.message });
    }
});

// اختبار AI
router.post('/test-ai', async (req, res) => {
    const provider = req.body.provider || 'gemini';
    const result = await generate('قل "مرحبا" فقط.', { provider, maxTokens: 20, useCache: false });
    res.json({ ok: result.ok, provider, response: result.text?.substring(0,50), error: result.error });
});

// ════════════════════════════════════════════════════════════
//  STATS (للداشبورد)
// ════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
    const [chapters, characters, config] = await Promise.all([
        supabase.from('chapters').select('id, char_count, chapter_num', { count: 'exact' }),
        supabase.from('characters').select('id, status', { count: 'exact' }),
        getConfigs(['novel_title','active_provider'])
    ]);

    const totalChars = (chapters.data || []).reduce((s, c) => s + (c.char_count || 0), 0);
    const lastChapter = chapters.data?.length ? Math.max(...chapters.data.map(c => c.chapter_num)) : 0;
    const alive = (characters.data || []).filter(c => c.status === 'alive').length;
    const dead  = (characters.data || []).filter(c => c.status === 'dead').length;

    res.json({
        ok: true,
        chapters_count:    chapters.count || 0,
        characters_count:  characters.count || 0,
        total_chars:       totalChars,
        last_chapter:      lastChapter,
        next_chapter:      lastChapter + 1,
        alive_count:       alive,
        dead_count:        dead,
        novel_title:       config.novel_title || 'روايتي',
        active_provider:   config.active_provider || 'gemini',
    });
});

// ════════════════════════════════════════════════════════════
//  LIBRARY
// ════════════════════════════════════════════════════════════
router.get('/library/refs', async (req, res) => {
    const { data, error } = await supabase
        .from('references_lib')
        .select('id,name,type,char_count,style_analysis,created_at')
        .order('id', { ascending: false });
    res.json({ ok: !error, data: data||[] });
});

router.post('/library/refs', async (req, res) => {
    const { name, type='novel', content } = req.body;
    if (!content) return res.json({ ok:false, error:'المحتوى مطلوب' });
    const { data, error } = await supabase
        .from('references_lib')
        .insert({ name: name||'مرجع جديد', type, content, char_count: content.length })
        .select()
        .single();
    res.json({ ok: !error, data, error: error?.message });
});

router.post('/library/analyze/:id', async (req, res) => {
    const { data: ref } = await supabase.from('references_lib').select('*').eq('id', req.params.id).single();
    if (!ref) return res.json({ ok:false, error:'المرجع غير موجود' });

    const sample = ref.content.substring(0, 3000);
    const prompt = `أنت ناقد أدبي. حلّل الأسلوب للنص. أجب بـ JSON فقط:
{"style_summary":"ملخص الأسلوب","sentence_structure":"بنية الجمل","pacing":"الإيقاع","unique_features":["ميزة"],"prompt_instruction":"تعليم للنموذج AI لمحاكاة هذا الأسلوب"}

النص: ${sample}`;

    const result = await generate(prompt, { maxTokens: 600 });
    if (!result.ok) return res.json({ ok:false, error: result.error });

    let analysis = null;
    try {
        const m = result.text.match(/\{[\s\S]*\}/);
        if (m) analysis = JSON.parse(m[0]);
    } catch(_) {}

    if (!analysis) return res.json({ ok:false, error:'فشل تحليل الاستجابة' });

    await supabase.from('references_lib').update({ style_analysis: analysis }).eq('id', req.params.id);
    res.json({ ok:true, analysis });
});

router.post('/library/activate-style/:id', async (req, res) => {
    const { data: ref } = await supabase.from('references_lib').select('name,style_analysis').eq('id', req.params.id).single();
    if (!ref?.style_analysis) return res.json({ ok:false, error:'حلّل الأسلوب أولاً' });

    const profile = ref.style_analysis.prompt_instruction || ref.style_analysis.style_summary || '';
    await supabase.from('style_profiles').update({ is_active: false }).neq('id', 0);
    await supabase.from('style_profiles').insert({ name: ref.name, source:'references_lib', profile, is_active:true });
    res.json({ ok:true, msg:'تم التفعيل', profile });
});

router.get('/library/prompts', async (req, res) => {
    const { data } = await supabase.from('custom_prompts').select('*').order('id', {ascending:false});
    res.json({ ok:true, data: data||[] });
});

router.post('/library/prompts', async (req, res) => {
    const { name, category='عام', prompt_text } = req.body;
    if (!name || !prompt_text) return res.json({ ok:false, error:'الاسم والنص مطلوبان' });
    const { data, error } = await supabase.from('custom_prompts').insert({ name, category, prompt_text }).select().single();
    res.json({ ok:!error, data, error: error?.message });
});

router.delete('/library/:table/:id', async (req, res) => {
    const allowed = ['references_lib','custom_prompts','style_profiles'];
    if (!allowed.includes(req.params.table)) return res.json({ ok:false, error:'غير مسموح' });
    const { error } = await supabase.from(req.params.table).delete().eq('id', req.params.id);
    res.json({ ok: !error, error: error?.message });
});

router.post('/library/research', async (req, res) => {
    const { topic } = req.body;
    if (!topic) return res.json({ ok:false, error:'أدخل الموضوع' });

    const prompt = `باحث أدبي. اجمع معلومات مفيدة عن "${topic}" للكتابة الروائية العربية. اكتب 400-600 كلمة: خلفية، تفاصيل حسية، أمثلة، الجانب النفسي، نصائح للكتابة.`;
    const result = await generate(prompt, { maxTokens: 1200 });
    if (!result.ok) return res.json({ ok:false, error: result.error });

    const { data } = await supabase.from('references_lib').insert({
        name: `بحث: ${topic.substring(0,100)}`, type:'web_research',
        content: result.text, char_count: result.text.length
    }).select().single();

    res.json({ ok:true, content: result.text, id: data?.id });
});

// ════════════════════════════════════════════════════════════
//  WIZARD
// ════════════════════════════════════════════════════════════
router.post('/wizard/step1', async (req, res) => {
    const { seed_idea, chapter_count=20 } = req.body;
    if (!seed_idea) return res.json({ ok:false, error:'أدخل فكرة' });

    const prompt = `أنت مستشار أدبي. من الفكرة التالية ولّد تصوراً لرواية عربية (${chapter_count} فصل).
فكرة: ${seed_idea}
أجب بـ JSON فقط (بدون أي نص خارجه):
{"novel_title":"","genre":"واقعي","tagline":"","narrative_style":"","time_setting":"","main_theme":"","plot_summary":"","act_1":"","act_2":"","act_3":"","tone":"","unique_element":"","author_style_notes":""}`;

    const result = await generate(prompt, { maxTokens: 1500, useCache: false });
    if (!result.ok) return res.json({ ok:false, error: result.error });

    let concept = null;
    try { const m = result.text.match(/\{[\s\S]*\}/); if(m) concept = JSON.parse(m[0]); } catch(_){}
    if (!concept) return res.json({ ok:false, error:'فشل تحليل الاستجابة' });

    const sessionKey = Math.random().toString(36).substring(2) + Date.now().toString(36);
    await supabase.from('wizard_sessions').insert({ session_key:sessionKey, step:1, concept });

    res.json({ ok:true, session_key:sessionKey, concept });
});

router.post('/wizard/step2', async (req, res) => {
    const { session_key, user_edits={} } = req.body;
    const { data:sess } = await supabase.from('wizard_sessions').select('*').eq('session_key', session_key).single();
    if (!sess) return res.json({ ok:false, error:'الجلسة غير موجودة' });

    const concept = { ...sess.concept, ...user_edits };

    const prompt = `روائي خبير. بناءً على الرواية: "${concept.novel_title}" (${concept.genre})
الحبكة: ${concept.plot_summary}
أنشئ 5-8 شخصيات. أجب بـ JSON فقط:
{"characters":[{"name":"","role":"","age":"","status":"alive","personality":"","motivation":"","arc":"","is_main":true,"first_appearance_chapter":1}]}`;

    const result = await generate(prompt, { maxTokens: 2000, useCache:false });
    if (!result.ok) return res.json({ ok:false, error: result.error });

    let chars = null;
    try { const m = result.text.match(/\{[\s\S]*\}/); if(m) chars = JSON.parse(m[0]); } catch(_){}
    if (!chars?.characters) return res.json({ ok:false, error:'فشل تحليل الشخصيات' });

    await supabase.from('wizard_sessions').update({ step:2, concept, characters:chars }).eq('session_key', session_key);
    res.json({ ok:true, session_key, characters:chars.characters, concept });
});

router.post('/wizard/step3', async (req, res) => {
    const { session_key, chapter_count=20, user_edits={} } = req.body;
    const { data:sess } = await supabase.from('wizard_sessions').select('*').eq('session_key', session_key).single();
    if (!sess) return res.json({ ok:false, error:'الجلسة غير موجودة' });

    const concept = { ...sess.concept };
    const chars   = user_edits.characters || sess.characters?.characters || [];

    const charList = chars.slice(0,6).map(c => `- ${c.name}: ${c.role}`).join('\n');
    const prompt = `مخطط روائي. ولّد خطة ${chapter_count} فصل لرواية "${concept.novel_title}".
الحبكة: ${concept.plot_summary}
الشخصيات: ${charList}
أجب بـ JSON فقط:
{"chapter_plan":[{"chapter_num":1,"title":"","goal":"","arc":"act_1","tone":"","ends_with":""}]}`;

    const result = await generate(prompt, { maxTokens:3000, useCache:false });
    if (!result.ok) return res.json({ ok:false, error: result.error });

    let plan = null;
    try { const m = result.text.match(/\{[\s\S]*\}/); if(m) plan = JSON.parse(m[0]); } catch(_){}
    if (!plan?.chapter_plan) return res.json({ ok:false, error:'فشل تحليل الخطة' });

    // حفظ كل شيء
    const novelFields = [
        ['novel_title', concept.novel_title||''],
        ['default_genre', concept.genre||'واقعي'],
        ['author_style', concept.author_style_notes||''],
        ['chapter_plan', JSON.stringify(plan.chapter_plan)],
    ];
    for (const [k,v] of novelFields) {
        await supabase.from('config').upsert({ key:k, value:v }, { onConflict:'key' });
    }

    // حفظ الشخصيات
    await supabase.from('characters').delete().neq('id', 0);
    for (const c of chars) {
        await supabase.from('characters').insert({
            name:c.name, role:c.role||'', status:c.status||'alive',
            notes:`الشخصية: ${c.personality||''} | الدافع: ${c.motivation||''} | المسار: ${c.arc||''}`,
            first_appearance_chapter: c.first_appearance_chapter||1
        });
    }

    await supabase.from('wizard_sessions').update({ step:3, chapter_plan:plan, status:'completed' }).eq('session_key', session_key);

    res.json({ ok:true, chapter_plan: plan.chapter_plan, saved: ['إعدادات الرواية', `${chars.length} شخصية`, `${plan.chapter_plan.length} فصل مخطط`] });
});

// ════════════════════════════════════════════════════════════
//  EXPORT
// ════════════════════════════════════════════════════════════
router.get('/export/txt', async (req, res) => {
    const { from=1, to=9999, type='full' } = req.query;
    const { data:chapters } = await supabase.from('chapters').select('*').gte('chapter_num',from).lte('chapter_num',to).order('chapter_num');

    if (type === 'summaries') {
        const text = (chapters||[]).map(c => `الفصل ${c.chapter_num}: ${c.title||''}\n${c.summary||''}\n`).join('\n---\n');
        res.setHeader('Content-Type','text/plain;charset=utf-8');
        res.setHeader('Content-Disposition','attachment;filename=summaries.txt');
        return res.send(text);
    }

    const novelTitle = await getConfig('novel_title','رواية');
    let output = `${novelTitle}\n${'═'.repeat(40)}\n\n`;
    for (const ch of (chapters||[])) {
        output += `\n\nالفصل ${ch.chapter_num}${ch.title ? ': '+ch.title : ''}\n${'─'.repeat(40)}\n\n`;
        output += ch.content || '';
        if (ch.summary) output += `\n\n── ملخص: ${ch.summary}`;
    }
    res.setHeader('Content-Type','text/plain;charset=utf-8');
    res.setHeader('Content-Disposition',`attachment;filename="${encodeURIComponent(novelTitle)}.txt"`);
    res.send(output);
});

module.exports = router;
