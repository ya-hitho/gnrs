# Database schema

Authoritative reference for the PostgreSQL schema served by the gnrs app. Migrations
live in [`internal/store/migrations/`](../internal/store/migrations/) — they are
the **source of truth** and run on every server boot via `store.Migrate` (see
`internal/store/store.go`, which wraps [golang-migrate](https://github.com/golang-migrate/migrate)
over the embedded `migrations/*.sql` files). This document mirrors the live
schema after the most recent migration (`040_pencapaian_library`).

> **Ported from SQLite to PostgreSQL.** The app originally ran on SQLite; the
> migrations and store were ported to PostgreSQL (`jackc/pgx/v5`). Column types
> map as `DATETIME` → `TIMESTAMPTZ`, the `strftime('%Y-%m-%dT%H:%M:%fZ','now')`
> defaults → `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
> and integer-boolean columns stay `INTEGER`. Several historical migrations note
> "SQLite cannot ALTER a CHECK" — that explains *why* a table-rebuild shape exists;
> the ported migrations keep the rebuild but recreate the table under a temporary
> name to avoid PostgreSQL constraint-name collisions.

The defining feature of this schema is its **single unified `users` table**. Every
person in the system — admin, staff, pengurus, guru (teacher), ortu (parent), and
murid (student) — is one row in `users`. There is no separate `students` or
`teachers` table: the old ones were folded into `users` by migration 008 and
dropped, and `model.Student` / `model.Teacher` are now read-only **projection
views** over `users` (rows where `role = 'murid'` / `role = 'guru'`). Almost every
cross-table reference to a person (`attendances.teacher_id`, `sesi.guru_id`,
`kelas.guru_user_id`, `pencapaian.murid_user_id`, …) is an **informal TEXT link
with no database foreign key**, deliberately, so a person can be soft-removed
without cascading or breaking historical rows.

## Tables at a glance

| Table | Purpose |
|---|---|
| [`users`](#users) | The single identity + profile table for **every** person (admin/staff/pengurus/guru/ortu/murid). Auth fields + a large shared/role-specific profile block. |
| [`tingkat`](#tingkat) | Curriculum level/age lookup (`materi_ajar.tingkat` joins it by name). |
| [`materi_ajar`](#materi_ajar) | The master curriculum catalog — one teachable item per row. |
| [`materi_library_ref`](#materi_library_ref) | Structured link from a `materi_ajar` to library content (quran/hadits/tilawati/doa). |
| [`materi_relation`](#materi_relation) | Symmetric graph of the same content at different age levels. |
| [`attendances`](#attendances) | Kehadiran log — one row per teaching encounter (teacher × student × date). No FK to `users`. |
| [`bacaan_log`](#bacaan_log) | Kontrol Bacaan — per-user log of Qur'an ayat ranges read. |
| [`kelas`](#kelas) | A classroom: a named group of murid under a `tingkat` for one year. |
| [`kelas_anggota`](#kelas_anggota) | Membership join: which murid belongs to which kelas. |
| [`kelas_guru`](#kelas_guru) | Many-guru-per-kelas join (the primary/wali guru still lives on `kelas.guru_user_id`). |
| [`sesi`](#sesi) | One scheduled / live class session — the kehadiran-calendar + Live-Stage unit. |
| [`sesi_materi`](#sesi_materi) | Multi-kurikulum-materi join for a sesi. |
| [`sesi_library`](#sesi_library) | Multi-library-ref join for a sesi (FK → `sesi`). |
| [`sesi_materi_diajarkan`](#sesi_materi_diajarkan) | Audit log of materi actually taught during a live sesi (FK → `sesi`). |
| [`tahun_ajaran`](#tahun_ajaran) | Academic-year row + semester-month math; exactly one `active` (app-enforced). |
| [`rencana_bulanan`](#rencana_bulanan) | A monthly teaching plan for one kelas. |
| [`rencana_bulanan_item`](#rencana_bulanan_item) | One planned slot inside a `rencana_bulanan` (kurikulum **or** library). |
| [`pencapaian`](#pencapaian) | Per-murid mastery state for one achievable item (kurikulum **or** library). |
| [`hadits_kitab`](#hadits_kitab) | Hadits library — book (kitab) tier. |
| [`hadits_bab`](#hadits_bab) | Hadits library — chapter (bab) tier. |
| [`hadits`](#hadits) | Hadits library — individual hadith (leaf). |
| [`quran_manqul_note`](#quran_manqul_note) | Per-user *manqul* note on a Qur'an word/ayah. |
| [`compact_ajar`](#compact_ajar--the-doa-library) | The **Doa** / hafalan / asmaul-husna library (no table literally named `doa`). |
| [`karakter_luhur`](#karakter_luhur) | Editable catalog of *karakter luhur* (noble-character) items. |
| [`settings`](#settings) | Global key/value config (branding: instansi name + logo). |
| [`schema_migrations`](#schema_migrations) | Internal bookkeeping for golang-migrate. Never edited by hand. |

## Entity relationship

The schema is centered on the unified `users` table. Nothing has a foreign key
*into* `users`; every person-reference is an informal TEXT id resolved with a
`LEFT JOIN users` (and `COALESCE(name, id)` so a soft-removed person still
displays). The only real FKs in the whole schema point at `sesi`.

```
                          ┌───────────────────────────────────────────────┐
                          │                    users                       │
                          │  ONE row per person; role ∈ {admin, staff,     │
                          │  pengurus, guru, ortu, murid}                  │
                          │                                                │
                          │   role='murid' ──► model.Student projection    │
                          │   role='guru'  ──► model.Teacher projection    │
                          └───────────────────────────────────────────────┘
                                   ▲  (all links below are INFORMAL — no DB FK)
        ┌──────────────────────────┼───────────────┬───────────────┬──────────────┐
        │                          │               │               │              │
 attendances                 sesi.guru_id     kelas.guru_user_id  bacaan_log   pencapaian
 .teacher_id / .student_id   sesi.created_by  kelas_guru.guru_   .user_id /    .murid_user_id /
 (NO FK; soft-removal safe)  (NO FK)            user_id          .recorded_by  .recorded_by
        │                          │          kelas_anggota.       (NO FK)      (NO FK)
        │ .sesi_id ──► sesi        │            murid_user_id
        │  (NO FK)                 │          (all NO FK)
        ▼                          ▼
   ┌──────────┐   ┌──────────────────────────────────────────────────────────┐
   │ historical│  │                          sesi                              │
   │ importer  │  │  scheduled/live session (kehadiran calendar + Live Stage)  │
   └──────────┘  └──────────────────────────────────────────────────────────┘
                    ▲ kelas_id (NO FK)        ▲ REAL FK            ▲ REAL FK
                    │                         │ ON DELETE CASCADE  │ ON DELETE CASCADE
                  kelas                  sesi_library        sesi_materi_diajarkan
                    │ (informal links)   sesi_materi (NO FK)
                    ▼
              rencana_bulanan ──► rencana_bulanan_item   (informal kelas_id / rencana_id)

  Curriculum catalog (informal links, by name/id):
     tingkat ──(by name)── materi_ajar ──┬── materi_library_ref ──► library content
                                         └── materi_relation (symmetric, canonical a<b)

  Library catalogs (seeded, shared; informal/no-FK internally):
     hadits_kitab ◄── hadits_bab ◄── hadits        compact_ajar (Doa)     quran_manqul_note
     karakter_luhur (self-grouped by `parent` text column)

  Standalone:  tahun_ajaran   settings   schema_migrations
```

Key relationships, restated:

- **No FK into `users`.** `attendances.teacher_id` / `attendances.student_id`,
  `sesi.guru_id` / `sesi.created_by`, `kelas.guru_user_id`,
  `kelas_guru.guru_user_id`, `kelas_anggota.murid_user_id`,
  `bacaan_log.user_id` / `bacaan_log.recorded_by`, `pencapaian.murid_user_id` /
  `pencapaian.recorded_by`, and `quran_manqul_note.user_id` all reference
  `users.id` **informally** so a person can be soft-disabled (`active = 0`,
  `membership_status` `left`/`retired`) without orphaning or blocking history.
  The guru-role requirement on `sesi.guru_id` / `kelas.guru_user_id` is enforced
  at the handler layer, not by a DB constraint.
- **Projections, not tables.** Generus (Student) = `users` row where
  `role = 'murid'`; Pengajar (Teacher) = `users` row where `role = 'guru'`.
  `model.Student` / `model.Teacher` re-map a subset of `User` columns to the
  legacy `/api/students` and `/api/teachers` JSON contract. `Teacher.RetiredAt`
  reads `users.left_at`; both projections' `status` map onto the single
  `users.membership_status` column.
- **The only real FKs** are `sesi_library.sesi_id → sesi(id)`,
  `sesi_materi_diajarkan.sesi_id → sesi(id)` (both `ON DELETE CASCADE`).
  Every other cross-table reference is informal.
- **`kelas.tahun` is a plain INTEGER**, *not* a FK to `tahun_ajaran` — the two
  were added independently (014 before 021) and are never joined.

## Conventions

| Convention | Detail |
|---|---|
| One unified identity table | A single `users` table holds **every** person. `Student` (`role='murid'`) and `Teacher` (`role='guru'`) are Go projection structs over `users`, not separate tables. The role boundary is enforced in store facades (`WHERE … role='murid'`/`'guru'`), not in SQL. |
| Primary keys | `id TEXT PRIMARY KEY`, app-generated **ULIDs** (lexicographically time-ordered) on nearly every table. Exceptions: `settings` uses the natural string `key`; `schema_migrations` uses a numeric `version`; some join tables use composite PKs and `materi_relation` has no surrogate id. |
| Timestamps | Most tables carry `created_at` (+ usually `updated_at`). Older auth/attendance tables use `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`; the curriculum/session/library tables use `TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))` (ISO-8601 UTC millis). The app writes `time.Now().UTC()` explicitly on insert/update. |
| Enum-shaped columns | Stored as `TEXT` with a `CHECK (col IN (…))` constraint (or `INTEGER … CHECK (col IN (0,1))` for booleans). Stored values are canonical/English/Indonesian; UI labels are localized separately. SQLite cannot `ALTER` a CHECK, so widening one requires a rename-rebuild-copy-drop (e.g. 007, 039, 040). |
| App-only enums | Some columns are enum-shaped only in application code, with **no SQL CHECK**: `users.kelompok`, `sesi.library_kind`/`library_aspect`/`live_display_mode`, `rencana_bulanan_item.library_kind`. Invalid values are rejected by Go/the frontend, not by SQLite. |
| No FK on person references | `attendances`, `sesi`, `kelas*`, `bacaan_log`, `pencapaian`, and `quran_manqul_note` reference `users.id` **without a foreign key** — deliberate, for soft removal. Queries `LEFT JOIN users` and `COALESCE(name, id)`. |
| Soft delete | People are never physically deleted in normal operation: set `active = 0` and/or `membership_status` to `left` (murid) / `retired` (guru). The no-FK design keeps their historical rows resolving. |
| Connection / driver | `store.Open(DATABASE_URL)` opens a PostgreSQL pool via `jackc/pgx/v5/stdlib`, wrapped in a thin `database/sql` driver that rewrites the store's SQLite-style `?` placeholders to `$1, $2, …` ordinals. The pool allows concurrent connections (`SetMaxOpenConns(20)`); PostgreSQL has no single-writer limit. |

---

## `users`

Central identity + profile table for **every** person in the system — admins,
staff, pengurus, guru (teachers), ortu (parents), and murid (students). Each row
is one account. Auth fields (`email`, `username`, `password`, `role`, `active`)
gate login; the large profile block below them is filled in mostly for guru and
murid. Rows are written by the admin/pengurus management UI (Pengajar / Generus
pages) and by the boot-time data migration in `main.go`, which copied the legacy
`students` / `teachers` rows into `users` (with bcrypt-hashed passwords) when
migration 008 ran. Accounts are soft-disabled via `active = 0` and membership
lifecycle is tracked via `membership_status` / `left_at` rather than row deletion,
so historical attendances keep resolving. The original separate `students` and
`teachers` tables were renamed to `*_legacy_008` and then dropped after the copy.

```sql
-- CANONICAL final shape after migrations 001 -> 040.
-- Built by 001 (id/email/password/name/role + timestamps),
-- 002 (username), rebuilt by 007 (widen role enum + active),
-- columns added by 008 / 011 / 013 / 020 / 034. SQLite cannot ALTER a
-- CHECK constraint, so 007 did a RENAME-rebuild-copy-drop; everything
-- after 007 is a plain ADD COLUMN, so the live table is this single shape.
CREATE TABLE users (
  -- Auth / identity
  id          TEXT PRIMARY KEY,                       -- ULID
  email       TEXT NOT NULL UNIQUE,
  username    TEXT,                                    -- unique when non-NULL (partial index)
  password    TEXT NOT NULL,                           -- bcrypt hash
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'staff'
              CHECK (role IN ('admin','staff','pengurus','guru','ortu','murid')),
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),  -- 0 = soft-disabled

  -- Shared profile (all nullable)
  nickname      TEXT,
  date_of_birth DATE,
  gender        TEXT CHECK (gender IS NULL OR gender IN ('male','female')),
  no_hp         TEXT,                                  -- phone number
  alamat        TEXT,                                  -- address
  kelompok      TEXT,                                  -- group; NO sql CHECK (validated in app)

  -- Murid-only
  level         TEXT CHECK (level IS NULL OR level IN ('Caberawit','Pra Remaja','Remaja','Pra Nikah')),
  parent_name   TEXT,
  parent_phone  TEXT,
  parent_email  TEXT,

  -- Guru-only
  desa          TEXT,                                  -- village
  daerah        TEXT,                                  -- region
  notes         TEXT,

  -- Membership lifecycle
  joined_at         DATE,
  left_at           DATE,
  leave_reason      TEXT,
  membership_status TEXT NOT NULL DEFAULT 'active'
                    CHECK (membership_status IN ('active','left','retired')),

  -- Photo (011): filename relative to $PHOTOS_DIR; served at /api/files/photos/<photo_path>
  photo_path TEXT,

  -- Timezone (013): IANA tz name, e.g. 'Asia/Jakarta'; NULL/empty -> app default
  timezone TEXT,

  -- Taaruf-style biodata extensions (020)
  user_code    TEXT,                                   -- admin-curated display id, unique when non-NULL
  tempat_lahir TEXT,                                   -- birth place
  pendidikan   TEXT,                                   -- last education
  pekerjaan    TEXT,                                   -- occupation
  urutan       INTEGER NOT NULL DEFAULT 0,             -- manual sort order (lower = first)
  hide_dob     INTEGER NOT NULL DEFAULT 0,             -- 1 -> non-admin callers get dateOfBirth=null
  tgl_daftar   TEXT,                                   -- registration date (distinct from joined_at)

  -- Parent contact for WhatsApp summaries (034)
  parent_title        TEXT,                            -- sebutan: Bapak / Ibu / Ayahnya ...
  parent_phone_region TEXT CHECK (parent_phone_region IS NULL OR parent_phone_region IN ('ID','SG','US','CA')),

  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_users_username          ON users(username)  WHERE username  IS NOT NULL;  -- 002 (recreated by 007)
CREATE INDEX        idx_users_role              ON users(role);            -- 007
CREATE INDEX        idx_users_active            ON users(active);          -- 007
CREATE INDEX        idx_users_kelompok          ON users(kelompok);        -- 008
CREATE INDEX        idx_users_level             ON users(level);           -- 008
CREATE INDEX        idx_users_membership_status ON users(membership_status); -- 008
CREATE UNIQUE INDEX idx_users_user_code         ON users(user_code) WHERE user_code IS NOT NULL;  -- 020
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, NOT NULL, PRIMARY KEY | ULID string. Referenced informally as teacher/student/guru id by `attendances`, `kelas`, `sesi`, etc. — **no DB foreign key** (see relationships). |
| `email` | TEXT, NOT NULL, UNIQUE | Login identifier. |
| `username` | TEXT, nullable, UNIQUE-when-non-NULL | Added in 002. Alternate login (`WHERE email = ? OR username = ?`). Partial unique index allows many NULLs. |
| `password` | TEXT, NOT NULL | bcrypt hash. Never serialized (`json:"-"`). |
| `name` | TEXT, NOT NULL | Full display name. |
| `role` | TEXT, NOT NULL, DEFAULT 'staff', CHECK | One of `admin`, `staff`, `pengurus`, `guru`, `ortu`, `murid`. 001 allowed only `admin`/`staff`; 007 widened the enum. |
| `active` | INTEGER, NOT NULL, DEFAULT 1, CHECK (0,1) | Boolean soft-disable flag (added 007). 0 = account disabled but not deleted. |
| `nickname` | TEXT, nullable | Shared profile (008). |
| `date_of_birth` | DATE, nullable | Shared profile (008). Hidden from non-admin callers when `hide_dob = 1`. |
| `gender` | TEXT, nullable, CHECK | `male` / `female` or NULL (008). Migration 030 deterministically backfilled NULL/'' for `role='guru'` rows (odd hex last char of id -> female, else male). |
| `no_hp` | TEXT, nullable | Phone number (008). |
| `alamat` | TEXT, nullable | Address (008). |
| `kelompok` | TEXT, nullable | Group. **No SQL CHECK** — valid values (`California`, `Chicago`, `New Hampshire`, `Canada`) are enforced only in Go (`model.StudentKelompoks`) and the frontend. |
| `level` | TEXT, nullable, CHECK | Murid level: `Caberawit`, `Pra Remaja`, `Remaja`, `Pra Nikah` (008). |
| `parent_name` | TEXT, nullable | Murid's parent name (008). |
| `parent_phone` | TEXT, nullable | Murid's parent phone (008). |
| `parent_email` | TEXT, nullable | Murid's parent email (008). |
| `desa` | TEXT, nullable | Guru village (008). |
| `daerah` | TEXT, nullable | Guru region (008). |
| `notes` | TEXT, nullable | Guru free-form notes (008). |
| `joined_at` | DATE, nullable | Membership start in PPG curriculum (008). |
| `left_at` | DATE, nullable | Date murid left / guru retired (008). |
| `leave_reason` | TEXT, nullable | Reason for leaving (008). |
| `membership_status` | TEXT, NOT NULL, DEFAULT 'active', CHECK | `active` (ongoing), `left` (murid keluar), `retired` (guru purna). Unified replacement for old per-role status enums (008). |
| `photo_path` | TEXT, nullable | Photo filename relative to $PHOTOS_DIR; served via `/api/files/photos/<photo_path>`; NULL = no photo (011). |
| `timezone` | TEXT, nullable | IANA tz name (e.g. `Asia/Jakarta`); NULL/empty -> app default; used by Kehadiran calendar (013). |
| `user_code` | TEXT, nullable, UNIQUE-when-non-NULL | Admin-curated display id (e.g. `CKR-001`) (020). Partial unique index. |
| `tempat_lahir` | TEXT, nullable | Birth place (020). |
| `pendidikan` | TEXT, nullable | Last education (020). |
| `pekerjaan` | TEXT, nullable | Occupation (020). |
| `urutan` | INTEGER, NOT NULL, DEFAULT 0 | Manual sort order within lists; lower = first (020). |
| `hide_dob` | INTEGER, NOT NULL, DEFAULT 0 | Boolean; when 1, non-admin/PNKB callers receive `dateOfBirth = null` (020). |
| `tgl_daftar` | TEXT, nullable | Registration date, distinct from `joined_at` (020). Stored TEXT, scanned as nullable time in Go. |
| `parent_title` | TEXT, nullable | Free-form sebutan (Bapak/Ibu/...) for WhatsApp summary (034). |
| `parent_phone_region` | TEXT, nullable, CHECK | `ID`, `SG`, `US`, `CA`; combined with `parent_phone` to build E.164 wa.me links (034). |
| `created_at` | DATETIME, NOT NULL, DEFAULT CURRENT_TIMESTAMP | Row creation. |
| `updated_at` | DATETIME, NOT NULL, DEFAULT CURRENT_TIMESTAMP | Last update (set explicitly by store on UPDATE). |

### Auth fields vs profile fields

The Go `User` struct (`internal/model/model.go`) and the store column list
(`internal/store/users.go`, `userColumns`) group the columns the same way the
schema does:

- **Auth / identity (required):** `id`, `email`, `username`, `password`, `name`, `role`, `active`.
- **Shared profile (nullable):** `nickname`, `date_of_birth`, `gender`, `no_hp`, `alamat`, `kelompok`.
- **Murid-only:** `level`, `parent_name`, `parent_title`, `parent_phone`, `parent_phone_region`, `parent_email`.
- **Guru-only:** `desa`, `daerah`, `notes`.
- **Membership lifecycle:** `joined_at`, `left_at`, `leave_reason`, `membership_status`.
- **Media / locale:** `photo_path` (+ derived `photoUrl` in API), `timezone`.
- **Taaruf biodata extensions:** `user_code`, `tempat_lahir`, `pendidikan`, `pekerjaan`, `urutan`, `hide_dob`, `tgl_daftar`.

The legacy `/api/students` and `/api/teachers` endpoints are served by
`model.Student` / `model.Teacher` projection structs over `users` (they re-map
field names, e.g. Teacher exposes `retiredAt`/`status` instead of
`left_at`/`membership_status`) to preserve the original ppg.fadhil.id JSON
contract.

### Migration history for `users`

| # | Migration | What it did | Why |
|---|---|---|---|
| 001 | `001_init` | Created `users(id, email, password, name, role DEFAULT 'staff' CHECK IN('admin','staff'), created_at, updated_at)`. Also created the (now-gone) `students` table. | Initial auth table. |
| 002 | `002_add_username` | `ADD COLUMN username TEXT`; partial unique index `idx_users_username` (WHERE username IS NOT NULL). | Allow login by username. |
| 007 | `007_widen_user_roles` | **Table rebuild** (RENAME to `users_old_007`, CREATE new, copy, DROP old). Widened `role` CHECK to `admin/staff/pengurus/guru/ortu/murid`; added `active INTEGER NOT NULL DEFAULT 1 CHECK(0,1)`. Recreated `idx_users_username`; added `idx_users_role`, `idx_users_active`. | SQLite can't ALTER a CHECK; needed extended roles + soft-disable. Existing rows copied with `active = 1`. |
| 008 | `008_unify_user_profile` | Added 17 profile columns: `nickname, date_of_birth, gender(CHECK), no_hp, alamat, kelompok, level(CHECK), parent_name, parent_phone, parent_email, desa, daerah, notes, joined_at, left_at, leave_reason, membership_status(NOT NULL DEFAULT 'active' CHECK)`. Added `idx_users_kelompok`, `idx_users_level`, `idx_users_membership_status`. Renamed `students`->`students_legacy_008`, `teachers`->`teachers_legacy_008`. | Unify guru/murid profile into one User entity; legacy tables kept for the boot-time copy in main.go, then dropped. |
| 011 | `011_user_photo` | `ADD COLUMN photo_path TEXT`. | Profile photos served from $PHOTOS_DIR. |
| 013 | `013_user_timezone` | `ADD COLUMN timezone TEXT`. | Render Kehadiran calendar in user's local zone. |
| 020 | `020_user_taaruf_fields` | Added `user_code` (+ partial unique `idx_users_user_code`), `tempat_lahir`, `pendidikan`, `pekerjaan`, `urutan INTEGER NOT NULL DEFAULT 0`, `hide_dob INTEGER NOT NULL DEFAULT 0`, `tgl_daftar TEXT`. | Taaruf-app-style biodata fields. |
| 030 | `030_pengajar_gender_backfill` | Data-only `UPDATE`: deterministically set `gender` for `role='guru'` rows with NULL/'' gender (last hex digit of id seeds female/male). | Populate the Dashboard "Pengajar aktif per Jenis Kelamin" pie chart; idempotent. |
| 034 | `034_user_parent_meta` | Added `parent_title TEXT`, `parent_phone_region TEXT CHECK IN('ID','SG','US','CA')`. | Build E.164 wa.me deep links for parent WhatsApp summaries. |

(Migrations 003–006 and 009–040 not listed above do not touch `users`. 003/004/005/006 modified the old separate `teachers`/`students` tables that 008 superseded; 010 touches `tingkat`, see below; 012/014/024/032 reference `users.id` informally but add no `users` columns or FKs.)

---

## Roster model — Generus & Pengajar (projections over `users`)

In gnrs there is **no longer a standalone `students` table or `teachers` table**.
The original `students` (migration 001) and `teachers` (migration 003) tables
were merged into the single `users` table by **migration 008
(`008_unify_user_profile`)** and then **dropped** at boot (the boot-time data
migration in `main.go` copies the renamed legacy rows into `users` with
bcrypt-hashed passwords, then drops the legacy tables). Because they were unified,
**there is no current standalone `students`/`teachers` DDL to show** — the
canonical storage is `users`, and the only `students`/`teachers` shapes that
exist today are Go-level *projection views*.

`internal/model/model.go` states this explicitly:

> "Student and Teacher are projection views over User used by the existing
> `/api/students` and `/api/teachers` endpoints. … They are deliberately
> structural duplicates of the relevant subset of User fields rather than
> aliases — the JSON tag naming differs (e.g., teacher uses `RetiredAt` instead
> of `LeftAt` + retired status)."

### How the projection works

- **One physical table, two logical roles.** Every Generus is a row in `users`
  with `role = 'murid'`; every Pengajar is a row in `users` with `role = 'guru'`.
  The full role enum (CHECK on `users.role`) is
  `('admin','staff','pengurus','guru','ortu','murid')`.
- **Facades, not tables.** `internal/store/students.go` (`type Students`) and
  `internal/store/teachers.go` (`type Teachers`) are "thin facade[s] over the
  users table". Every read/write is scoped with `WHERE … role = 'murid'` (or
  `'guru'`), e.g. `Get`, `Update`, `Delete`, `List`, `Stats` all carry that
  predicate. There is no `students`/`teachers` SQL object behind them.
- **Stub auth on create.** Creating a Generus/Pengajar via these facades inserts
  a `users` row with a synthetic email `<ulid>@stub.gnrs.local`, a bcrypt hash of
  the literal password `"changeme"`, and `active = 1` — so a roster entry is a
  real (but not-yet-usable) account.
- **Preserved JSON contract.** The `model.Student` / `model.Teacher` structs (and
  the `StudentInput` / `TeacherInput` DTOs) keep the original `ppg.fadhil.id` JSON
  shape so the frontend Generus and Pengajar pages keep working unchanged after
  unification.

### Role → projection mapping

| Concept (UI / Indonesian) | Projection struct | `users.role` | Store facade (`internal/store/`) | API group |
|---|---|---|---|---|
| Generus / murid (students) | `model.Student` | `'murid'` | `students.go` (`type Students`) | `/api/students` |
| Pengajar / guru (teachers) | `model.Teacher` | `'guru'` | `teachers.go` (`type Teachers`) | `/api/teachers` |

### Status mapping (backed by `users.membership_status`)

`users.membership_status` is the unified lifecycle column added in 008:
`TEXT NOT NULL DEFAULT 'active' CHECK (membership_status IN ('active','left','retired'))`.
The two projections expose **different status enums** over this one column:

| Projection | Status enum (Go) | Stored values used | `membership_status` meaning |
|---|---|---|---|
| `model.Student` (`StudentStatus`) | `active`, `left` | `'active'`, `'left'` | `active` = masih aktif; `left` = murid keluar |
| `model.Teacher` (`TeacherStatus`) | `active`, `retired` | `'active'`, `'retired'` | `active` = masih mengajar; `retired` = guru purna |

`model.MembershipStatus` (`MembershipActive`/`MembershipLeft`/`MembershipRetired`)
is the unified superset; `StudentStatus` uses the `active`/`left` slice of it and
`TeacherStatus` uses the `active`/`retired` slice. The Teacher facade also remaps
the **departure date**: `teacher.RetiredAt` is stored in and read from
**`users.left_at`** (there is no separate `retired_at` column). `student.LeftAt`
reads the same `users.left_at` column.

### Students-vs-Teachers field differences

Both projections read from `users`, but each selects a different column subset and
renames a few fields. (`selectStudentCols` and `selectTeacherCols` in the two
store files are the source of truth.)

| Field (projection) | `users` column | Student (`murid`) | Teacher (`guru`) | Notes |
|---|---|---|---|---|
| `id` | `id` | yes | yes | ULID TEXT PK shared with `users` |
| `name` | `name` | yes | yes | required |
| `nickname` | `nickname` | yes | yes | nullable |
| `gender` | `gender` | **yes (non-pointer `string`)** | **yes (`*string`, nullable)** | Student treats gender as present; Teacher gender is optional/nullable (backfilled in 030) |
| `dateOfBirth` | `date_of_birth` | yes | **no** (not selected) | Teacher projection omits DOB |
| `level` | `level` | **yes** | **no** | murid-only; CHECK `('Caberawit','Pra Remaja','Remaja','Pra Nikah')` |
| `kelompok` | `kelompok` | yes (`*string`) | yes (non-pointer `string`) | shared column; the canonical four are `model.StudentKelompoks` (no SQL CHECK on `users`) |
| `desa` | `desa` | **no** | **yes (required in struct)** | guru-only |
| `daerah` | `daerah` | **no** | **yes (required in struct)** | guru-only |
| `notes` | `notes` | **no** | **yes** | guru-only |
| parent_* (name/title/phone/phone_region/email) | `parent_name`, `parent_title`, `parent_phone`, `parent_phone_region`, `parent_email` | **yes (all 5)** | **no** | murid-only contact block; `parent_title` + `parent_phone_region` added in 034 |
| `joinedAt` | `joined_at` | yes | yes | membership start |
| `leftAt` / `retiredAt` | `left_at` | `leftAt` | `retiredAt` (**renamed**) | same physical column, different JSON name |
| `leaveReason` | `leave_reason` | **yes** | **no** | murid-only |
| `status` | `membership_status` | `StudentStatus` (`active`/`left`) | `TeacherStatus` (`active`/`retired`) | see status mapping above |
| `photoUrl` | `photo_path` | yes | yes | filename in DB (added 011); served as `/api/files/photos/<file>` via `model.PhotoURL` |
| `createdAt` / `updatedAt` | `created_at` / `updated_at` | yes | yes | DATETIME |

Columns that exist on `users` but are **not** surfaced by either projection:
`email`, `username`, `password`, `role`, `active`, `no_hp`, `alamat`, `timezone`,
and the taaruf biodata block (`user_code`, `tempat_lahir`, `pendidikan`,
`pekerjaan`, `urutan`, `hide_dob`, `tgl_daftar`, added in 020). Those are
reachable only through the full `User`/`/api/users` surface.

### Stats differences

`Students.Stats` reports `total`, `activeTotal`, and buckets by gender, status
(`active`/`left`), level, kelompok, plus a level×kelompok matrix — all filtered
`role='murid'`. `Teachers.Stats` reports `total`, `activeTotal`, and buckets by
gender, status (`active`/`retired`), and daerah — all filtered `role='guru'`.
Both compute "active" via `membership_status = 'active'`.

### Migration history — original `students` / `teachers` lifecycle → `users`

There is **no current standalone `students` or `teachers` DDL** in the running
schema; both were folded into `users`. The tables below trace how the original
tables evolved and were finally merged. (The canonical post-040 storage is the
`users` table, documented above.)

**Original `students` table:**

| # | Migration | What it did | Why |
|---|---|---|---|
| 001 | `001_init` | Created the **original** `students` (school-dashboard shape): `student_id` (UNIQUE), `name`, `date_of_birth` (NOT NULL), `gender` CHECK `('male','female')` NOT NULL, `address`, `parent_name`/`parent_phone` (NOT NULL), `parent_email`; index `idx_students_name`. | Initial student roster, modeled like a generic school. |
| 004 | `004_redesign_students` | **Dropped and recreated** `students` around the actual PPG Generus roster: removed `student_id`/`gender`/`address`; added `nickname`, `level` CHECK `('Caberawit','Pra Remaja','Remaja','Pra Nikah')`, `kelompok` (free text), `joined_at`, `left_at`, `leave_reason`, `status` CHECK `('active','left')` DEFAULT `'active'`; made `date_of_birth` and parent fields optional. New indexes on name/level/kelompok/status. | Reshape to PPG reality (Generus), drop school-only fields. |
| 005 | `005_kelompok_enum` | Normalized free-text `kelompok` to four canonical values, then **rebuilt** the table (rename → create with `kelompok` CHECK `('California','Chicago','New Hampshire','Canada')` → copy → drop old) and recreated indexes. | Stop kelompok value drift; pin the four valid kelompoks. |
| 006 | `006_add_gender` | Re-added `gender`: `ADD COLUMN gender TEXT`, backfilled by name lists (catch-all → `'female'`), then **rebuilt** the table with `gender TEXT NOT NULL CHECK ('male','female')`; added `idx_students_gender`. | Gender needed again for reporting, now required. |
| 008 | `008_unify_user_profile` | Did **not** alter `students` columns; instead `ALTER TABLE students RENAME TO students_legacy_008`. The boot-time migration in `main.go` then copied each legacy student into `users` (`role='murid'`, bcrypt password) and **dropped** `students_legacy_008`. | Unify all people into `users`; retire the standalone table. |
| — | (post-008) | **`students` no longer exists.** Generus are `users` rows where `role='murid'`, surfaced via the `model.Student` projection. Later migrations that touch this data target `users` (e.g. 011 `photo_path`, 020 taaruf fields, 034 `parent_title`/`parent_phone_region`). | — |

**Original `teachers` table:**

| # | Migration | What it did | Why |
|---|---|---|---|
| 003 | `003_create_teachers` | Created the **original** `teachers`: `id`, `name` (NOT NULL), `nickname`, `kelompok`/`desa`/`daerah` (all NOT NULL), `joined_at`, `retired_at`, `status` CHECK `('active','retired')` DEFAULT `'active'`, `notes`; indexes on name/status/daerah/desa/kelompok. | Standalone Pengajar roster. |
| 008 | `008_unify_user_profile` | Did **not** alter `teachers` columns; `ALTER TABLE teachers RENAME TO teachers_legacy_008`. The `main.go` boot migration copied each legacy teacher into `users` (`role='guru'`, bcrypt password) — mapping `retired_at` → `users.left_at` and `status` → `users.membership_status` — and **dropped** `teachers_legacy_008`. | Unify into `users`; retire the standalone table. |
| 030 | `030_pengajar_gender_backfill` | (On `users`, not `teachers`) deterministically backfilled `gender` for `role='guru'` rows that were NULL/empty (hex-digit-of-ULID alternation; admins override later). Idempotent. | Pengajar rows predated the gender form field; needed for the dashboard pie chart. |
| — | (post-008) | **`teachers` no longer exists.** Pengajar are `users` rows where `role='guru'`, surfaced via the `model.Teacher` projection (note `RetiredAt` ↔ `users.left_at`, `status` ↔ `users.membership_status`). | — |

---

## `tingkat`

Lookup table of curriculum **levels** (part of the kurikulum subsystem).
Originally ported from sitrac-v3's `Tingkat` model as grade-based names
(PAUD/SD/SMP/SMA). Migration 010 added an `umur` (age) column; a post-seed
normalization routine (`NormalizeKurikulumAges` in `seed_kurikulum.go`) then
collapses the grade-based and English "X Years Old" rows into a single Indonesian
**age-based** set, rewriting `materi_ajar.tingkat` references in lockstep. Each
`materi_ajar` row links to a tingkat informally by **name**
(`materi_ajar.tingkat = tingkat.nama`), not by id. Has no `created_at`/`updated_at`.
Written by the seed routine and by curriculum-admin CRUD
(`Kurikulum.CreateTingkat`/`UpdateTingkat`/`DeleteTingkat`).

```sql
CREATE TABLE tingkat (
  id     TEXT PRIMARY KEY,            -- ULID
  nama   TEXT NOT NULL UNIQUE,        -- level name; materi_ajar.tingkat joins on this
  urutan INTEGER NOT NULL DEFAULT 0,  -- display sort order
  umur   INTEGER                      -- age in years (added in 010); NULL until normalized
);

CREATE INDEX idx_tingkat_urutan ON tingkat(urutan);
CREATE INDEX idx_tingkat_umur   ON tingkat(umur);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK, NOT NULL | ULID. |
| `nama` | TEXT, NOT NULL, UNIQUE | Level name. **`materi_ajar.tingkat` references this by value, not id.** `DeleteTingkat` refuses if any `materi_ajar.tingkat = nama` (returns `ErrTingkatInUse`). |
| `urutan` | INTEGER, NOT NULL, default 0 | Sort order for the level list. |
| `umur` | INTEGER, nullable | Age in years. Added in migration 010; NULL until `NormalizeKurikulumAges` populates it (and maps grade-based tingkat names to the Indonesian age-based set, updating `materi_ajar.tingkat` references in lockstep). |

### relationships

`tingkat.umur` is consumed by the kurikulum normalize routine and joined to
`materi_ajar.tingkat` (by name). It has **no relationship to `users`**.

### Migration history for `tingkat`

| # | Migration | Effect |
|---|---|---|
| 009 | `009_kurikulum` | Creates `tingkat (id, nama UNIQUE, urutan)` + `idx_tingkat_urutan`. |
| 010 | `010_tingkat_umur` | `ALTER TABLE tingkat ADD COLUMN umur INTEGER` + `idx_tingkat_umur`. App normalization later folds grade-based rows into age-based ones. (Despite its position next to user-table migrations, 010 adds a column to `tingkat`, **not** to `users`.) |

---

## `materi_ajar`

The core **curriculum item**: one teachable unit of material at a given
level/theme/semester. Ported verbatim from sitrac-v3's `MateriAjar` Prisma model,
so its writable content columns keep the original **camelCase names and are
SQL-quoted** (`"kodeMateri"`, `"subTema"`, etc.). Seeded from
`seed-data/kurikulum.sql` and editable via curriculum-admin CRUD
(`Kurikulum.CreateMateriAjar`/`UpdateMateriAjar`/`Delete*`). Booleans are stored
as INTEGER 0/1. Has **no** `created_at`/`updated_at` and **no** FKs — `tingkat` is
matched by name and `refRaportId`/`refSource*` are free-text references into the
raport/source curriculum.

```sql
CREATE TABLE materi_ajar (
  id                  TEXT PRIMARY KEY,            -- ULID
  "kodeMateri"        TEXT NOT NULL UNIQUE,        -- curriculum code, unique
  "refRaportId"       TEXT,                        -- optional link to a raport materi (free text)
  tingkat             TEXT NOT NULL,               -- level NAME (joins tingkat.nama, no FK)
  tema                TEXT NOT NULL,               -- theme
  "subTema"           TEXT NOT NULL,               -- sub-theme
  "kelompokMateri"    TEXT,                        -- optional material group
  "detailMateri"      TEXT NOT NULL,               -- the actual material detail/text
  semester            INTEGER NOT NULL,            -- 1 or 2 (not CHECK-constrained)
  kategori            TEXT NOT NULL DEFAULT 'baru'
                      CHECK (kategori IN ('baru','lanjutan','mengulang')),
  "refSourceTingkat"  TEXT,                        -- source-curriculum tingkat (free text)
  "refSourceKode"     TEXT,                        -- source-curriculum code (free text)
  "perluReviewOrtu"   INTEGER NOT NULL DEFAULT 0,  -- bool 0/1: needs parent review
  progresif           INTEGER NOT NULL DEFAULT 0,  -- bool 0/1: progressive material
  "libraryRelation"   TEXT                         -- optional free-text library relation hint
);

CREATE INDEX idx_materi_ajar_tingkat  ON materi_ajar(tingkat);
CREATE INDEX idx_materi_ajar_tema     ON materi_ajar(tema);
CREATE INDEX idx_materi_ajar_semester ON materi_ajar(semester);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK, NOT NULL | ULID. |
| `kodeMateri` | TEXT, NOT NULL, UNIQUE | Curriculum code (quoted camelCase). |
| `refRaportId` | TEXT, nullable | Optional ref to a raport materi; free text, no FK. |
| `tingkat` | TEXT, NOT NULL | Level **name** — informal link to `tingkat.nama` (no FK). Indexed. |
| `tema` | TEXT, NOT NULL | Theme. Indexed. Bulk-deletable via `DeleteByTema`. |
| `subTema` | TEXT, NOT NULL | Sub-theme (quoted). Bulk-deletable via `DeleteBySubTema(tema, subTema)`. |
| `kelompokMateri` | TEXT, nullable | Optional material grouping (quoted). |
| `detailMateri` | TEXT, NOT NULL | Material detail/body text (quoted). |
| `semester` | INTEGER, NOT NULL | 1 or 2. No CHECK constraint — value enforced only by app. Indexed. |
| `kategori` | TEXT, NOT NULL, default `'baru'`, CHECK in (`baru`,`lanjutan`,`mengulang`) | New / continuation / repeating. App defaults empty input to `baru`. |
| `refSourceTingkat` | TEXT, nullable | Source-curriculum level (quoted); free text. |
| `refSourceKode` | TEXT, nullable | Source-curriculum code (quoted); free text. |
| `perluReviewOrtu` | INTEGER, NOT NULL, default 0 | Boolean 0/1: whether material needs parent review. |
| `progresif` | INTEGER, NOT NULL, default 0 | Boolean 0/1: progressive (builds on prior) material. |
| `libraryRelation` | TEXT, nullable | Free-text hint describing a library relation (quoted). Distinct from the structured `materi_library_ref` table. |

### Migration history for `materi_ajar`

| # | Migration | Effect |
|---|---|---|
| 009 | `009_kurikulum` | Creates the table with all 15 columns above + the three indexes. **Never altered or rebuilt afterward** — the 009 shape is the final shape. |

---

## `materi_library_ref`

Structured many-to-one link from a `materi_ajar` to **library content** (a Quran
ayat range, a hadits ref, a tilawati page, or a doa). When the referenced library
item is later completed (e.g. a bacaan log is recorded for that ayat), application
logic can auto-flip the linked curriculum materi's pencapaian to `tuntas`. Written
by `Kurikulum.AddLibraryRef` (INSERT OR IGNORE on the unique tuple) and removed by
`DeleteLibraryRef`. No FK on `materi_ajar_id` or on the library target;
`library_ref` is an opaque TEXT pointer interpreted per `library_kind`. Has
`created_at` but no `updated_at`.

```sql
CREATE TABLE materi_library_ref (
  id              TEXT PRIMARY KEY,            -- ULID
  materi_ajar_id  TEXT NOT NULL,               -- informal ref to materi_ajar.id (no FK)
  library_kind    TEXT NOT NULL
                  CHECK (library_kind IN ('quran','hadits','tilawati','doa')),
  library_aspect  TEXT,                        -- optional sub-aspect
  library_ref     TEXT NOT NULL,               -- opaque pointer, meaning depends on kind
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(materi_ajar_id, library_kind, library_aspect, library_ref)
);

CREATE INDEX idx_mlr_materi  ON materi_library_ref(materi_ajar_id);
CREATE INDEX idx_mlr_library ON materi_library_ref(library_kind, library_ref);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK, NOT NULL | ULID. |
| `materi_ajar_id` | TEXT, NOT NULL | Informal ref to `materi_ajar.id` (no FK). Indexed. |
| `library_kind` | TEXT, NOT NULL, CHECK in (`quran`,`hadits`,`tilawati`,`doa`) | Which library the ref points at. |
| `library_aspect` | TEXT, nullable | Optional sub-aspect (e.g. reciting/memorizing); part of the uniqueness tuple. |
| `library_ref` | TEXT, NOT NULL | Opaque pointer; for `doa` it's a `compact_ajar.id`, for quran a surah/ayat string, etc. |
| `created_at` | TEXT, NOT NULL, default UTC ISO-8601 ms | Set on insert. No `updated_at`. |

### Migration history for `materi_library_ref`

| # | Migration | Effect |
|---|---|---|
| 029 | `029_materi_relations` | Creates the table + `idx_mlr_materi`, `idx_mlr_library`. Unchanged since. |

---

## `materi_relation`

Symmetric graph edge connecting two `materi_ajar` rows that represent the **same
content at different umur (age) levels**. Marking one materi tuntas can propagate
to its relatives (decided in application logic; the table is just the undirected
graph). The pair is stored **canonically (`materi_a_id < materi_b_id`)** —
enforced by a CHECK — so `(a,b)` and `(b,a)` can't both exist;
`AddRelation`/`DeleteRelation` swap the args to the canonical order before
writing. Composite PK on the pair, no surrogate id, no FK on either side,
`created_at` only.

```sql
CREATE TABLE materi_relation (
  materi_a_id     TEXT NOT NULL,               -- informal ref to materi_ajar.id
  materi_b_id     TEXT NOT NULL,               -- informal ref to materi_ajar.id
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (materi_a_id, materi_b_id),
  CHECK (materi_a_id < materi_b_id)            -- canonical ordering, prevents (a,b)+(b,a) dupes
);

CREATE INDEX idx_mrel_a ON materi_relation(materi_a_id);
CREATE INDEX idx_mrel_b ON materi_relation(materi_b_id);
```

| Column | Type | Notes |
|---|---|---|
| `materi_a_id` | TEXT, NOT NULL, part of PK | Informal ref to `materi_ajar.id`. Must be `< materi_b_id`. Indexed. |
| `materi_b_id` | TEXT, NOT NULL, part of PK | Informal ref to `materi_ajar.id`. Indexed. |
| `created_at` | TEXT, NOT NULL, default UTC ISO-8601 ms | Set on insert. No `updated_at`, no surrogate `id`. |

### relationships

`ListRelations(materiAjarID)` returns the *other* id of every edge touching the
given materi (via `CASE WHEN materi_a_id = ? THEN materi_b_id ELSE materi_a_id END`),
letting the UI hydrate sibling materi rows regardless of which side of the
canonical pair the input is on.

### Migration history for `materi_relation`

| # | Migration | Effect |
|---|---|---|
| 029 | `029_materi_relations` | Creates the table (composite PK + canonical CHECK) + `idx_mrel_a`, `idx_mrel_b`. Unchanged since. |

---

## `attendances`

Kehadiran (attendance) log: one row per teaching encounter (one teacher meeting
one student on a date). Written by the kehadiran handlers via
`internal/store/attendances.go` (`Create`/`Update`/`Delete`) and bulk-seeded by
the one-shot historical importer. `teacher_id` and `student_id` reference the
unified `users` table **by id but with NO database foreign key** — this is
deliberate so a user can be soft-removed without cascading or breaking historical
attendance rows (the store falls back to displaying the raw id via
`COALESCE(name, id)`). Ported originally from `fadhilkurnia/ppg` main. The table
was rebuilt in migration 039 to extend the status CHECK set with `alfa`; the
canonical shape below is post-039 (and includes the `sesi_id` column added in 038).

```sql
CREATE TABLE attendances (
  id           TEXT PRIMARY KEY,                  -- ULID
  date         DATE NOT NULL,                      -- encounter date (stored UTC)
  duration_min INTEGER,                            -- session length in minutes, nullable
  teacher_id   TEXT NOT NULL,                      -- users.id (NO FK — soft-removal safe)
  student_id   TEXT NOT NULL,                      -- users.id (NO FK — soft-removal safe)
  status       TEXT NOT NULL CHECK (status IN ('hadir','izin_murid','izin_guru','by_vn','alfa')),
  materi       TEXT,                               -- free-text topic taught, nullable
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sesi_id      TEXT                                -- optional link to the sesi this row belongs to (added 038)
);
CREATE INDEX idx_attendances_date         ON attendances(date);
CREATE INDEX idx_attendances_student_date ON attendances(student_id, date);
CREATE INDEX idx_attendances_teacher_date ON attendances(teacher_id, date);
CREATE INDEX idx_attendances_status       ON attendances(status);
CREATE INDEX idx_attendances_sesi         ON attendances(sesi_id);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY, NOT NULL | ULID generated by the app (`ulid.Make().String()`). |
| `date` | DATE, NOT NULL | Encounter date; written as UTC by the store (`in.Date.UTC()`). Indexed alone and as the second column of the student/teacher composite indexes. |
| `duration_min` | INTEGER, nullable | Session length in minutes. Summed and divided by 60.0 for "hours" in stats. |
| `teacher_id` | TEXT, NOT NULL, **no FK** | References `users.id` informally. No DB foreign key so a teacher can be soft-removed; list/stats queries `LEFT JOIN users` and fall back to the raw id via `COALESCE(name, id)`. |
| `student_id` | TEXT, NOT NULL, **no FK** | References `users.id` informally; same no-FK / soft-removal rationale as `teacher_id`. |
| `status` | TEXT, NOT NULL, CHECK IN (`hadir`,`izin_murid`,`izin_guru`,`by_vn`,`alfa`) | Attendance outcome. `hadir`=present; `izin_murid`=student-excused absence; `izin_guru`=teacher-excused/cancelled; `by_vn`=conducted by voice note; `alfa`=absence without prior notice (ketiduran / no reply / tidak hadir tanpa kabar), added in 039. Mirrors `model.AttendanceStatus`. |
| `materi` | TEXT, nullable | Free-text description of material taught. |
| `created_at` | DATETIME, NOT NULL, DEFAULT CURRENT_TIMESTAMP | Set explicitly to `time.Now().UTC()` on insert. |
| `updated_at` | DATETIME, NOT NULL, DEFAULT CURRENT_TIMESTAMP | Bumped to `time.Now().UTC()` on update. |
| `sesi_id` | TEXT, nullable, **no FK** | Optional link back to the `sesi` this attendance belongs to. Set by the historical importer when it creates a sesi from an attendance row, making the importer idempotent (re-runnable) by letting it skip already-mapped rows. Added in 038. |

### Migration history for `attendances`

| # | Migration | What it did / why |
|---|---|---|
| 032 | `032_attendances` | Created the table (ported from `fadhilkurnia/ppg` main) with columns `id, date, duration_min, teacher_id, student_id, status, materi, created_at, updated_at`; status CHECK set was `('hadir','izin_murid','izin_guru','by_vn')`. Added the date, student_date, teacher_date, and status indexes. No FK on teacher_id/student_id (relaxed vs the upstream port to allow soft removal). |
| 038 | `038_attendance_sesi_link` | `ALTER TABLE attendances ADD COLUMN sesi_id TEXT;` plus `CREATE INDEX IF NOT EXISTS idx_attendances_sesi`. Lets the one-shot historical importer record which sesi an attendance row was mapped to so re-runs skip already-mapped rows. |
| 039 | `039_attendance_alfa` | Extended the status CHECK set with `alfa`. SQLite can't ALTER a CHECK in place, so the migration created `attendances_new` (same columns incl. `sesi_id`) with the 5-value CHECK, copied all rows, dropped the old table, renamed `attendances_new` → `attendances`, and re-created all five indexes (date, student_date, teacher_date, status, sesi). |

### relationships

- `attendances.teacher_id` → `users.id` (logical only, NO DB FK — intentional for soft removal).
- `attendances.student_id` → `users.id` (logical only, NO DB FK — intentional for soft removal).
- `attendances.sesi_id` → `sesi.id` (logical only, nullable, NO DB FK).

---

## `bacaan_log`

Kontrol Bacaan: per-user log of Qur'an ayat read. Each row records one contiguous
ayat range (`surah`, `ayat_from`..`ayat_to`) read by a user on a date. Written via
`internal/store/bacaan.go` (`Create`/`Delete`); a row may be self-recorded (murid)
or recorded on their behalf by a guru/admin (`recorded_by`). There is no
materialized progress counter — aggregate progress is computed on the fly in
handlers (`Summary` sums `ayat_to - ayat_from + 1`, capped at
`QuranTotalAyat = 6236`; `PerSurah` takes `MAX(ayat_to)` per surah). Like
`attendances`, the user references are informal (no DB FK; queries
`LEFT JOIN users` and fall back to the id).

```sql
CREATE TABLE bacaan_log (
  id           TEXT PRIMARY KEY,                  -- ULID
  user_id      TEXT NOT NULL,                      -- users.id (the reader; no FK)
  recorded_by  TEXT,                               -- users.id of who logged it (no FK), nullable
  source       TEXT NOT NULL DEFAULT 'mandiri'
               CHECK (source IN ('pengajian','mandiri')),
  tanggal      TEXT NOT NULL,                       -- read date, YYYY-MM-DD
  surah        INTEGER NOT NULL,                    -- surah number 1..114
  ayat_from    INTEGER NOT NULL,                    -- first ayat in range (inclusive)
  ayat_to      INTEGER NOT NULL,                    -- last ayat in range (inclusive)
  catatan      TEXT,                                -- free-text note, nullable
  sesi_id      TEXT,                                -- optional link to the sesi, nullable (no FK)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bacaan_user      ON bacaan_log(user_id, tanggal);
CREATE INDEX idx_bacaan_recorded  ON bacaan_log(recorded_by);
CREATE INDEX idx_bacaan_sesi      ON bacaan_log(sesi_id);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PRIMARY KEY, NOT NULL | ULID generated by the app. |
| `user_id` | TEXT, NOT NULL, **no FK** | The reader (`users.id`). Kontrol Bacaan tracks generus/murid progress; visibility is role-scoped in `VisibleUserIDs`. Indexed with `tanggal`. |
| `recorded_by` | TEXT, nullable, **no FK** | `users.id` of whoever logged the row (a guru/admin recording on behalf of a murid). NULL when not set (e.g. self-create with empty recorder). Indexed. |
| `source` | TEXT, NOT NULL, DEFAULT `'mandiri'`, CHECK IN (`pengajian`,`mandiri`) | Whether the bacaan was recorded during a mentored pengajian session (`pengajian`) or self-study (`mandiri`). The store coerces any other value to `mandiri`. |
| `tanggal` | TEXT, NOT NULL | Read date as a `YYYY-MM-DD` string (used for range filters and ordering). |
| `surah` | INTEGER, NOT NULL | Surah number. |
| `ayat_from` | INTEGER, NOT NULL | First ayat of the contiguous range (inclusive). |
| `ayat_to` | INTEGER, NOT NULL | Last ayat of the range (inclusive). Store clamps `ayat_to` up to `ayat_from` if a smaller value is passed. |
| `catatan` | TEXT, nullable | Free-text note about the reading. |
| `sesi_id` | TEXT, nullable, **no FK** | Optional link to the `sesi` the reading belongs to. Indexed. |
| `created_at` | TEXT, NOT NULL, DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ','now')` | ISO-8601 UTC string; store writes `time.Now().UTC()` formatted as `2006-01-02T15:04:05.000Z`. |
| `updated_at` | TEXT, NOT NULL, DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ','now')` | Same ISO-8601 UTC string format as `created_at`. |

### Migration history for `bacaan_log`

| # | Migration | What it did / why |
|---|---|---|
| 023 | `023_bacaan_log` | Created the `bacaan_log` table and its three indexes (user+tanggal, recorded_by, sesi_id). This is the only migration that touches the table; its shape is unchanged through 040. Designed with no materialized progress counter — aggregate distinct ayat-units are computed on the fly in the handler. |

### relationships

- `bacaan_log.user_id` → `users.id` (logical only, NO DB FK; the reader/murid).
- `bacaan_log.recorded_by` → `users.id` (logical only, nullable, NO DB FK; who logged the entry).
- `bacaan_log.sesi_id` → `sesi.id` (logical only, nullable, NO DB FK).

---

## `kelas`

A classroom: a named group of generus (murid) under a `tingkat` for one academic
year (`tahun`), taught by one or more guru. Introduced by migration `014_kelas`,
inspired by sitrac-v3's Kelas model but simplified. Written by `KelasStore`
(`internal/store/kelas.go`) on the admin "Kelas" page. `guru_user_id` is the
**primary/wali guru**; the full guru set lives in the `kelas_guru` join (added in
mig 024). The shape has not changed since 014 — no later migration alters `kelas`.

```sql
CREATE TABLE kelas (
  id            TEXT PRIMARY KEY,
  nama          TEXT NOT NULL,
  tingkat       TEXT NOT NULL,
  guru_user_id  TEXT,
  tahun         INTEGER NOT NULL DEFAULT (CAST(strftime('%Y','now') AS INTEGER)),
  deskripsi     TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(nama, tahun)
);
CREATE INDEX idx_kelas_tingkat ON kelas(tingkat);
CREATE INDEX idx_kelas_guru    ON kelas(guru_user_id);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | App-generated ULID (`ulid.Make()`). |
| `nama` | TEXT, NOT NULL | Class name. Unique per `tahun` via `UNIQUE(nama, tahun)`. |
| `tingkat` | TEXT, NOT NULL | String reference to a tingkat name (informal, no SQL FK). Indexed. |
| `guru_user_id` | TEXT, nullable | Primary/wali guru. **No SQL FK** — references `users.id` informally; role=`guru` is enforced at the handler level, not in SQL, so a guru can be removed/soft-handled without breaking rows. `List` LEFT JOINs `users` to surface `guru_name`. Indexed. |
| `tahun` | INTEGER, NOT NULL, DEFAULT current year | Academic year as a plain integer (014 predates `tahun_ajaran`). Default is `CAST(strftime('%Y','now') AS INTEGER)`. Store defaults to `time.Now().Year()` when input is 0. |
| `deskripsi` | TEXT, nullable | Free-text description. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC (`YYYY-MM-DDTHH:MM:fZ`); app writes `time.Now().UTC()`. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | Same format; rewritten on update. |

---

## `kelas_anggota`

Membership join: which murid (student) belongs to which kelas. One row per
(kelas, murid). Introduced in `014_kelas`. Composite PK prevents duplicate
membership. The comment in 014 notes the intended invariant "each murid in at most
one kelas per tahun" but that is **not** enforced in SQL (the PK is
`(kelas_id, murid_user_id)`, not `(murid_user_id, tahun)`). Written by
`KelasStore.AddAnggota` / `RemoveAnggota` using `INSERT OR IGNORE`.

```sql
CREATE TABLE kelas_anggota (
  kelas_id        TEXT NOT NULL,
  murid_user_id   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (kelas_id, murid_user_id)
);
CREATE INDEX idx_kelas_anggota_murid ON kelas_anggota(murid_user_id);
```

| Column | Type | Notes |
|---|---|---|
| `kelas_id` | TEXT, NOT NULL, part of PK | References `kelas.id` informally (no SQL FK). |
| `murid_user_id` | TEXT, NOT NULL, part of PK | References `users.id` (role murid) informally; no SQL FK. Indexed for reverse lookup. `ListAnggota` JOINs `users` for `murid_name`. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC. |

---

## `kelas_guru`

Many-guru-per-kelas join, introduced by `024_kelas_guru`. Previously a kelas
carried a single `guru_user_id`; the "Kelas saya" filter for guru users needed to
recognise every assigned guru. 024 creates this join and **backfills** it from the
legacy column (`INSERT OR IGNORE ... SELECT id, guru_user_id FROM kelas WHERE
guru_user_id IS NOT NULL`). The legacy `kelas.guru_user_id` is kept as the
primary/wali guru. Written by `KelasStore.writeGuruJoin` / `AddGuruAnggota` /
`RemoveGuruAnggota`; removing the primary guru promotes the oldest remaining join
row to primary.

```sql
CREATE TABLE kelas_guru (
  kelas_id      TEXT NOT NULL,
  guru_user_id  TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (kelas_id, guru_user_id)
);
CREATE INDEX idx_kelas_guru_guru ON kelas_guru(guru_user_id);
```

| Column | Type | Notes |
|---|---|---|
| `kelas_id` | TEXT, NOT NULL, part of PK | References `kelas.id` informally (no SQL FK). |
| `guru_user_id` | TEXT, NOT NULL, part of PK | References `users.id` (role guru) informally; no SQL FK. Indexed. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC; used as ordering key to pick the next primary when the current primary is removed. |

---

## `sesi`

One scheduled (or live) class session — the teaching-plan unit rendered on the
kehadiran calendar. Created by `012_sesi` as a simplified port of sitrac-v3's Sesi.
Written by `SesiStore` (`internal/store/sesi.go`). A sesi can be a plain scheduled
slot, or "go live" — the guru records `started_at` and runs a Live Stage that
tracks the projected materi (`live_materi_id`/`live_display_mode`); `ended_at`
closes it and the two `live_*` columns are nulled on `SetEnded`. The DDL below
folds in every later ALTER: `kelas_id` (014), the single-shot library columns
(022), and the live-state columns (033). There are **no CHECK constraints** on
`sesi` itself; enum-shaped values (library_kind/aspect) are validated only in app
code and in the child tables.

```sql
CREATE TABLE sesi (
  id              TEXT PRIMARY KEY,
  tanggal         TEXT NOT NULL,
  mulai           TEXT,
  selesai         TEXT,
  topik           TEXT NOT NULL,
  catatan         TEXT,
  tingkat         TEXT,
  materi_ajar_id  TEXT,
  guru_id         TEXT,
  started_at      TEXT,
  ended_at        TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  kelas_id        TEXT,                -- added 014
  library_kind    TEXT NULL,           -- added 022
  library_aspect  TEXT NULL,           -- added 022
  library_ref     TEXT NULL,           -- added 022
  live_materi_id    TEXT NULL,         -- added 033
  live_display_mode TEXT NULL          -- added 033
);
CREATE INDEX idx_sesi_tanggal ON sesi(tanggal);     -- 012
CREATE INDEX idx_sesi_tingkat ON sesi(tingkat);     -- 012
CREATE INDEX idx_sesi_guru_id ON sesi(guru_id);     -- 012
CREATE INDEX idx_sesi_materi  ON sesi(materi_ajar_id); -- 012
CREATE INDEX idx_sesi_kelas   ON sesi(kelas_id);    -- 014
```

(Column order above reflects the ALTER-TABLE append order SQLite actually
produces; 012's columns come first, then 014/022/033 appended in that sequence.)

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID. |
| `tanggal` | TEXT, NOT NULL | ISO date `YYYY-MM-DD` stored as local wall-clock (deliberately not a timestamp) to avoid UTC drift on the calendar view. Indexed; primary list filter (`>=`/`<=` range). |
| `mulai` | TEXT, nullable | Start time `HH:MM`; nullable for sessions without a fixed slot. |
| `selesai` | TEXT, nullable | End time `HH:MM`; nullable. |
| `topik` | TEXT, NOT NULL | Session topic/title. |
| `catatan` | TEXT, nullable | Free-text note. |
| `tingkat` | TEXT, nullable | String ref to a tingkat name (no SQL FK). Indexed; list filter. |
| `materi_ajar_id` | TEXT, nullable | **Legacy** single primary kurikulum materi ref. Kept for back-compat; the authoritative multi-materi set is in `sesi_materi` (025). Indexed. No SQL FK. |
| `guru_id` | TEXT, nullable | The guru running the session; references `users.id` (role guru) informally, no SQL FK. Indexed; list filter. |
| `started_at` | TEXT, nullable | ISO-8601 UTC timestamp set when guru starts the live session. `SetStarted` is idempotent via `COALESCE(started_at, ?)`. |
| `ended_at` | TEXT, nullable | ISO-8601 UTC timestamp when guru ends the session. `SetEnded` is idempotent via `COALESCE(ended_at, ?)` and also nulls `live_materi_id`/`live_display_mode`. |
| `created_by` | TEXT, nullable | `users.id` of the creator (informal, no SQL FK). |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC; rewritten on every mutation including live-state changes. |
| `kelas_id` | TEXT, nullable (added 014) | Optional link to `kelas.id` (informal, no SQL FK). Nullable so a sesi can be an "open jadwal" with no kelas. When set, `syncSesiToRencana` folds the sesi's materi/library into that kelas's monthly `rencana_bulanan`. Indexed. |
| `library_kind` | TEXT, NULL (added 022) | **Legacy** single-shot library source. App-level values: `kurikulum` / `quran` / `hadits` / `tilawati` / `doa` (no SQL CHECK). For non-kurikulum sources the authoritative store is now `sesi_library` (036). |
| `library_aspect` | TEXT, NULL (added 022) | The action/aspect — reciting / memorizing / review / manqul. Nullable (kurikulum doesn't need it). |
| `library_ref` | TEXT, NULL (added 022) | Source-specific ref string, e.g. `"surah:ayahFrom-ayahTo"` (quran), `hadits_id` (hadits), `"jilid:page"` (tilawati), `doa_id` (doa). |
| `live_materi_id` | TEXT, NULL (added 033) | Which materi is currently projected on the Live Stage. Set via `SetLive`; cleared (set NULL) by `SetEnded`. Pointer-sparse update: nil = leave unchanged, empty string = clear. |
| `live_display_mode` | TEXT, NULL (added 033) | Current Live Stage display mode (app-defined string, no SQL CHECK). Cleared by `SetEnded`. |

### Migration history for `sesi`

| # | Migration | What it did | Why |
|---|---|---|---|
| 012 | `012_sesi` | `CREATE TABLE sesi` with id, tanggal, mulai, selesai, topik, catatan, tingkat, materi_ajar_id, guru_id, started_at, ended_at, created_by, created_at, updated_at; indexes on tanggal/tingkat/guru_id/materi_ajar_id. | Teaching-plan / kehadiran calendar unit (no kelas model yet — scoped by tingkat). |
| 014 | `014_kelas` | `ALTER TABLE sesi ADD COLUMN kelas_id TEXT` + `idx_sesi_kelas`. | Group sesi under a kelas; nullable so existing rows / open jadwal are unaffected. |
| 022 | `022_sesi_library` | `ADD COLUMN library_kind`, `library_aspect`, `library_ref` (all NULL). | Let a sesi pull content from a non-kurikulum library (quran/hadits/tilawati/doa) via a single ref. |
| 033 | `033_sesi_live_state` | `ADD COLUMN live_materi_id`, `live_display_mode` (both NULL). | Persist Live Stage state — which materi is projected and the display mode — while a sesi is live. |

---

## `sesi_materi`

Multi-kurikulum-materi join for a sesi, introduced by `025_sesi_materi`.
Previously `sesi.materi_ajar_id` held a single materi; the Tambah-sesi flow wanted
a "+" to attach several kurikulum materi. 025 creates this join and **backfills**
from the legacy column (`INSERT OR IGNORE ... SELECT id, materi_ajar_id FROM sesi
WHERE materi_ajar_id IS NOT NULL`). The legacy column stays as the primary materi.
Written by `SesiStore.writeMateriJoin` (delete-then-reinsert, always including the
primary).

```sql
CREATE TABLE sesi_materi (
  sesi_id        TEXT NOT NULL,
  materi_ajar_id TEXT NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (sesi_id, materi_ajar_id)
);
CREATE INDEX idx_sesi_materi_materi ON sesi_materi(materi_ajar_id);
```

| Column | Type | Notes |
|---|---|---|
| `sesi_id` | TEXT, NOT NULL, part of PK | References `sesi.id` informally — **no SQL FK** (unlike `sesi_library` / `sesi_materi_diajarkan` which do declare one). Rows are managed by the app (delete-then-reinsert). |
| `materi_ajar_id` | TEXT, NOT NULL, part of PK | References a materi_ajar row informally; no SQL FK. Indexed for reverse lookup. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC; used as the read-ordering key (`ORDER BY created_at ASC`). |

---

## `sesi_library`

Multi-library-ref join for a sesi, introduced by `036_sesi_library`. Lets one sesi
attach more than one non-kurikulum library item (e.g. two Quran ranges + one
Hadits), complementing `sesi_materi` (which covers kurikulum). The legacy
single-shot `library_kind/aspect/ref` columns on `sesi` remain for back-compat,
but this join is authoritative going forward. Written by
`SesiStore.writeLibraryJoin` (delete-then-reinsert with explicit `position`).

```sql
CREATE TABLE sesi_library (
  id             TEXT PRIMARY KEY,
  sesi_id        TEXT NOT NULL,
  library_kind   TEXT NOT NULL CHECK (library_kind IN ('quran','hadits','tilawati','doa')),
  library_aspect TEXT,
  library_ref    TEXT NOT NULL,
  position       INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (sesi_id) REFERENCES sesi(id) ON DELETE CASCADE
);
CREATE INDEX idx_sesi_library_sesi ON sesi_library(sesi_id, position);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID. |
| `sesi_id` | TEXT, NOT NULL, FK → `sesi(id)` ON DELETE CASCADE | Deleting the sesi cascades these rows away. |
| `library_kind` | TEXT, NOT NULL, CHECK IN (`quran`,`hadits`,`tilawati`,`doa`) | Library source. Note: `kurikulum` is **not** allowed here (it lives in `sesi_materi`); app code skips kurikulum/blank kind on write. |
| `library_aspect` | TEXT, nullable | Action/aspect (reciting/memorizing/review/manqul); trimmed-empty becomes NULL on write. |
| `library_ref` | TEXT, NOT NULL | Source-specific ref string (same conventions as `sesi.library_ref`). |
| `position` | INTEGER, NOT NULL, DEFAULT 0 | Stable display order (input order). Part of the read index. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC; secondary read-ordering key after `position`. |

---

## `sesi_materi_diajarkan`

The **delivery / "taught-material"** table: one row per materi the guru actually
projected during a live sesi (Live Stage). Introduced by
`035_sesi_materi_diajarkan` and extended by `037_diajarkan_completed`. Switching to
a different materi is an **append, not a replace**, so the end-sesi summary can
list everything that was shown. At end-of-sesi the guru confirms each row: whether
it needs parent review (`needs_parent_review`) and a note for the parent
(`parent_note`); migration 037 added `completed`/`completed_at` to distinguish
materi that were actually finished vs. abandoned mid-way ("ganti saja"). Each row
is one of five `kind`s; the `ref`/`materi_ajar_id` interpretation depends on kind.
Written by `DiajarkanStore` (`internal/store/diajarkan.go`). **This is the only
table in the curriculum/session subsystem (alongside `sesi_library`) with a real
FK: `sesi_id → sesi(id) ON DELETE CASCADE`.**

```sql
CREATE TABLE sesi_materi_diajarkan (
  id                  TEXT PRIMARY KEY,            -- ULID
  sesi_id             TEXT NOT NULL,               -- FK -> sesi(id) ON DELETE CASCADE
  kind                TEXT NOT NULL
                      CHECK (kind IN ('kurikulum','quran','hadits','tilawati','doa')),
  materi_ajar_id      TEXT,                        -- set when kind='kurikulum' (ref empty); ref to materi_ajar.id (no FK)
  ref                 TEXT,                        -- library pointer; meaning depends on kind (see below)
  label               TEXT,                        -- denormalized display label
  needs_parent_review INTEGER NOT NULL DEFAULT 0,  -- bool 0/1, set at end-sesi
  parent_note         TEXT,                        -- note for the parent, set at end-sesi
  completed           INTEGER NOT NULL DEFAULT 0,  -- bool 0/1 (added 037): finished vs abandoned
  completed_at        TEXT,                        -- ISO timestamp when marked completed (added 037)
  taught_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (sesi_id) REFERENCES sesi(id) ON DELETE CASCADE
);

CREATE INDEX idx_smd_sesi   ON sesi_materi_diajarkan(sesi_id, taught_at);
CREATE INDEX idx_smd_materi ON sesi_materi_diajarkan(materi_ajar_id);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID. |
| `sesi_id` | TEXT, NOT NULL, **FK → sesi(id) ON DELETE CASCADE** | Owning sesi; cascades on delete. Indexed with `taught_at` for chronological read. |
| `kind` | TEXT, NOT NULL, CHECK IN (`kurikulum`,`quran`,`hadits`,`tilawati`,`doa`) | Source type. Unlike `sesi_library`, `kurikulum` **is** allowed here. For `kurikulum`, `ref` is empty and `materi_ajar_id` is set; otherwise `ref` carries: quran=`"surah"`/`"surah:ayat"`/`"surah:from-to"`, hadits=`"kitab/bab"`, tilawati=`"jilid/halaman"`, doa=`compact_ajar.id`. |
| `materi_ajar_id` | TEXT, nullable | Set for kurikulum kind; informal ref to `materi_ajar.id`, no SQL FK. Indexed. |
| `ref` | TEXT, nullable | Source-specific ref string (see `kind`). |
| `label` | TEXT, nullable | Human-readable display label captured at teach time. |
| `needs_parent_review` | INTEGER, NOT NULL, DEFAULT 0 | Boolean (0/1); set in the end-sesi confirm dialog. |
| `parent_note` | TEXT, nullable | Note for the parent, edited in the end-sesi dialog (`Update` stores NULL for empty string). |
| `completed` | INTEGER, NOT NULL, DEFAULT 0 (added 037) | Boolean (0/1): whether this item was finished before the guru moved on, vs replaced mid-way. Distinguishes finished vs abandoned in the end-sesi summary. |
| `completed_at` | TEXT, nullable (added 037) | ISO-8601 UTC timestamp when marked completed; cleared (NULL) when set false. |
| `taught_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC; when the materi was picked. Read-ordering key. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC; bumped by `Update`. |

### Migration history for `sesi_materi_diajarkan`

| # | Migration | What it did | Why |
|---|---|---|---|
| 035 | `035_sesi_materi_diajarkan` | `CREATE TABLE` with id, sesi_id (FK CASCADE), kind (CHECK), materi_ajar_id, ref, label, needs_parent_review, parent_note, taught_at, created_at, updated_at; indexes `idx_smd_sesi(sesi_id, taught_at)` and `idx_smd_materi(materi_ajar_id)`. | Track materi actually taught on the Live Stage (append per pick) and capture parent-review/note at end-sesi. |
| 037 | `037_diajarkan_completed` | `ADD COLUMN completed INTEGER NOT NULL DEFAULT 0`; `ADD COLUMN completed_at TEXT`. | Distinguish finished items from ones abandoned mid-way ("ganti saja") in the end-sesi summary. |

---

## `tahun_ajaran`

Academic-year row, introduced by `021_tahun_ajaran` (ported from sitrac-v3).
Defines the named academic year and which calendar months each semester begins
(PPG default: Sem 1 = July, Sem 2 = January). Exactly one row may be `active` at a
time — this is an **application-level invariant** enforced by
`TahunAjaranStore.SetActive` (demotes all others to 0 in a transaction), not by a
partial index, because SQLite would still permit multiple `active=0` rows.
Unchanged since 021.

```sql
CREATE TABLE tahun_ajaran (
  id                     TEXT PRIMARY KEY,
  nama                   TEXT NOT NULL UNIQUE,
  active                 INTEGER NOT NULL DEFAULT 0,
  semester1_start_month  INTEGER NOT NULL DEFAULT 7
                         CHECK (semester1_start_month BETWEEN 1 AND 12),
  semester2_start_month  INTEGER NOT NULL DEFAULT 1
                         CHECK (semester2_start_month BETWEEN 1 AND 12),
  tanggal_mulai          TEXT,
  tanggal_selesai        TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tahun_ajaran_active ON tahun_ajaran(active);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID. |
| `nama` | TEXT, NOT NULL, UNIQUE | Display name (e.g. "2024/2025"); list ordered `nama DESC`. |
| `active` | INTEGER, NOT NULL, DEFAULT 0 | Boolean (0/1). "Exactly one active" is enforced in the store (`SetActive`), not SQL. Indexed; `Active()` queries `WHERE active = 1 LIMIT 1`. |
| `semester1_start_month` | INTEGER, NOT NULL, DEFAULT 7, CHECK BETWEEN 1 AND 12 | Calendar month semester 1 begins. Store coerces input 0 → 7. |
| `semester2_start_month` | INTEGER, NOT NULL, DEFAULT 1, CHECK BETWEEN 1 AND 12 | Calendar month semester 2 begins. Store coerces input 0 → 1. |
| `tanggal_mulai` | TEXT, nullable | Optional academic-year start date. |
| `tanggal_selesai` | TEXT, nullable | Optional academic-year end date. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC. |

### relationships

`kelas.tahun` is a plain INTEGER, **not** a FK into `tahun_ajaran` — the two were
added independently (014 before 021) and are not joined in the store. The
`tahun_ajaran` table is standalone: nothing references its `id`. It exists to drive
semester/month math and the "active year" selector, not as a foreign key target.

---

## `rencana_bulanan`

A **monthly teaching plan** ("rencana bulanan") for one kelas: the container for a
bundle of planned materi/library items in a given month. Ported (simplified) from
sitrac-v3's `RencanaBulanan`. Unique per `(kelas_id, tahun, bulan)`. Created lazily
by `RencanaStore.GetOrCreate` (the FE "+ Add to plan" flow doesn't pre-create it) —
which also derives `semester` from the month (bulan 1–6 → semester 2, else 1) when
auto-creating. Deleting a rencana cascades in app code (`Delete` removes its
`rencana_bulanan_item` rows in a transaction first; there is no DB-level cascade).
No FK on `kelas_id` or `created_by`.

```sql
CREATE TABLE rencana_bulanan (
  id            TEXT PRIMARY KEY,            -- ULID
  kelas_id      TEXT NOT NULL,               -- informal ref to kelas.id (no FK)
  tahun         INTEGER NOT NULL,            -- year
  bulan         INTEGER NOT NULL CHECK (bulan BETWEEN 1 AND 12),
  semester      INTEGER,                     -- 1 or 2; app-derived, nullable
  catatan       TEXT,                        -- free-text note
  created_by    TEXT,                        -- informal ref to user id (no FK)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(kelas_id, tahun, bulan)
);

CREATE INDEX idx_rencana_bulanan_kelas ON rencana_bulanan(kelas_id);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK, NOT NULL | ULID. |
| `kelas_id` | TEXT, NOT NULL | Informal ref to `kelas.id` (no FK). Indexed. |
| `tahun` | INTEGER, NOT NULL | Plan year. Part of the unique key. |
| `bulan` | INTEGER, NOT NULL, CHECK BETWEEN 1 AND 12 | Plan month. Part of the unique key. |
| `semester` | INTEGER, nullable | 1 or 2. Auto-set on `GetOrCreate` (bulan 1–6 → 2, else 1). No CHECK. |
| `catatan` | TEXT, nullable | Free-text note for the month. |
| `created_by` | TEXT, nullable | Informal ref to the creating user's id (no FK). |
| `created_at` / `updated_at` | TEXT, NOT NULL, default UTC ISO-8601 ms | Set by `RencanaStore`. |

### Migration history for `rencana_bulanan`

| # | Migration | Effect |
|---|---|---|
| 015 | `015_rencana_bulanan` | Creates the table (unique `(kelas_id, tahun, bulan)`) + `idx_rencana_bulanan_kelas`. Unchanged since. |

---

## `rencana_bulanan_item`

One **planned slot** inside a `rencana_bulanan`. As of migration 026 a slot is
**either** a kurikulum item (`materi_ajar_id` set) **or** a library-sourced item
(`library_kind` + `library_ref` set; `materi_ajar_id` NULL). Tracks per-slot
completion (`selesai`/`tanggal_selesai`) and ordering (`urutan`). Written by
`RencanaStore.AddItems` (kurikulum, skips existing `(rencana,materi)`),
`AddLibraryItem` (library), `ToggleSelesai`, and `RemoveItem`. `listItems` LEFT
JOINs `materi_ajar` to hydrate the kurikulum payload. No FK on `rencana_id` (app
deletes items before the parent), `materi_ajar_id`, or the library target.

> **Migration 026 rebuild.** The table originally (015) had
> `materi_ajar_id TEXT NOT NULL` and `UNIQUE(rencana_id, materi_ajar_id)`. To allow
> library-sourced planning, 026 added `library_kind`/`library_aspect`/`library_ref`,
> then used SQLite's create-copy-drop-rename to **drop the NOT NULL on
> `materi_ajar_id` and drop the UNIQUE constraint** entirely (library items have a
> NULL materi_ajar_id and rely on `library_ref`). The DDL below is the post-026
> final shape — there is **no** unique constraint on the final table.

```sql
CREATE TABLE rencana_bulanan_item (
  id              TEXT PRIMARY KEY,            -- ULID
  rencana_id      TEXT NOT NULL,               -- informal ref to rencana_bulanan.id (no FK)
  materi_ajar_id  TEXT,                        -- kurikulum slot: ref to materi_ajar.id (nullable as of 026)
  library_kind    TEXT,                        -- library slot: 'quran'|'hadits'|'tilawati'|'doa' (no CHECK on this table)
  library_aspect  TEXT,                        -- optional library sub-aspect
  library_ref     TEXT,                        -- library pointer (opaque)
  urutan          INTEGER NOT NULL DEFAULT 0,  -- sort order within the rencana
  selesai         INTEGER NOT NULL DEFAULT 0,  -- bool 0/1: slot done
  tanggal_selesai TEXT,                        -- ISO timestamp when marked done
  catatan         TEXT,                        -- free-text note
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  -- NOTE: NO UNIQUE constraint after 026 (the original UNIQUE(rencana_id, materi_ajar_id) was dropped)
);

CREATE INDEX idx_rencana_item_rencana ON rencana_bulanan_item(rencana_id);
CREATE INDEX idx_rencana_item_materi  ON rencana_bulanan_item(materi_ajar_id);
CREATE INDEX idx_rencana_item_library ON rencana_bulanan_item(library_kind);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK, NOT NULL | ULID. |
| `rencana_id` | TEXT, NOT NULL | Informal ref to `rencana_bulanan.id` (no FK). Indexed. |
| `materi_ajar_id` | TEXT, nullable (was NOT NULL pre-026) | Kurikulum slot ref to `materi_ajar.id`. NULL for library slots. Indexed. |
| `library_kind` | TEXT, nullable | `quran`/`hadits`/`tilawati`/`doa` for library slots. **No CHECK on this table** (unlike `materi_library_ref`/`sesi_materi_diajarkan`); enum enforced by app. Indexed. |
| `library_aspect` | TEXT, nullable | Optional library sub-aspect. |
| `library_ref` | TEXT, nullable | Opaque library pointer (interpreted per kind). |
| `urutan` | INTEGER, NOT NULL, default 0 | Order within the plan; new items get `MAX(urutan)+1`. |
| `selesai` | INTEGER, NOT NULL, default 0 | Boolean 0/1: slot completed. |
| `tanggal_selesai` | TEXT, nullable | UTC ISO timestamp set when `ToggleSelesai(true)`; cleared on false. |
| `catatan` | TEXT, nullable | Per-slot free-text note. |
| `created_at` / `updated_at` | TEXT, NOT NULL, default UTC ISO-8601 ms | |

### Migration history for `rencana_bulanan_item`

| # | Migration | Effect |
|---|---|---|
| 015 | `015_rencana_bulanan` | Creates the table with `materi_ajar_id NOT NULL`, `UNIQUE(rencana_id, materi_ajar_id)`, + `idx_rencana_item_rencana`, `idx_rencana_item_materi`. Kurikulum-only items. |
| 026 | `026_rencana_library` | Adds `library_kind`/`library_aspect`/`library_ref` (ADD COLUMN), then rebuilds via create-copy-drop-rename to make `materi_ajar_id` nullable and **drop the UNIQUE constraint**. Re-creates the two indexes and adds `idx_rencana_item_library`. This is the final shape. |

---

## `pencapaian`

One row records a single murid's (student's) mastery state for **one achievable
item**. After migration 040 an item is **either** a kurikulum entry
(`materi_ajar_id` set, all `library_*` NULL) **or** a library entry
(`library_kind` + `library_ref` set, `materi_ajar_id` NULL) — exactly one of the
two, enforced by a table-level CHECK. Rows are written by the app's
`PencapaianStore.Upsert` (keyed on murid+materi or murid+library tuple, never
duplicated) when a teacher/staff records progress, and bulk-created by the
`cmd/backfill-pencapaian` tool which walks every completed `sesi` and writes a row
per kelas member × each materi/library item the session covered (idempotent via
the unique indexes). Status flows `belum` → `proses` → `tuntas`; the backfill marks
an item `tuntas` only if the session's `sesi_materi_diajarkan.completed` flag was
set, otherwise `proses`. The `pencapaian.id` is an app-generated ULID;
`recorded_by` is the user id who last touched the row (left NULL if unknown). There
are **no foreign keys** on this table (see relationships) — `murid_user_id`,
`materi_ajar_id`, `recorded_by`, and the `library_ref` values reference other rows
informally so members/materi can be soft-removed without cascade-deleting
achievement history.

```sql
-- Canonical shape after migration 040 (027 created it; 040 dropped & rebuilt
-- it as `pencapaian_new` then renamed to `pencapaian`).
CREATE TABLE pencapaian (
  id              TEXT PRIMARY KEY,                       -- app-generated ULID
  murid_user_id   TEXT NOT NULL,                          -- the student (informal ref, no FK)
  materi_ajar_id  TEXT,                                   -- kurikulum entry: materi_ajar.id (NULL for library entries)
  library_kind    TEXT CHECK (library_kind IS NULL OR library_kind IN ('quran','hadits','tilawati','doa')),
  library_aspect  TEXT CHECK (library_aspect IS NULL OR library_aspect IN ('reciting','memorizing','review','manqul')),
  library_ref     TEXT,                                   -- ayat / hadits / page / doa reference (library entries only)
  status          TEXT NOT NULL DEFAULT 'belum'
                  CHECK (status IN ('belum','proses','tuntas')),
  nilai_angka     INTEGER,                                -- numeric grade (nullable)
  nilai_huruf     TEXT,                                   -- letter grade (nullable)
  tanggal         TEXT,                                   -- date achieved/recorded, 'YYYY-MM-DD' (nullable)
  catatan         TEXT,                                   -- free-text note (nullable)
  recorded_by     TEXT,                                   -- user id who recorded it (nullable, no FK)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Exactly one of (materi_ajar_id) or (library_kind+library_ref) is set:
  CHECK (
    (materi_ajar_id IS NOT NULL AND library_kind IS NULL AND library_ref IS NULL)
    OR
    (materi_ajar_id IS NULL AND library_kind IS NOT NULL AND library_ref IS NOT NULL)
  )
);

CREATE INDEX idx_pencapaian_murid   ON pencapaian(murid_user_id);
CREATE INDEX idx_pencapaian_materi  ON pencapaian(materi_ajar_id)            WHERE materi_ajar_id IS NOT NULL;
CREATE INDEX idx_pencapaian_library ON pencapaian(library_kind, library_ref) WHERE library_kind IS NOT NULL;
CREATE INDEX idx_pencapaian_status  ON pencapaian(status);

-- Per-kind uniqueness: one active record per murid×materi, and one per
-- murid×library tuple (aspect coalesced to '' so a NULL aspect still keys).
CREATE UNIQUE INDEX idx_pencapaian_murid_materi
  ON pencapaian(murid_user_id, materi_ajar_id)
  WHERE materi_ajar_id IS NOT NULL;
CREATE UNIQUE INDEX idx_pencapaian_murid_library
  ON pencapaian(murid_user_id, library_kind, COALESCE(library_aspect, ''), library_ref)
  WHERE library_kind IS NOT NULL;
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, NOT NULL, PRIMARY KEY | App-generated ULID (`ulid.Make().String()` in `pencapaian.go` / backfill tool). Lexicographically time-ordered. |
| `murid_user_id` | TEXT, NOT NULL, no FK | The student this achievement belongs to. Informal reference (no FK) so a member can be soft-removed without cascading. |
| `materi_ajar_id` | TEXT, nullable, no FK | Set for **kurikulum entries**; references `materi_ajar.id` informally. NULL for library entries. Mutually exclusive with the `library_*` group via the table CHECK. |
| `library_kind` | TEXT, nullable, CHECK IN (`quran`,`hadits`,`tilawati`,`doa`) | Set for **library entries**; which library this item lives in. CHECK allows NULL. |
| `library_aspect` | TEXT, nullable, CHECK IN (`reciting`,`memorizing`,`review`,`manqul`) | The aspect of the library item being tracked (e.g. reciting vs memorizing the same ayat). Part of the library uniqueness key (coalesced to `''` when NULL). CHECK allows NULL. |
| `library_ref` | TEXT, nullable, no FK | The specific library reference (ayat / hadits id / tilawati page / doa) for a library entry. Required when `library_kind` is set (enforced by the table CHECK). |
| `status` | TEXT, NOT NULL, DEFAULT `'belum'`, CHECK IN (`belum`,`proses`,`tuntas`) | Mastery state: `belum` = not started, `proses` = in progress, `tuntas` = completed/mastered. Set by `Upsert`; backfill writes `tuntas` when the source session marked the item completed, else `proses`. Upsert "upgrades" to `tuntas` but never downgrades a `tuntas` row on conflict. |
| `nilai_angka` | INTEGER, nullable | Numeric grade/score. |
| `nilai_huruf` | TEXT, nullable | Letter grade. |
| `tanggal` | TEXT, nullable | Date achieved/recorded as `YYYY-MM-DD`. Backfill truncates the session `tanggal` to 10 chars; on conflict keeps the later date. |
| `catatan` | TEXT, nullable | Free-text note. |
| `recorded_by` | TEXT, nullable, no FK | User id who recorded the entry (informal ref). On update, `COALESCE(?, recorded_by)` preserves the prior recorder if a blank value is passed. |
| `created_at` | TEXT, NOT NULL, DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ','now')` | UTC ISO-8601 with millis. App writes `time.Now().UTC()` explicitly on insert. |
| `updated_at` | TEXT, NOT NULL, DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ','now')` | Same format; rewritten on every `Upsert`. |

### relationships

- `pencapaian.murid_user_id` → `users.id` (the murid) — logical only, NO FK; soft-removal safe (same philosophy as `attendances`).
- `pencapaian.materi_ajar_id` → `materi_ajar.id` — logical only, NO FK. Set for kurikulum entries; NULL for library entries.
- `pencapaian.recorded_by` → `users.id` — logical only, NO FK; nullable.
- `pencapaian.(library_kind, library_aspect, library_ref)` → the relevant library content (Quran ayat / Hadits / Tilawati page / Doa) — logical only, NO FK. Mirrors the shape of `materi_library_ref` (029); when such a linked library item is completed, the connected kurikulum materi's pencapaian can auto-flip to `tuntas` (application logic).
- A table-level CHECK enforces the XOR: each row is **either** a kurikulum entry (`materi_ajar_id` NOT NULL, `library_*` NULL) **or** a library entry (`materi_ajar_id` NULL, `library_kind`+`library_ref` NOT NULL).

### Migration history for `pencapaian`

| # | Migration | What it did | Why |
|---|---|---|---|
| 027 | `027_pencapaian` | Created the original `pencapaian` table: `id`, `murid_user_id` (NOT NULL), `materi_ajar_id` (NOT NULL), `status` (CHECK belum/proses/tuntas, default `belum`), `nilai_angka`, `nilai_huruf`, `tanggal`, `catatan`, `recorded_by`, `created_at`, `updated_at`, plus `UNIQUE(murid_user_id, materi_ajar_id)` and indexes on `murid_user_id`, `materi_ajar_id`, `status`. | One mastery record per murid × kurikulum materi item; status `belum → proses → tuntas`. |
| 040 | `040_pencapaian_library` | **Rebuilt the table** (SQLite can't add CHECK/relax NOT NULL in place): created `pencapaian_new` with `materi_ajar_id` now **nullable** plus new columns `library_kind`, `library_aspect`, `library_ref` (each CHECK-constrained), added the "exactly one of materi or library" table CHECK, copied all existing rows (preserved as kurikulum entries — only the original 11 columns are carried over, library columns left NULL), `DROP TABLE pencapaian`, `RENAME pencapaian_new → pencapaian`. Recreated indexes as **partial** (`idx_pencapaian_materi` and `idx_pencapaian_library` are filtered) and replaced the old table-level `UNIQUE(murid,materi)` with two **partial unique indexes**: `idx_pencapaian_murid_materi` (where `materi_ajar_id IS NOT NULL`) and `idx_pencapaian_murid_library` (where `library_kind IS NOT NULL`, keyed on murid + kind + COALESCE(aspect,'') + ref). Backfilled by `cmd/backfill-pencapaian` (run once after 040). | Widen achievement tracking beyond kurikulum to library items (Quran/Hadits/Tilawati/Doa) without losing existing kurikulum rows. **040 is the latest migration; this is the current shape.** |

> Note: migration 040 dropped the original table-level
> `UNIQUE(murid_user_id, materi_ajar_id)` constraint and re-expressed it as the
> partial unique index `idx_pencapaian_murid_materi`. The uniqueness guarantee
> survives; it just moved from an inline constraint to a
> `WHERE materi_ajar_id IS NOT NULL` index (so the now-nullable `materi_ajar_id`
> doesn't collide across library rows where it is NULL).

---

## `hadits_kitab`

The top of the Hadits library: one row per hadith book (*kitab*). Ported from
sitrac-v3's `HaditsKitab` model (migration 017). Each kitab carries display
metadata (name in Latin + Arabic, narrator, ordering) plus a `scope` that decides
which Pustaka landing bucket it appears in (Himpunan hadits vs. Maktabah Syamilah
vs. both). The corpus ships **pre-seeded on first boot** by `SeedHadits`
(replaying the embedded `internal/store/seed-data/hadits.sql.gz` bundle — ~15
kitab, ~40k hadits — into `hadits_kitab`/`hadits_bab`/`hadits`) and topped up by
`SeedHaditsHimpunan`; both run from `cmd/server/main.go` and are idempotent
(`INSERT OR IGNORE`). After seeding, admins can create/update/delete kitab via
`HaditsStore`. `slug` is the natural key used by the API; `jumlah_halaman` is an
admin-configurable target page count used by the teaching-plan / raport coverage
logic. Never altered after migration 017.

```sql
CREATE TABLE hadits_kitab (
  id              TEXT PRIMARY KEY,             -- ULID
  slug            TEXT NOT NULL UNIQUE,         -- natural key used by the API
  nama            TEXT NOT NULL,
  nama_arab       TEXT,
  deskripsi       TEXT,
  perawi          TEXT,                         -- narrator(s)
  urutan          INTEGER NOT NULL DEFAULT 0,   -- display order
  scope           TEXT NOT NULL DEFAULT 'both'
                  CHECK (scope IN ('hadits','maktabah','both')),
  jumlah_halaman  INTEGER NOT NULL DEFAULT 0,   -- target page count (curriculum coverage)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_hadits_kitab_scope  ON hadits_kitab(scope);
CREATE INDEX idx_hadits_kitab_urutan ON hadits_kitab(urutan);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID string, generated by `ulid.Make()` in `HaditsStore.CreateKitab`. |
| `slug` | TEXT, NOT NULL, UNIQUE | Natural key; all API get/update/delete operate by slug. Creating a duplicate slug returns `ErrHaditsKitabConflict`. |
| `nama` | TEXT, NOT NULL | Book name (Latin). |
| `nama_arab` | TEXT, nullable | Book name in Arabic script. |
| `deskripsi` | TEXT, nullable | Free-text description. |
| `perawi` | TEXT, nullable | Narrator(s) at the book level. |
| `urutan` | INTEGER, NOT NULL, DEFAULT 0 | Display ordering within a scope bucket. |
| `scope` | TEXT, NOT NULL, DEFAULT `'both'`, CHECK IN (`'hadits'`,`'maktabah'`,`'both'`) | Which Pustaka bucket the kitab shows in: `hadits` = Himpunan, `maktabah` = Maktabah Syamilah, `both` = both. (Note: `CreateKitab`/`UpdateKitab` default an empty scope to `'hadits'`, not the DDL default.) |
| `jumlah_halaman` | INTEGER, NOT NULL, DEFAULT 0 | Admin-set target page count for the teaching plan / raport coverage. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis; bumped on update. |

### relationships

`hadits_bab.kitab_id` and `hadits.kitab_id` reference `hadits_kitab.id`
**logically, with no FK**. `DeleteKitab` cascades manually in a transaction
(deletes child hadits, then hadits_bab, then the kitab).

---

## `hadits_bab`

Chapter (*bab*) within a hadith kitab — the middle tier of the Hadits library
(migration 017). Each row belongs to a kitab and is numbered within it. Seeded
together with the kitab/hadits corpus from the gzipped seed bundle, and managed
transactionally by `HaditsStore` (deleting a kitab cascades a manual delete of its
bab + hadits rows). Note: only `created_at` exists — there is **no** `updated_at`
on this table. Never altered after migration 017.

```sql
CREATE TABLE hadits_bab (
  id          TEXT PRIMARY KEY,                 -- ULID
  kitab_id    TEXT NOT NULL,                    -- logical ref to hadits_kitab.id (no FK)
  nomor       INTEGER NOT NULL,                 -- chapter number within the kitab
  nama        TEXT NOT NULL,
  deskripsi   TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_hadits_bab_kitab ON hadits_bab(kitab_id, nomor);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID string. |
| `kitab_id` | TEXT, NOT NULL | References `hadits_kitab.id` logically; **no FK constraint declared**. Cleanup is done in app code (`DeleteKitab` deletes child bab rows in a transaction). |
| `nomor` | INTEGER, NOT NULL | Chapter number within the kitab; the `(kitab_id, nomor)` index drives ordered listing. |
| `nama` | TEXT, NOT NULL | Chapter title. |
| `deskripsi` | TEXT, nullable | Chapter description. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis. No `updated_at` column on this table. |

---

## `hadits`

The leaf of the Hadits library: an individual hadith (migration 017). Each row
belongs to a kitab and optionally to a bab (chapters are optional, so `bab_id` is
nullable). Holds the full text in Arabic, Latin transliteration, and Indonesian +
English translation, plus narrator, authenticity grade, and original source. This
is the bulk of the seed bundle (~40k rows). Search in `ListHadits` runs
case-insensitive `LIKE` across `teks_arab`, `teks_latin`, `terjemahan`, and
`terjemahan_en`. Read-mostly: written almost entirely by the seed, deleted in
cascade when a kitab is removed. Never altered after migration 017.

```sql
CREATE TABLE hadits (
  id            TEXT PRIMARY KEY,               -- ULID
  kitab_id      TEXT NOT NULL,                  -- logical ref to hadits_kitab.id (no FK)
  bab_id        TEXT,                           -- logical ref to hadits_bab.id (no FK), nullable
  nomor         INTEGER NOT NULL,               -- hadith number within the kitab
  teks_arab     TEXT,
  teks_latin    TEXT,
  terjemahan    TEXT,                           -- Indonesian translation
  terjemahan_en TEXT,                           -- English translation
  perawi        TEXT,                           -- narrator
  derajat       TEXT,                           -- authenticity grade (e.g. sahih/hasan/da'if)
  sumber_asli   TEXT,                           -- original source reference
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_hadits_kitab ON hadits(kitab_id, nomor);
CREATE INDEX idx_hadits_bab   ON hadits(bab_id, nomor);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID string. |
| `kitab_id` | TEXT, NOT NULL | References `hadits_kitab.id` logically; **no FK**. |
| `bab_id` | TEXT, nullable | References `hadits_bab.id` logically; **no FK**. Null when the hadith isn't filed under a chapter. |
| `nomor` | INTEGER, NOT NULL | Hadith number within the kitab; drives ordered listing. |
| `teks_arab` | TEXT, nullable | Arabic text. |
| `teks_latin` | TEXT, nullable | Latin transliteration. |
| `terjemahan` | TEXT, nullable | Indonesian translation. |
| `terjemahan_en` | TEXT, nullable | English translation. |
| `perawi` | TEXT, nullable | Narrator of this specific hadith. |
| `derajat` | TEXT, nullable | Authenticity grade (free text). |
| `sumber_asli` | TEXT, nullable | Original-source citation. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis. |

### Migration history for the Hadits library

| # | Migration | Effect |
|---|---|---|
| 017 | `017_hadits` | Created the 3-table Hadits library: `hadits_kitab` (with scope CHECK and indexes on scope + urutan), `hadits_bab` (created_at only, no updated_at; index on kitab_id, nomor), and `hadits` (full text + translations; indexes on kitab_id,nomor and bab_id,nomor). Ported from sitrac-v3. No later migration alters these. |

---

## `quran_manqul_note`

The Qur'an-side table: a per-user *manqul* annotation attached to either a single
word within an ayah (`word_idx >= 0`) or to a whole ayah (`word_idx = -1`). Ported
1:1 from sitrac-v3's `QuranManqulNote` model (migration 019). Unlike the other
library tables this is **not a seeded catalog** — there is no Qur'an-text table in
gnrs (the Qur'an text itself lives in the SPA/static assets); this table only
stores user-authored notes keyed to ayah coordinates. Written by
`ManqulStore.Upsert`, which deletes the row when the note text is empty (so a blank
note is a delete, not an empty string). The unique key
`(user_id, kunci_ayat, word_idx)` backs the upsert's `ON CONFLICT`. Never altered
after migration 019.

```sql
CREATE TABLE quran_manqul_note (
  id           TEXT PRIMARY KEY,                -- ULID
  user_id      TEXT NOT NULL,                   -- logical ref to users.id (no FK)
  kunci_ayat   TEXT NOT NULL,                   -- ayah key, e.g. "{surah}:{ayah}"
  word_idx     INTEGER NOT NULL,                -- word index, or -1 for whole-ayah note
  teks         TEXT NOT NULL,                   -- note body (empty => row deleted by Upsert)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, kunci_ayat, word_idx)
);

CREATE INDEX idx_manqul_user ON quran_manqul_note(user_id, kunci_ayat);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID string, generated on insert. |
| `user_id` | TEXT, NOT NULL | Owning user. References `users.id` **logically only — no FK** (consistent with gnrs's deliberate avoidance of FKs against users for soft-removal). |
| `kunci_ayat` | TEXT, NOT NULL | Ayah key in `"{surah}:{ayah}"` form; `List(surah)` filters with `kunci_ayat LIKE '{surah}:%'`. |
| `word_idx` | INTEGER, NOT NULL | Zero-based word index within the ayah; the sentinel `-1` means the note applies to the whole ayah. |
| `teks` | TEXT, NOT NULL | Note body. `Upsert` with empty `teks` **deletes** the row instead of storing it. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis; on upsert set to `excluded.updated_at`. |
| — | UNIQUE(`user_id`,`kunci_ayat`,`word_idx`) | One note per (user, ayah, word); backs the upsert `ON CONFLICT`. |

### Migration history for `quran_manqul_note`

| # | Migration | Effect |
|---|---|---|
| 019 | `019_quran_manqul` | Created `quran_manqul_note` (per-user note on a Qur'an word/ayah) with `UNIQUE(user_id, kunci_ayat, word_idx)` and `idx_manqul_user(user_id, kunci_ayat)`. Ported 1:1 from sitrac-v3 `QuranManqulNote`. No later migration alters it. |

---

## `compact_ajar`  (the **Doa** library)

The Doa library is physically the `compact_ajar` table (migration 018) —
`DoaStore` (`internal/store/doa.go`) reads and writes it; there is no table
literally named `doa`. Ported verbatim from sitrac-v3's `CompactAjar` (74-row
seed) and kept column-for-column with the source for round-tripping. Each row is a
small teachable item — a *doa*, hafalan, or asmaul-husna entry — with Arabic text
+ transliteration + translation and optional links to a Qur'an surah/ayah or a
hadith. Ships **pre-seeded**: the same `SeedHadits` pass that loads the hadith
corpus also replays `INSERT OR IGNORE INTO compact_ajar` rows from the gzipped
bundle (it re-runs when either `hadits` or `compact_ajar` is empty, so a
freshly-added `compact_ajar` on an already-seeded DB still gets backfilled). After
seeding, admins can create/update/delete via `DoaStore`; the public list
(`DoaStore.List`) only returns rows where `aktif = 1`.

**Canonical shape reflects migration 028:** the `kategori` *column survives* but
its index is dropped. 028 deliberately did **not** drop the column (the gzipped
seed bundle's INSERTs still reference `kategori`); it only retired
`idx_compact_kategori`, the index that powered the old "filter by kategori" UX. The
app code no longer reads or writes `kategori`.

```sql
CREATE TABLE compact_ajar (
  id           TEXT PRIMARY KEY,                -- ULID
  nama         TEXT NOT NULL,                   -- item name / title
  deskripsi    TEXT,
  kategori     TEXT,                            -- retained for seed-bundle compat; unused by app (index dropped in 028)
  aktif        INTEGER NOT NULL DEFAULT 1,      -- 1 = active/visible, 0 = hidden; List() filters aktif = 1
  tipe         TEXT,                            -- item type (doa / hafalan / asmaul husna, free text)
  teks_arab    TEXT,
  teks_latin   TEXT,
  terjemahan   TEXT,
  sumber       TEXT,                            -- source citation
  quran_surah  INTEGER,                         -- optional Qur'an surah number
  quran_ayat   TEXT,                            -- optional Qur'an ayah ref (text)
  hadits_id    TEXT,                            -- optional logical ref to hadits.id (no FK)
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_compact_tipe ON compact_ajar(tipe);
-- idx_compact_kategori was created in 018 and DROPPED in 028; it is NOT part of the final shape.
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID string, generated in `DoaStore.Create`. |
| `nama` | TEXT, NOT NULL | Item name/title; trimmed on write. Public list orders by `nama ASC`. |
| `deskripsi` | TEXT, nullable | Description. |
| `kategori` | TEXT, nullable | **Retired column.** Kept only so the gzipped seed bundle's INSERTs still apply; app store/handler/frontend no longer read or write it. Its index was dropped in migration 028. |
| `aktif` | INTEGER, NOT NULL, DEFAULT 1 | Boolean-as-int (1/0). `DoaStore.List` returns only `aktif = 1`. Mapped to Go `bool`. |
| `tipe` | TEXT, nullable | Item type (doa / hafalan / asmaul-husna), free text; indexed by `idx_compact_tipe`. |
| `teks_arab` | TEXT, nullable | Arabic text. |
| `teks_latin` | TEXT, nullable | Latin transliteration. |
| `terjemahan` | TEXT, nullable | Translation. |
| `sumber` | TEXT, nullable | Source citation. |
| `quran_surah` | INTEGER, nullable | Optional Qur'an surah number linking the item to scripture. |
| `quran_ayat` | TEXT, nullable | Optional Qur'an ayah reference (stored as text, e.g. a range). |
| `hadits_id` | TEXT, nullable | Optional reference to `hadits.id`; **logical only, no FK**. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis; bumped on update. |

### Migration history for `compact_ajar`

| # | Migration | What it did | Why |
|---|---|---|---|
| 018 | `018_compact_ajar` | Created `compact_ajar` with all 15 columns plus indexes `idx_compact_kategori` and `idx_compact_tipe`. (Despite the project's `ajar`/`diajarkan` naming, 018 creates **only** this library table — there was never a standalone `ajar` table; the "doa" `library_ref` target throughout the schema is a `compact_ajar.id`.) | Introduce the Doa / hafalan / asmaul-husna library, ported verbatim from sitrac-v3's `CompactAjar`. |
| 028 | `028_drop_doa_kategori` | `DROP INDEX IF EXISTS idx_compact_kategori;` — index only. **Column `kategori` left in place.** | The "filter by kategori" UX was retired and app code stopped reading/writing the column, but the gzipped hadits/doa seed bundle still INSERTs `kategori`, so physically dropping the column would break seeding. Only the now-useless index was removed. |

---

## `karakter_luhur`

An editable catalog of *karakter luhur* (noble-character) items — the
database-backed replacement for the static `KARAKTER_LUHUR` array previously
hard-coded in the SPA bundle (migration 016). Each row is one character item
belonging to a named parent group (e.g. "4 Tali Keimanan", "5 Bisa", "Trisukses"),
with bilingual labels (Indonesian + English) and two ordering integers:
`parent_urutan` orders the groups, `item_urutan` orders items within a group. On
first boot `SeedKarakter` (`internal/store/karakter.go`, invoked from
`cmd/server/main.go`) populates the **canonical 29 entries across 6 groups** if the
table is empty — idempotent. After that, admins add/edit/delete individual items,
and `RenameGroup` / `DeleteGroup` operate on a whole group by matching on `parent`.
Never altered after migration 016.

```sql
CREATE TABLE karakter_luhur (
  id            TEXT PRIMARY KEY,               -- ULID
  parent        TEXT NOT NULL,                  -- group name (Indonesian), e.g. "4 Tali Keimanan"
  parent_en     TEXT,                           -- group name (English)
  parent_urutan INTEGER NOT NULL DEFAULT 0,     -- group display order
  label_id      TEXT NOT NULL,                  -- item label (Indonesian)
  label_en      TEXT,                           -- item label (English)
  item_urutan   INTEGER NOT NULL DEFAULT 0,     -- item order within the group
  catatan       TEXT,                           -- optional note
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_karakter_parent ON karakter_luhur(parent_urutan, item_urutan);
```

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT, PK | ULID string. |
| `parent` | TEXT, NOT NULL | Group name in Indonesian; the grouping/rename/delete key (`RenameGroup`/`DeleteGroup` match on this). |
| `parent_en` | TEXT, nullable | Group name in English. |
| `parent_urutan` | INTEGER, NOT NULL, DEFAULT 0 | Display order of the group; first sort key in listing and in `idx_karakter_parent`. |
| `label_id` | TEXT, NOT NULL | Item label in Indonesian. |
| `label_en` | TEXT, nullable | Item label in English. |
| `item_urutan` | INTEGER, NOT NULL, DEFAULT 0 | Order of the item within its group; second sort key. |
| `catatan` | TEXT, nullable | Optional free-text note. |
| `created_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis. |
| `updated_at` | TEXT, NOT NULL, DEFAULT now | ISO-8601 UTC millis; bumped on update (including group rename). |

### Seed contents for `karakter_luhur`

`SeedKarakter` inserts 6 groups / 29 items (from `karakterSeed` in `karakter.go`),
e.g. "4 Tali Keimanan" (4 items), "6 Tabi'at Luhur" (6), "5 Bisa (Karakter
Sukses)" (5), "3 Sukses Generus (Trisukses)" (3), "5 Sukses Pembinaan Generus
(Panca Bina)" (5), "6 Karakter Sosial Luhur" (6). Each item carries both
`label_id` and `label_en`; `parent_urutan` 1..6 and `item_urutan` is the index
within the group. Comment in the source notes the seed mirrors
`web/app/src/lib/pustakaData.ts KARAKTER_LUHUR` and is kept in sync manually.

### Migration history for `karakter_luhur`

| # | Migration | Effect |
|---|---|---|
| 016 | `016_karakter_luhur` | Created `karakter_luhur` (id, parent, parent_en, parent_urutan, label_id, label_en, item_urutan, catatan, created_at, updated_at) + index `idx_karakter_parent(parent_urutan, item_urutan)`. DB-backed replacement for the static SPA `KARAKTER_LUHUR` list; seeded with the canonical 29 entries on first boot. No later migration alters it. |

---

## How kurikulum → rencana → diajarkan → pencapaian relate (planning vs delivery vs mastery)

The curriculum subsystem has a three-stage flow plus a closing mastery layer, all
sharing the **same kurikulum-vs-library polymorphism** (`materi_ajar_id` xor a
`(library_kind, library_aspect, library_ref)` triple) but answering different
questions:

- **Catalog (kurikulum):** `tingkat` defines age levels; `materi_ajar` is the
  master list of teachable items (linked to a level by `tingkat.nama`).
  `materi_library_ref` and `materi_relation` enrich a materi with structured
  library links and same-content-different-age siblings respectively. — *what exists.*
- **Plan (rencana):** `rencana_bulanan` is a per-kelas, per-month bundle; its
  `rencana_bulanan_item` rows reference *either* a `materi_ajar` (kurikulum slot)
  *or* library content (`library_kind`+`library_ref`, since migration 026).
  Completion here (`selesai`) is plan-level bookkeeping. — *what we intend to teach
  this month.*
- **Delivery (diajarkan):** `sesi_materi_diajarkan` records what was **actually
  projected** in a live sesi — appended each time the guru switches materi, with
  end-sesi confirmation (`needs_parent_review`, `parent_note`) and
  finished-vs-abandoned tracking (`completed`, added 037). — *what we actually
  taught in this session.*
- **Mastery (pencapaian)** closes the loop: per-murid status
  (`belum`→`proses`→`tuntas`) against either a `materi_ajar` or, since migration
  040, a library ref. `materi_library_ref` lets a completed library item auto-flip
  the linked curriculum materi to `tuntas`.

> **No foreign keys (except into `sesi`).** gnrs deliberately omits FK constraints
> across this subsystem so rows survive soft removal of the things they point at
> (kelas, user, materi, library item). `kelas_id`, `materi_ajar_id`,
> `murid_user_id`, `created_by`/`recorded_by`, `library_ref`, and the
> `tingkat`↔`materi_ajar.tingkat` link are all **informal TEXT links** validated
> only in app code. The **only** real FKs are `sesi_library.sesi_id → sesi(id)`
> and `sesi_materi_diajarkan.sesi_id → sesi(id)` (both `ON DELETE CASCADE`).

---

## `settings`

Global key/value store for singleton configuration that doesn't deserve its own
table. Created in migration `031` and used today for **branding**: the instansi
(institution) display name and an embedded logo. Rows are written by the admin
Settings UI (`internal/handler/settings.go` → `store.Settings.Set`) and by two
boot-time seeders. The table is read in bulk by `store.Settings.GetAll`, which
returns every row as a `map[string]string`. There is no `id`/ULID and no
`created_at` here — the natural string `key` is the primary key, and only
`updated_at` is tracked (as a TEXT ISO-8601 UTC string, not a `DATETIME`).
Lifecycle: rows are created on demand via upsert and effectively never deleted in
normal operation (clearing a value writes an empty string but keeps the row, per
the `Set` doc comment).

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- No additional indexes (the PRIMARY KEY on `key` is the only one).

-- Seeded on first creation by migration 031:
INSERT OR IGNORE INTO settings (key, value) VALUES ('instansi_name', 'US');
```

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT, PRIMARY KEY (NOT NULL) | The setting name. Known keys: `instansi_name` (brand/suffix string, defaults to `'US'` mirroring the old hard-coded value) and `instansi_logo` (a `data:image/png;base64,…` data-URL). Any future single-row config key can be added without a migration. |
| `value` | TEXT, NOT NULL | The stored value. Always non-null; "cleared" settings keep the row with an empty string rather than being deleted. For `instansi_logo` this is a base64 PNG data-URL. |
| `updated_at` | TEXT, NOT NULL, DEFAULT `strftime('%Y-%m-%dT%H:%M:%fZ','now')` | ISO-8601 UTC timestamp **stored as TEXT** (not a `DATETIME`). On upsert, Go writes `time.Now().UTC().Format("2006-01-02T15:04:05.000Z")`; the `SeedInstansiLogo` upsert refreshes it via the same `strftime` expression. |

### relationships

None. `settings` has no foreign keys and is referenced by no other table — it is a
standalone global config table. It carries no ULID primary key (unlike most gnrs
tables); its PK is the natural `key` string.

### Migration history for `settings`

| # | Migration | Change | Why |
|---|---|---|---|
| 031 | `031_settings` | `CREATE TABLE settings (key, value, updated_at)`; seed `INSERT OR IGNORE … ('instansi_name','US')`. Down: `DROP TABLE IF EXISTS settings`. | Introduce a key/value config table for branding (instansi name + logo data-URL) and any future singleton config, instead of giving each such value its own table. The default `instansi_name` of `US` mirrors the previously hard-coded brand suffix. No migration after 031 (through 040) touches `settings`. |

---

## `schema_migrations`

Internal bookkeeping table created and owned **entirely by
[golang-migrate](https://github.com/golang-migrate/migrate)**, not by any project
migration file. It tracks which migration version has been applied so `m.Up()`
(called from `store.Migrate` in `internal/store/store.go`) knows where to resume.
gnrs uses the `golang-migrate/v4` PostgreSQL driver (`database/postgres`) with
migrations embedded from `internal/store/migrations/*.sql` via `source/iofs`.
**Never created, edited, or queried by application code; never hand-edited.** Its
exact shape is defined by the migrate library, not this repo, so the DDL below is
the library's standard PostgreSQL layout (documented, not authored here).

```sql
-- Managed by golang-migrate (PostgreSQL driver). NOT defined in this repo's
-- migrations/ directory — created automatically on first Migrate().
CREATE TABLE schema_migrations (
  version BIGINT  NOT NULL PRIMARY KEY,  -- highest applied migration number (e.g. 40)
  dirty   BOOLEAN NOT NULL               -- 1 if a migration failed mid-apply and needs manual repair
);
```

| Column | Type | Notes |
|---|---|---|
| `version` | BIGINT, NOT NULL, PRIMARY KEY | The numeric prefix of the most recently applied migration file (e.g. `40` after `040_pencapaian_library`). golang-migrate keeps exactly one row here. |
| `dirty` | BOOLEAN, NOT NULL | Set to `1` while a migration is being applied and cleared to `0` on success. A stuck `dirty = 1` means a migration failed partway; migrate refuses to proceed until the version is `force`-reset. This is why migrations must never be hand-edited or re-numbered. |

### relationships

None. Standalone library-internal table; no FKs in or out. Application code
(`store.Migrate`) only invokes `m.Up()` and tolerates `migrate.ErrNoChange`; it
never reads or writes `schema_migrations` directly.

---

## Enums catalog

All app-managed enums in one place. Stored values are exactly as shown; UI labels
are localized separately. Columns marked **no SQL CHECK** are enum-shaped in
application code only — SQLite does not reject invalid values.

| Table | Column | Values | Notes |
|---|---|---|---|
| `users` | `role` | `admin`, `staff`, `pengurus`, `guru`, `ortu`, `murid` | TEXT NOT NULL DEFAULT `'staff'` CHECK. 001 allowed only `admin`/`staff`; 007 widened to all six. `murid` → Student projection, `guru` → Teacher projection. Mirrors `model.AllRoles`. |
| `users` | `membership_status` | `active`, `left`, `retired` | TEXT NOT NULL DEFAULT `'active'` CHECK (008). `active` = ongoing, `left` = murid keluar, `retired` = guru purna. Unified superset of both projection status enums. |
| `users` | `level` | `Caberawit`, `Pra Remaja`, `Remaja`, `Pra Nikah` | TEXT nullable, CHECK (`level IS NULL OR …`) (008). Murid-only; surfaced only by the Student projection. |
| `users` | `gender` | `male`, `female` | TEXT nullable, CHECK (`gender IS NULL OR …`) (008). Student treats it as present; Teacher treats it as nullable; guru rows backfilled in 030. |
| `users` | `kelompok` | `California`, `Chicago`, `New Hampshire`, `Canada` | **No SQL CHECK** — enum enforced in the app only (`model.StudentKelompoks` + frontend dropdown). The column is plain nullable TEXT. |
| `users` | `parent_phone_region` | `ID`, `SG`, `US`, `CA` | TEXT nullable, CHECK (`… IS NULL OR …`) (034). Combined with `parent_phone` to build E.164 wa.me links. Murid-only. |
| `users` | `active` | `0`, `1` | INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)) (007). Boolean soft-disable; stored int, exposed as bool. Not surfaced in Student/Teacher JSON. |
| `users` | `hide_dob` | `0`, `1` | INTEGER NOT NULL DEFAULT 0 (020). Boolean; **no SQL CHECK**. 1 hides `date_of_birth` from non-admin callers. |
| `users` (Student projection) | `status` (← `membership_status`) | `active`, `left` | `StudentStatus`; subset of `membership_status`. `active` = masih aktif, `left` = murid keluar. |
| `users` (Teacher projection) | `status` (← `membership_status`) | `active`, `retired` | `TeacherStatus`; subset of `membership_status`. `active` = masih mengajar, `retired` = guru purna. |
| `attendances` | `status` | `hadir`, `izin_murid`, `izin_guru`, `by_vn`, `alfa` | TEXT NOT NULL CHECK. 032 had 4 values; `alfa` added by 039 (rebuild). `hadir`=present, `izin_murid`=student-excused, `izin_guru`=teacher-excused/cancelled, `by_vn`=via voice note, `alfa`=absent without prior notice. Mirrors `model.AttendanceStatus`. |
| `bacaan_log` | `source` | `pengajian`, `mandiri` | TEXT NOT NULL DEFAULT `'mandiri'` CHECK (023). `pengajian` = recorded during a mentored session; `mandiri` = self-study. Store coerces unknown values to `mandiri`. |
| `sesi` | `library_kind` | `kurikulum`, `quran`, `hadits`, `tilawati`, `doa` | Legacy single-shot column (022). **No SQL CHECK** — app-level only. Authoritative multi-source store is `sesi_library`. |
| `sesi` | `library_aspect` | `reciting`, `memorizing`, `review`, `manqul` | App-level aspect values (per 022 comment); **no SQL CHECK**; nullable. Same value space reused by `sesi_library.library_aspect`. |
| `sesi` | `live_display_mode` | (app-defined, not constrained) | Free TEXT, **no SQL CHECK**; specific modes defined in frontend/handler code (033). Nulled by `SetEnded`. |
| `sesi_library` | `library_kind` | `quran`, `hadits`, `tilawati`, `doa` | TEXT NOT NULL CHECK (036). `kurikulum` is intentionally excluded — kurikulum materi live in `sesi_materi`; app code skips kurikulum/blank kind on write. |
| `sesi_materi_diajarkan` | `kind` | `kurikulum`, `quran`, `hadits`, `tilawati`, `doa` | TEXT NOT NULL CHECK (035). `kurikulum` **is** allowed here (uses `materi_ajar_id`, empty `ref`); the other four use `ref` (quran=`surah`\|`surah:ayat`\|`surah:from-to`, hadits=`kitab/bab`, tilawati=`jilid/halaman`, doa=`compact_ajar.id`). |
| `sesi_materi_diajarkan` | `needs_parent_review` | `0`, `1` | Boolean INTEGER, DEFAULT 0 (035); toggled in the end-sesi confirm dialog. |
| `sesi_materi_diajarkan` | `completed` | `0`, `1` | Boolean INTEGER, DEFAULT 0 (037); finished vs abandoned-midway. |
| `tahun_ajaran` | `active` | `0`, `1` | Boolean. "Exactly one row = 1" is an **application-level invariant** enforced by `SetActive` (transactional demote-all-then-set), not a SQL constraint or partial index. |
| `tahun_ajaran` | `semester1_start_month` | `1`..`12` | INTEGER CHECK BETWEEN 1 AND 12, DEFAULT 7 (July). |
| `tahun_ajaran` | `semester2_start_month` | `1`..`12` | INTEGER CHECK BETWEEN 1 AND 12, DEFAULT 1 (January). |
| `materi_ajar` | `kategori` | `baru`, `lanjutan`, `mengulang` | TEXT NOT NULL DEFAULT `'baru'` CHECK (009). App defaults empty input to `baru`. |
| `materi_library_ref` | `library_kind` | `quran`, `hadits`, `tilawati`, `doa` | TEXT NOT NULL CHECK (029). |
| `rencana_bulanan_item` | `library_kind` | `quran`, `hadits`, `tilawati`, `doa` | TEXT nullable. **No SQL CHECK** on this table (unlike `materi_library_ref`/`sesi_materi_diajarkan`) — enum enforced only in app code. |
| `pencapaian` | `status` | `belum`, `proses`, `tuntas` | TEXT NOT NULL DEFAULT `'belum'` CHECK (027). `belum`=not started, `proses`=in progress, `tuntas`=completed/mastered. Upsert upgrades to `tuntas` but never downgrades a `tuntas` row on conflict. |
| `pencapaian` | `library_kind` | `quran`, `hadits`, `tilawati`, `doa` | Nullable; CHECK (`… IS NULL OR …`) (040). Set only for library entries. Same four-value set as `materi_library_ref.library_kind`. |
| `pencapaian` | `library_aspect` | `reciting`, `memorizing`, `review`, `manqul` | Nullable; CHECK (`… IS NULL OR …`) (040). Part of the library uniqueness key (`COALESCE(library_aspect,'')`). |
| `hadits_kitab` | `scope` | `hadits`, `maktabah`, `both` | TEXT NOT NULL DEFAULT `'both'` CHECK (017). `hadits` = Himpunan bucket, `maktabah` = Maktabah Syamilah bucket, `both` = both. App code (`CreateKitab`/`UpdateKitab`) defaults an empty scope to `'hadits'`, overriding the DDL default. |
| `compact_ajar` | `aktif` | `1`, `0` | INTEGER NOT NULL DEFAULT 1 — boolean-as-int. 1 = active/visible (`DoaStore.List` returns only `aktif=1`), 0 = hidden. Not a TEXT+CHECK enum. |
| `quran_manqul_note` | `word_idx` | `-1`, `0`, `1`, `2`, … | INTEGER NOT NULL — not a CHECK enum, but semantically constrained by app code: `-1` = note on the whole ayah; `>=0` = zero-based word index within the ayah. |
| `settings` | `key` | `instansi_name`, `instansi_logo` | **Not a CHECK enum** — `key` is a free-form TEXT PRIMARY KEY. These are the only keys current code writes (031 seeds `instansi_name='US'`; `SeedInstansiLogo` + the Settings handler write `instansi_logo`). Future keys need no migration. |
| `schema_migrations` | `dirty` | `0`, `1` | Boolean managed by golang-migrate: 0 = clean/applied, 1 = a migration failed mid-apply and the version must be force-reset. Library-managed; not a CHECK enum. |

---

## Migration timeline

All migrations in `internal/store/migrations/`, applied in numeric order on every
server boot by `store.Migrate` (`m.Up()`). Each has a paired `*.down.sql`.

| # | Migration | Effect |
|---|---|---|
| 001 | `init` | Create `users(id, email UNIQUE, password, name, role DEFAULT 'staff' CHECK IN('admin','staff'), created_at, updated_at)` **and** the original (now-removed) `students` table (`student_id` UNIQUE, `name`, `date_of_birth` NOT NULL, `gender` NOT NULL CHECK, `address`, `parent_name`/`parent_phone` NOT NULL, `parent_email`; `idx_students_name`). |
| 002 | `add_username` | `ALTER TABLE users ADD COLUMN username TEXT`; partial unique index `idx_users_username` WHERE username IS NOT NULL. |
| 003 | `create_teachers` | Create the original (now-removed) `teachers` table: `name` NOT NULL, `nickname`, `kelompok`/`desa`/`daerah` NOT NULL, `joined_at`, `retired_at`, `status` CHECK(active/retired) DEFAULT active, `notes`; indexes on name/status/daerah/desa/kelompok. |
| 004 | `redesign_students` | DROP + recreate `students` for the PPG Generus model: removed `student_id`/`gender`/`address`; added `nickname`, `level` CHECK, `kelompok` (free text), `joined_at`/`left_at`/`leave_reason`, `status` CHECK(active/left) DEFAULT active; relaxed parent fields to optional. New name/level/kelompok/status indexes. |
| 005 | `kelompok_enum` | Normalize `students.kelompok` variants to four canonical values, then rebuild `students` adding `kelompok` CHECK(California/Chicago/New Hampshire/Canada); recreate indexes. |
| 006 | `add_gender` | Re-add `students.gender` (ADD COLUMN, name-list backfill, catch-all female), rebuild `students` with `gender TEXT NOT NULL CHECK(male/female)`; add `idx_students_gender`. |
| 007 | `widen_user_roles` | Rebuild `users` (rename → create → copy → drop): widen `role` CHECK to `admin/staff/pengurus/guru/ortu/murid`; add `active INTEGER NOT NULL DEFAULT 1 CHECK(0,1)`. Recreate `idx_users_username`; add `idx_users_role`, `idx_users_active`. (Enables the role-based projections.) |
| 008 | `unify_user_profile` | **The unification.** Add 17 profile columns to `users` (shared `nickname`/`date_of_birth`/`gender`/`no_hp`/`alamat`/`kelompok`; murid-only `level`/`parent_name`/`parent_phone`/`parent_email`; guru-only `desa`/`daerah`/`notes`; lifecycle `joined_at`/`left_at`/`leave_reason`/`membership_status` NOT NULL DEFAULT active CHECK(active/left/retired)) + indexes. Rename `students`→`students_legacy_008`, `teachers`→`teachers_legacy_008` (not dropped here); the `main.go` boot migration copies legacy rows into `users` (murid/guru, bcrypt) then drops the legacy tables. After this no standalone `students`/`teachers` table exists. |
| 009 | `kurikulum` | Create `tingkat (id, nama UNIQUE, urutan)` + `idx_tingkat_urutan`, and `materi_ajar` (15 quoted-camelCase columns, `kategori` CHECK(baru/lanjutan/mengulang)) + indexes on tingkat/tema/semester. `materi_ajar` is never altered again. |
| 010 | `tingkat_umur` | `ALTER TABLE tingkat ADD COLUMN umur INTEGER` + `idx_tingkat_umur`. (Adds a `tingkat` column, **not** a `users` column.) App `NormalizeKurikulumAges` later folds grade-based tingkat into age-based and rewrites `materi_ajar.tingkat`. |
| 011 | `user_photo` | `ALTER TABLE users ADD COLUMN photo_path TEXT` (filename under $PHOTOS_DIR; both projections expose it as `photoUrl`). |
| 012 | `sesi` | Create `sesi` (id, tanggal, mulai, selesai, topik, catatan, tingkat, materi_ajar_id, guru_id, started_at, ended_at, created_by, created_at, updated_at) + indexes on tanggal/tingkat/guru_id/materi_ajar_id. |
| 013 | `user_timezone` | `ALTER TABLE users ADD COLUMN timezone TEXT` (IANA tz name). |
| 014 | `kelas` | Create `kelas` (UNIQUE(nama,tahun)) + `idx_kelas_tingkat`/`idx_kelas_guru`; create `kelas_anggota` (PK(kelas_id,murid_user_id)) + `idx_kelas_anggota_murid`; `ALTER sesi ADD kelas_id` + `idx_sesi_kelas`. |
| 015 | `rencana_bulanan` | Create `rencana_bulanan` (UNIQUE(kelas_id,tahun,bulan), `bulan` CHECK 1–12) + `idx_rencana_bulanan_kelas`, and `rencana_bulanan_item` with `materi_ajar_id NOT NULL`, `UNIQUE(rencana_id, materi_ajar_id)` + two indexes. Kurikulum-only plan items. |
| 016 | `karakter_luhur` | Create `karakter_luhur` (bilingual group/item labels + ordering) + `idx_karakter_parent`. DB-backed replacement for the static SPA list. |
| 017 | `hadits` | Create the 3-table Hadits library: `hadits_kitab` (scope CHECK + indexes), `hadits_bab` (created_at only) and `hadits` (full text + translations + indexes). Ported from sitrac-v3. |
| 018 | `compact_ajar` | Create `compact_ajar` — the Doa/hafalan/asmaul-husna library — with 15 columns and indexes `idx_compact_kategori`/`idx_compact_tipe`. (Creates only this library table; there is no standalone `ajar` table. The "doa" `library_ref` target everywhere is a `compact_ajar.id`.) |
| 019 | `quran_manqul` | Create `quran_manqul_note` (per-user note on a Qur'an word/ayah) with `UNIQUE(user_id, kunci_ayat, word_idx)` + `idx_manqul_user`. Ported 1:1 from sitrac-v3. |
| 020 | `user_taaruf_fields` | Add taaruf biodata to `users`: `user_code` (+ partial unique `idx_users_user_code`), `tempat_lahir`, `pendidikan`, `pekerjaan`, `urutan INTEGER NOT NULL DEFAULT 0`, `hide_dob INTEGER NOT NULL DEFAULT 0`, `tgl_daftar TEXT`. Not surfaced by the Student/Teacher projections. |
| 021 | `tahun_ajaran` | Create `tahun_ajaran` (`nama` UNIQUE, `active`, `semester1_start_month` CHECK 1–12 DEFAULT 7, `semester2_start_month` CHECK 1–12 DEFAULT 1, `tanggal_mulai`, `tanggal_selesai`, timestamps) + `idx_tahun_ajaran_active`. |
| 022 | `sesi_library` | `ALTER sesi ADD COLUMN library_kind, library_aspect, library_ref` (all TEXT NULL). Legacy single-shot non-kurikulum library reference on a sesi. |
| 023 | `bacaan_log` | Create `bacaan_log` (id, user_id, recorded_by, source DEFAULT mandiri CHECK(pengajian/mandiri), tanggal, surah, ayat_from, ayat_to, catatan, sesi_id, timestamps) + indexes on (user_id,tanggal), recorded_by, sesi_id. No FKs. |
| 024 | `kelas_guru` | Create `kelas_guru` (PK(kelas_id,guru_user_id)) + `idx_kelas_guru_guru`. Backfills from `kelas.guru_user_id` (INSERT OR IGNORE … WHERE guru_user_id IS NOT NULL). Multiple guru per kelas. |
| 025 | `sesi_materi` | Create `sesi_materi` (PK(sesi_id,materi_ajar_id)) + `idx_sesi_materi_materi`. Backfills from `sesi.materi_ajar_id`. Multiple kurikulum materi per sesi. |
| 026 | `rencana_library` | Add `library_kind/library_aspect/library_ref` to `rencana_bulanan_item`, then rebuild (create-copy-drop-rename) to make `materi_ajar_id` NULLABLE and DROP the `UNIQUE(rencana_id, materi_ajar_id)` constraint. Re-create the two indexes + add `idx_rencana_item_library`. Final shape has no UNIQUE constraint. |
| 027 | `pencapaian` | Create `pencapaian` (per-murid × per-materi mastery): NOT-NULL `materi_ajar_id`, `status` CHECK(belum/proses/tuntas) default belum, grades/date/note/recorded_by, timestamps, `UNIQUE(murid_user_id, materi_ajar_id)`, indexes on murid/materi/status. |
| 028 | `drop_doa_kategori` | `DROP INDEX IF EXISTS idx_compact_kategori` — index only. The `kategori` **column is deliberately kept** (the gzipped hadits/doa seed bundle still INSERTs it; dropping the column would break seeding). App code no longer reads/writes `kategori`. |
| 029 | `materi_relations` | Create `materi_library_ref` (materi_ajar → library item; `library_kind` CHECK(quran/hadits/tilawati/doa); UNIQUE on the full tuple; created_at only) and `materi_relation` (canonical-ordered symmetric pair of materi_ajar ids; composite PK; CHECK `materi_a_id < materi_b_id`) + their indexes. |
| 030 | `pengajar_gender_backfill` | Data-only `UPDATE`: deterministically set `users.gender` for `role='guru'` rows with NULL/'' gender (hex last char of ULID seeds female/male). Idempotent; no schema change. Feeds the Pengajar gender pie chart. |
| 031 | `settings` | Create `settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`; seed `INSERT OR IGNORE ('instansi_name','US')`. Down: DROP TABLE IF EXISTS settings. No later migration alters `settings`. |
| 032 | `attendances` | Create `attendances` (id, date, duration_min, teacher_id, student_id, status CHECK(hadir/izin_murid/izin_guru/by_vn), materi, timestamps) + indexes on date, (student_id,date), (teacher_id,date), status. teacher_id/student_id reference `users` with NO FK (soft-removal). Ported from `fadhilkurnia/ppg` main. |
| 033 | `sesi_live_state` | `ALTER sesi ADD COLUMN live_materi_id, live_display_mode` (both TEXT NULL). Live-Stage projected-materi + display-mode state; nulled by `SetEnded`. |
| 034 | `user_parent_meta` | Add `users.parent_title TEXT` and `users.parent_phone_region TEXT CHECK(NULL or ID/SG/US/CA)` for the WhatsApp summary feature. Surfaced by the Student projection. |
| 035 | `sesi_materi_diajarkan` | Create the delivery/taught-material table. `kind` CHECK(kurikulum/quran/hadits/tilawati/doa); real FK `sesi_id → sesi(id) ON DELETE CASCADE`. Switching materi appends a new row. Indexes `idx_smd_sesi(sesi_id, taught_at)` + `idx_smd_materi`. |
| 036 | `sesi_library` | Create `sesi_library` (id, sesi_id FK→sesi ON DELETE CASCADE, `library_kind` CHECK(quran/hadits/tilawati/doa), library_aspect, library_ref NOT NULL, position DEFAULT 0, created_at) + `idx_sesi_library_sesi(sesi_id,position)`. Multi non-kurikulum library refs per sesi; authoritative over the legacy `sesi.library_*` columns. |
| 037 | `diajarkan_completed` | `ALTER sesi_materi_diajarkan ADD COLUMN completed INTEGER NOT NULL DEFAULT 0` and `ADD COLUMN completed_at TEXT`. Finished vs abandoned-midway ("ganti saja") distinction for the end-sesi summary. |
| 038 | `attendance_sesi_link` | `ALTER attendances ADD COLUMN sesi_id TEXT` (nullable, no FK) + `idx_attendances_sesi` (IF NOT EXISTS). Links attendance rows to a sesi so the one-shot historical importer is idempotent. |
| 039 | `attendance_alfa` | Extend `attendances.status` CHECK with `alfa`. Rebuild the table (create `attendances_new` with the 5-value CHECK and `sesi_id`, copy all rows, drop old, rename), then re-create all five indexes (date, student_date, teacher_date, status, sesi). Current canonical shape. |
| 040 | `pencapaian_library` | **Latest.** Rebuild `pencapaian` via `pencapaian_new`: make `materi_ajar_id` nullable, add `library_kind`/`library_aspect`/`library_ref` (CHECK-constrained), add the "exactly one of materi-or-library" table CHECK, copy existing rows as kurikulum entries, drop + rename, recreate indexes as partial, and replace `UNIQUE(murid,materi)` with two partial unique indexes (murid+materi, and murid+kind+COALESCE(aspect,'')+ref). Backfilled by `cmd/backfill-pencapaian` (run once after 040). |

---

## Adding a new migration

1. Pick the next number in `internal/store/migrations/` (e.g. `041_*`).
2. Create both `041_my_change.up.sql` and `041_my_change.down.sql`.
3. SQLite quirks to watch for:
   - You **cannot** `ALTER` a `CHECK` constraint (or relax `NOT NULL`) in place.
     Widening an enum requires the rename-rebuild-copy-drop dance — see 007
     (`users`), 039 (`attendances`), 040 (`pencapaian`), 026
     (`rencana_bulanan_item`) as templates.
   - Plain `ALTER TABLE … ADD COLUMN` is fine and is how most later migrations
     extend a table (e.g. 011/013/020/034 on `users`, 022/033 on `sesi`).
   - golang-migrate wraps each `.sql` file in a transaction — don't include
     `BEGIN`/`COMMIT` yourself.
4. **Respect the no-FK-on-people rule.** Do not add a foreign key from a new table
   to `users`. Person references are informal TEXT ids (resolved via
   `LEFT JOIN users` + `COALESCE(name, id)`) so people can be soft-removed. The
   only real FKs in this schema point at `sesi` (`ON DELETE CASCADE`).
5. **Keep the projection contract intact.** If you add a `users` column that the
   Generus/Pengajar pages need, also wire it into the `model.Student` /
   `model.Teacher` projection structs and `selectStudentCols` /
   `selectTeacherCols`; otherwise it is reachable only via `/api/users`.
6. Use ULID `TEXT` primary keys, `created_at`/`updated_at` (the curriculum/session
   tables use `TEXT … DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))`), and `TEXT`
   + `CHECK` for any enum that must be enforced at the DB level. App-only enums
   (validated in Go/frontend) may skip the CHECK, matching `users.kelompok` and the
   `sesi`/`rencana_bulanan_item` library columns.
7. Update this document: add a row to the migration timeline, the enums catalog if
   relevant, and revise the affected table section.
8. The server applies migrations on startup; restart locally to verify, and run
   `cmd/backfill-*` tools afterward if your migration needs a data backfill (as 040
   does with `cmd/backfill-pencapaian`).
