// ============================================================
//  Story Engine v2 — lib/db.js
//  Supabase client wrapper
// ============================================================
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { persistSession: false } }
);

// ── مساعد: جلب إعداد ─────────────────────────────────────────
async function getConfig(key, defaultVal = '') {
    const { data } = await supabase
        .from('config')
        .select('value')
        .eq('key', key)
        .single();
    return data ? data.value : defaultVal;
}

// ── مساعد: حفظ إعداد ─────────────────────────────────────────
async function setConfig(key, value) {
    await supabase
        .from('config')
        .upsert({ key, value, updated_at: new Date().toISOString() },
                 { onConflict: 'key' });
}

// ── مساعد: جلب عدة إعدادات دفعة واحدة ───────────────────────
async function getConfigs(keys) {
    const { data } = await supabase
        .from('config')
        .select('key, value')
        .in('key', keys);
    const result = {};
    if (data) data.forEach(r => { result[r.key] = r.value; });
    return result;
}

// ── مساعد: ملخصات الفصول السابقة ────────────────────────────
async function getPreviousSummaries(currentChapterNum, limit = 15) {
    const { data } = await supabase
        .from('chapters')
        .select('chapter_num, title, summary')
        .lt('chapter_num', currentChapterNum)
        .not('summary', 'is', null)
        .order('chapter_num', { ascending: false })
        .limit(limit);
    if (!data || data.length === 0) return '';
    return data.reverse().map(ch => {
        const t = ch.title ? ` — ${ch.title}` : '';
        return `  الفصل ${ch.chapter_num}${t}: ${ch.summary}`;
    }).join('\n');
}

// ── مساعد: قائمة الشخصيات ────────────────────────────────────
async function getCharactersList() {
    const { data } = await supabase
        .from('characters')
        .select('name, role, status, notes')
        .order('status');
    if (!data || data.length === 0) return '';
    return data.map(c => {
        const st = c.status === 'alive' ? '(حي)' : c.status === 'dead' ? '(ميت)' : '(مجهول)';
        const note = c.notes ? ` — ${c.notes.substring(0, 80)}` : '';
        return `  • ${c.name} ${st}: ${c.role}${note}`;
    }).join('\n');
}

// ── مساعد: البصمة الأسلوبية النشطة ───────────────────────────
async function getActiveStyle() {
    const { data } = await supabase
        .from('style_profiles')
        .select('profile')
        .eq('is_active', true)
        .limit(1)
        .single();
    return data ? data.profile : '';
}

// ── مساعد: تسجيل التوليد ────────────────────────────────────
async function logGeneration(chapterNum, provider, durationMs, status, meta = {}) {
    await supabase.from('generation_log').insert({
        chapter_num: chapterNum,
        provider,
        duration_ms: durationMs,
        status,
        meta
    });
}

module.exports = {
    supabase,
    getConfig,
    setConfig,
    getConfigs,
    getPreviousSummaries,
    getCharactersList,
    getActiveStyle,
    logGeneration
};
