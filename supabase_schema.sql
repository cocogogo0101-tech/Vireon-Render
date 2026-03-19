-- ============================================================
--  Story Engine — Supabase Schema
--  شغّل هذا في Supabase SQL Editor
-- ============================================================

-- ── chapters ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chapters (
    id              BIGSERIAL PRIMARY KEY,
    chapter_num     INTEGER UNIQUE NOT NULL,
    title           TEXT DEFAULT '',
    summary         TEXT DEFAULT '',
    content         TEXT DEFAULT '',
    genre           TEXT DEFAULT 'واقعي',
    goal            TEXT DEFAULT '',
    char_count      INTEGER DEFAULT 0,
    ai_provider     TEXT DEFAULT 'gemini',
    prompt_meta     JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── characters ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS characters (
    id                          BIGSERIAL PRIMARY KEY,
    name                        TEXT NOT NULL,
    role                        TEXT DEFAULT '',
    status                      TEXT DEFAULT 'alive' CHECK (status IN ('alive','dead','unknown')),
    notes                       TEXT DEFAULT '',
    first_appearance_chapter    INTEGER DEFAULT 1,
    last_seen_chapter           INTEGER,
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

-- ── config ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
    id          BIGSERIAL PRIMARY KEY,
    key         TEXT UNIQUE NOT NULL,
    value       TEXT DEFAULT '',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── references_lib ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS references_lib (
    id                  BIGSERIAL PRIMARY KEY,
    name                TEXT NOT NULL,
    type                TEXT DEFAULT 'novel',
    original_filename   TEXT DEFAULT '',
    content             TEXT,
    style_analysis      JSONB,
    word_count          INTEGER DEFAULT 0,
    char_count          INTEGER DEFAULT 0,
    is_active           BOOLEAN DEFAULT true,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── style_profiles ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS style_profiles (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    source      TEXT DEFAULT '',
    profile     TEXT,
    is_active   BOOLEAN DEFAULT false,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── custom_prompts ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_prompts (
    id          BIGSERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    category    TEXT DEFAULT 'عام',
    prompt_text TEXT,
    usage_count INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── wizard_sessions ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wizard_sessions (
    id           BIGSERIAL PRIMARY KEY,
    session_key  TEXT UNIQUE NOT NULL,
    step         SMALLINT DEFAULT 1,
    concept      TEXT,
    characters   TEXT,
    chapter_plan TEXT,
    status       TEXT DEFAULT 'in_progress',
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── generation_log ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS generation_log (
    id          BIGSERIAL PRIMARY KEY,
    chapter_num INTEGER,
    provider    TEXT,
    duration_ms INTEGER,
    status      TEXT DEFAULT 'success',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── إعدادات افتراضية ──────────────────────────────────────────
INSERT INTO config (key, value) VALUES
    ('novel_title',         'روايتي'),
    ('default_genre',       'واقعي'),
    ('author_style',        ''),
    ('default_min_chars',   '2000'),
    ('default_max_chars',   '8000'),
    ('chapter_plan',        ''),
    ('wizard_novel_meta',   '')
ON CONFLICT (key) DO NOTHING;

-- ── Indexes للأداء ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_chapters_num ON chapters(chapter_num);
CREATE INDEX IF NOT EXISTS idx_chars_status ON characters(status);
CREATE INDEX IF NOT EXISTS idx_config_key   ON config(key);

-- ── تعطيل RLS (للاستخدام الشخصي — Backend فقط) ───────────────
-- ملاحظة: نستخدم Service Role Key في الـ Backend فيتجاوز RLS تلقائياً
-- لكن نعطّله صراحةً لتبسيط الأمر
ALTER TABLE chapters         DISABLE ROW LEVEL SECURITY;
ALTER TABLE characters       DISABLE ROW LEVEL SECURITY;
ALTER TABLE config           DISABLE ROW LEVEL SECURITY;
ALTER TABLE references_lib   DISABLE ROW LEVEL SECURITY;
ALTER TABLE style_profiles   DISABLE ROW LEVEL SECURITY;
ALTER TABLE custom_prompts   DISABLE ROW LEVEL SECURITY;
ALTER TABLE wizard_sessions  DISABLE ROW LEVEL SECURITY;
ALTER TABLE generation_log   DISABLE ROW LEVEL SECURITY;
