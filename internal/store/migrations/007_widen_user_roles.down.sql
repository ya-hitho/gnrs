DROP INDEX IF EXISTS idx_users_active;
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_users_username;

CREATE TABLE users_new_007d (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL UNIQUE,
  username    TEXT,
  password    TEXT NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO users_new_007d (id, email, username, password, name, role, created_at, updated_at)
  SELECT id, email, username, password, name, role, created_at, updated_at
    FROM users
   WHERE role IN ('admin','staff');

DROP TABLE users;
ALTER TABLE users_new_007d RENAME TO users;

CREATE UNIQUE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;
