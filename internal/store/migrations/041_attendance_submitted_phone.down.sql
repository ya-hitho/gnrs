-- SQLite cannot DROP COLUMN here; rebuild the table to the post-039 shape
-- (alfa CHECK + sesi_id) without submitted_phone, then recreate the indexes.
DROP INDEX IF EXISTS idx_attendances_sesi;
DROP INDEX IF EXISTS idx_attendances_status;
DROP INDEX IF EXISTS idx_attendances_teacher_date;
DROP INDEX IF EXISTS idx_attendances_student_date;
DROP INDEX IF EXISTS idx_attendances_date;

CREATE TABLE attendances_new (
  id           TEXT PRIMARY KEY,
  date         DATE NOT NULL,
  duration_min INTEGER,
  teacher_id   TEXT NOT NULL,
  student_id   TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('hadir','izin_murid','izin_guru','by_vn','alfa')),
  materi       TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sesi_id      TEXT
);

INSERT INTO attendances_new
  SELECT id, date, duration_min, teacher_id, student_id, status, materi,
         created_at, updated_at, sesi_id
    FROM attendances;

DROP TABLE attendances;
ALTER TABLE attendances_new RENAME TO attendances;

CREATE INDEX idx_attendances_date         ON attendances(date);
CREATE INDEX idx_attendances_student_date ON attendances(student_id, date);
CREATE INDEX idx_attendances_teacher_date ON attendances(teacher_id, date);
CREATE INDEX idx_attendances_status       ON attendances(status);
CREATE INDEX idx_attendances_sesi         ON attendances(sesi_id);
