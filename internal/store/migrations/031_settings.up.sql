-- 031 — Global settings (key-value) table.
--
-- Used for branding (instansi name + logo data-URL) and any future
-- single-row configuration that doesn't deserve its own table.

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
);

-- Default brand suffix mirrors the previous hard-coded "US".
INSERT INTO settings (key, value) VALUES ('instansi_name', 'US')
ON CONFLICT DO NOTHING;
