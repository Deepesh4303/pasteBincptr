-- ==============================================================================
-- Cloudflare D1 Database Schema for cptr.in / pastebin
-- Execute using:
--   wrangler d1 execute pastebin-db --file=./schema.sql
-- Or paste directly into Cloudflare Dashboard -> Workers & D1 -> D1 -> Console
-- ==============================================================================

CREATE TABLE IF NOT EXISTS pastes (
    hash TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT,
    burn_after_read INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pastes_hash ON pastes(hash);
