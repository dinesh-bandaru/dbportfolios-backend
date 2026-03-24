-- Lessons table for multi-video course support
CREATE TABLE IF NOT EXISTS lessons (
    id TEXT PRIMARY KEY,
    stream_video_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    duration_seconds REAL,
    created_at TEXT DEFAULT (datetime('now'))
);
