-- Widen the users.role enum to admit sitrac-v3 roles (pengurus/guru/ortu/murid)
-- and add a soft-disable `active` flag for managing accounts without deletion.
-- SQLite can't ALTER a CHECK constraint, so we rebuild the table.

DROP INDEX IF EXISTS idx_users_username;

CREATE TABLE users_new_007 (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  username    TEXT,
  password    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff'
              CHECK (role IN ('admin','staff','pengurus','guru','ortu','murid')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new_007 (id, email, username, password, name, role, active, created_at, updated_at)
  SELECT id, email, username, password, name, role, 1, created_at, updated_at
    FROM users;

DROP TABLE users;
ALTER TABLE users_new_007 RENAME TO users;

CREATE UNIQUE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_active ON users(active);
