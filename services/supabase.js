// ============================================================
//  Story Engine — services/supabase.js
//  اتصال Supabase (PostgreSQL)
// ============================================================
const { createClient } = require('@supabase/supabase-js');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_URL و SUPABASE_SERVICE_KEY مطلوبان في .env');
    process.exit(1);
}

// Service Role Key — للعمليات الداخلية (backend فقط، لا تشاركه)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    {
        auth: { autoRefreshToken: false, persistSession: false },
        db:   { schema: 'public' },
    }
);

// ── دوال مساعدة ──────────────────────────────────────────────

// جلب صف واحد
async function fetchOne(table, filters = {}, select = '*') {
    let query = supabase.from(table).select(select);
    for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val);
    }
    const { data, error } = await query.limit(1).single();
    if (error && error.code !== 'PGRST116') throw new Error(error.message);
    return data || null;
}

// جلب كل الصفوف
async function fetchAll(table, filters = {}, select = '*', order = null) {
    let query = supabase.from(table).select(select);
    for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val);
    }
    if (order) query = query.order(order.col, { ascending: order.asc ?? true });
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
}

// إدراج صف
async function insert(table, values) {
    const { data, error } = await supabase.from(table).insert(values).select().single();
    if (error) throw new Error(error.message);
    return data;
}

// تحديث صفوف
async function update(table, filters, values) {
    let query = supabase.from(table).update(values);
    for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val);
    }
    const { data, error } = await query.select();
    if (error) throw new Error(error.message);
    return data;
}

// Upsert (insert أو update)
async function upsert(table, values, onConflict = 'id') {
    const { data, error } = await supabase
        .from(table)
        .upsert(values, { onConflict })
        .select()
        .single();
    if (error) throw new Error(error.message);
    return data;
}

// حذف
async function remove(table, filters) {
    let query = supabase.from(table).delete();
    for (const [col, val] of Object.entries(filters)) {
        query = query.eq(col, val);
    }
    const { error } = await query;
    if (error) throw new Error(error.message);
    return true;
}

// جلب إعداد من جدول config
async function getConfig(key, defaultVal = '') {
    try {
        const row = await fetchOne('config', { key });
        return row ? row.value : defaultVal;
    } catch (e) {
        return defaultVal;
    }
}

// حفظ إعداد
async function setConfig(key, value) {
    const { error } = await supabase
        .from('config')
        .upsert({ key, value }, { onConflict: 'key' });
    if (error) throw new Error(error.message);
    return true;
}

// استعلام خام (SQL)
async function rawQuery(sql, params = []) {
    const { data, error } = await supabase.rpc('execute_sql', { sql_query: sql, params });
    if (error) throw new Error(error.message);
    return data;
}

module.exports = {
    supabase,
    fetchOne,
    fetchAll,
    insert,
    update,
    upsert,
    remove,
    getConfig,
    setConfig,
};
