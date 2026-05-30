-- Drop the CHECK constraint on kelompok by rebuilding the table without it.

DROP INDEX IF EXISTS idx_students_status;
DROP INDEX IF EXISTS idx_students_kelompok;
DROP INDEX IF EXISTS idx_students_level;
DROP INDEX IF EXISTS idx_students_name;

CREATE TABLE students_new_005d (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  nickname      TEXT,
  date_of_birth DATE,
  level         TEXT CHECK (level IS NULL OR level IN ('Caberawit','Pra Remaja','Remaja','Pra Nikah')),
  kelompok      TEXT,
  joined_at     DATE,
  left_at       DATE,
  leave_reason  TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','left')),
  parent_name   TEXT,
  parent_phone  TEXT,
  parent_email  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO students_new_005d SELECT * FROM students;
DROP TABLE students;
ALTER TABLE students_new_005d RENAME TO students;

CREATE INDEX idx_students_name     ON students(name);
CREATE INDEX idx_students_level    ON students(level);
CREATE INDEX idx_students_kelompok ON students(kelompok);
CREATE INDEX idx_students_status   ON students(status);
