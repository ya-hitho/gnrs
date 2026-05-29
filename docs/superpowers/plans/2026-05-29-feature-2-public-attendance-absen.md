# Public Self-Service Attendance (/absen + wa.me) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port ppgus's unauthenticated `/absen` attendance form into gnrs — public roster endpoints + an attendance submission that returns a pre-built `wa.me` click-to-chat URL the SPA navigates to so WhatsApp opens with a verbatim Indonesian report pre-filled.

**Architecture:** A new `attendances.submitted_phone` column (migration 041) threads through `model.Attendance`, `store.AttendanceInput`, and the `Attendances` projection/scan/INSERT. A new `internal/messaging` package exposes only `Normalize`; a new `internal/httpx` IP rate limiter guards the POST. A new `handler.PublicAttendance` exposes `GET /api/public/teachers`, `GET /api/public/students`, `POST /api/public/attendances` registered **before** the `authMw` group in `cmd/server/main.go`. The frontend adds `api/public.ts`, `PublicAttendanceForm.tsx`, `pages/Absen.tsx`, an `App.tsx` route outside the auth gate, and `absen`/`absenStatus`/`validation` i18n namespaces.

**Tech Stack:** Go 1.25 + chi v5 + SQLite + golang-migrate iofs; go-playground/validator v10; React 18 + react-router-dom + @tanstack/react-query + react-hook-form + zod + react-i18next; Vite + Tailwind v3.

**Cross-feature contract (must stay identical across plans):** column `submitted_phone` (nullable TEXT); `model.Attendance.SubmittedPhone *string` json `"submittedPhone"`; `store.AttendanceInput.SubmittedPhone *string`; endpoints `GET /api/public/teachers`, `GET /api/public/students`, `POST /api/public/attendances`. Feature #3's dynamic-gate `directAPIAllowlist` MUST include `/api/public/` — that allowlist entry is owned by feature #3's plan, NOT this one. This plan registers the public routes only.

**Pre-flight (run once before Task 1):**
```bash
cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude
git status        # confirm you are on branch feat/ppgus-port-claude (off jalur-yasril)
go test ./... -count=1   # baseline green before any change
```

---

### Task 1: Migration 041 — `attendances.submitted_phone`
**Files:**
- Create: `internal/store/migrations/041_attendance_submitted_phone.up.sql`
- Create: `internal/store/migrations/041_attendance_submitted_phone.down.sql`
- Test: `internal/store/attendances_test.go` (new — exercised in Task 3; this task is verified by `store.Migrate` running clean)

- [ ] **Step 1: Write the failing test (migration applies cleanly)**
Create `internal/store/migrations_test.go` with a minimal test that opens a temp DB and runs `Migrate`, then asserts the new column exists. This fails today because the column does not exist.
```go
package store

import (
	"path/filepath"
	"testing"
)

func TestMigrate041SubmittedPhoneColumn(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('attendances') WHERE name = 'submitted_phone'`,
	).Scan(&count); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if count != 1 {
		t.Fatalf("submitted_phone column count = %d, want 1", count)
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/store/ -run TestMigrate041SubmittedPhoneColumn -v`
Expected: FAIL — `submitted_phone column count = 0, want 1` (column not yet added).
- [ ] **Step 3: Write the migration files**
Create `internal/store/migrations/041_attendance_submitted_phone.up.sql`:
```sql
-- 041 — Track the WhatsApp number used to submit a public /absen entry.
-- Nullable because the dashboard's own admin Kehadiran form does not collect it.
ALTER TABLE attendances ADD COLUMN submitted_phone TEXT;
```
Create `internal/store/migrations/041_attendance_submitted_phone.down.sql` (SQLite cannot DROP COLUMN here; rebuild mirroring the post-039 schema exactly — same column set incl. `sesi_id`, the `alfa` CHECK, and all five indexes — but WITHOUT `submitted_phone`):
```sql
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
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
```
- [ ] **Step 4: Run test to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/store/ -run TestMigrate041SubmittedPhoneColumn -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add internal/store/migrations/041_attendance_submitted_phone.up.sql internal/store/migrations/041_attendance_submitted_phone.down.sql internal/store/migrations_test.go
git commit -m "feat(store): add migration 041 attendances.submitted_phone"
```

---

### Task 2: Thread `SubmittedPhone` through model + store
**Files:**
- Modify: `internal/model/model.go:32-44` (Attendance struct — add field after `Materi`)
- Modify: `internal/store/attendances.go` (AttendanceInput:26-33, selectAttendance:50-57, Create INSERT:59-74, readAttendance:373-391)
- Test: `internal/store/attendances_test.go` (new)

- [ ] **Step 1: Write the failing test (Create with SubmittedPhone round-trips via Get)**
Create `internal/store/attendances_test.go`:
```go
package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
)

func newAttendanceTestDB(t *testing.T) (*Attendances, *Students, *Teachers) {
	t.Helper()
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewAttendances(db), NewStudents(db), NewTeachers(db)
}

func TestAttendanceCreateSubmittedPhoneRoundTrip(t *testing.T) {
	att, students, teachers := newAttendanceTestDB(t)
	ctx := context.Background()

	teacher, err := teachers.Create(ctx, TeacherInput{
		Name: "Yasril", Kelompok: "TK", Desa: "TD", Daerah: "TDA", Status: model.TeacherActive,
	})
	if err != nil {
		t.Fatalf("create teacher: %v", err)
	}
	student, err := students.Create(ctx, StudentInput{
		Name: "Abi", Gender: "male", Kelompok: ptr("Chicago"), Status: model.StudentActive,
	})
	if err != nil {
		t.Fatalf("create student: %v", err)
	}

	phone := "6281234567890"
	created, err := att.Create(ctx, AttendanceInput{
		Date:           time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC),
		TeacherID:      teacher.ID,
		StudentID:      student.ID,
		Status:         model.AttendanceHadir,
		SubmittedPhone: &phone,
	})
	if err != nil {
		t.Fatalf("create attendance: %v", err)
	}
	if created.SubmittedPhone == nil || *created.SubmittedPhone != phone {
		t.Fatalf("created.SubmittedPhone = %v, want %q", created.SubmittedPhone, phone)
	}

	got, err := att.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.SubmittedPhone == nil || *got.SubmittedPhone != phone {
		t.Fatalf("got.SubmittedPhone = %v, want %q", got.SubmittedPhone, phone)
	}
}

func TestAttendanceCreateNilSubmittedPhone(t *testing.T) {
	att, students, teachers := newAttendanceTestDB(t)
	ctx := context.Background()
	teacher, _ := teachers.Create(ctx, TeacherInput{
		Name: "Yasril", Kelompok: "TK", Desa: "TD", Daerah: "TDA", Status: model.TeacherActive,
	})
	student, _ := students.Create(ctx, StudentInput{
		Name: "Abi", Gender: "male", Kelompok: ptr("Chicago"), Status: model.StudentActive,
	})
	created, err := att.Create(ctx, AttendanceInput{
		Date: time.Now(), TeacherID: teacher.ID, StudentID: student.ID, Status: model.AttendanceHadir,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.SubmittedPhone != nil {
		t.Fatalf("SubmittedPhone = %v, want nil", created.SubmittedPhone)
	}
}

func ptr(s string) *string { return &s }
```
- [ ] **Step 2: Run test to verify it fails**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/store/ -run TestAttendanceCreate -v`
Expected: FAIL to **compile** — `unknown field 'SubmittedPhone' in struct literal of type AttendanceInput` and `created.SubmittedPhone undefined`.
- [ ] **Step 3: Write minimal implementation**
In `internal/model/model.go`, add the field to `Attendance` immediately after `Materi`:
```go
	Status      AttendanceStatus `json:"status"`
	Materi      *string          `json:"materi,omitempty"`
	// SubmittedPhone is set only for rows created via the public /absen
	// form (the submitter's normalized WhatsApp number). nil for admin rows.
	SubmittedPhone *string   `json:"submittedPhone,omitempty"`
	CreatedAt      time.Time `json:"createdAt"`
	UpdatedAt      time.Time `json:"updatedAt"`
```
In `internal/store/attendances.go`, add to `AttendanceInput`:
```go
type AttendanceInput struct {
	Date           time.Time
	DurationMin    *int
	TeacherID      string
	StudentID      string
	Status         model.AttendanceStatus
	Materi         *string
	SubmittedPhone *string
}
```
Extend `selectAttendance` projection — add `a.submitted_phone` immediately after `a.materi`:
```go
const selectAttendance = `
SELECT a.id, a.date, a.duration_min,
       a.teacher_id, COALESCE(t.name, a.teacher_id),
       a.student_id, COALESCE(s.name, a.student_id),
       a.status, a.materi, a.submitted_phone, a.created_at, a.updated_at
  FROM attendances a
  LEFT JOIN users t ON t.id = a.teacher_id
  LEFT JOIN users s ON s.id = a.student_id`
```
Update `Create`'s INSERT to add the `submitted_phone` column + placeholder (now 10 columns / 10 `?`):
```go
func (a *Attendances) Create(ctx context.Context, in AttendanceInput) (*model.Attendance, error) {
	id := ulid.Make().String()
	now := time.Now().UTC()
	_, err := a.db.ExecContext(ctx,
		`INSERT INTO attendances
		   (id, date, duration_min, teacher_id, student_id, status, materi,
		    submitted_phone, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.Date.UTC(), nullableAttInt(in.DurationMin),
		in.TeacherID, in.StudentID, string(in.Status), in.Materi,
		in.SubmittedPhone, now, now)
	if err != nil {
		return nil, err
	}
	return a.Get(ctx, id)
}
```
Update `readAttendance` to scan the new column (between `&a.Materi` and `&a.CreatedAt`) via `sql.NullString` → `*string`:
```go
func readAttendance(s scanner) (*model.Attendance, error) {
	var a model.Attendance
	var status string
	var durationMin sql.NullInt64
	var submittedPhone sql.NullString
	if err := s.Scan(
		&a.ID, &a.Date, &durationMin,
		&a.TeacherID, &a.TeacherName,
		&a.StudentID, &a.StudentName,
		&status, &a.Materi, &submittedPhone, &a.CreatedAt, &a.UpdatedAt,
	); err != nil {
		return nil, err
	}
	a.Status = model.AttendanceStatus(status)
	if durationMin.Valid {
		v := int(durationMin.Int64)
		a.DurationMin = &v
	}
	if submittedPhone.Valid {
		v := submittedPhone.String
		a.SubmittedPhone = &v
	}
	return &a, nil
}
```
NOTE: leave `Update` (`internal/store/attendances.go:80-96`) untouched — it must not null out `submitted_phone`. The `Stats` query (line 228+) selects no per-row projection, so it is unaffected.
- [ ] **Step 4: Run test to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/store/ -run TestAttendanceCreate -v`
Expected: PASS (both `TestAttendanceCreateSubmittedPhoneRoundTrip` and `TestAttendanceCreateNilSubmittedPhone`).
- [ ] **Step 5: Commit**
```bash
git add internal/model/model.go internal/store/attendances.go internal/store/attendances_test.go
git commit -m "feat(store): thread SubmittedPhone through attendance model and store"
```

---

### Task 3: `messaging.Normalize`
**Files:**
- Create: `internal/messaging/whatsapp.go`
- Test: `internal/messaging/whatsapp_test.go`

- [ ] **Step 1: Write the failing test**
Create `internal/messaging/whatsapp_test.go`:
```go
package messaging

import "testing"

func TestNormalize(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"local-zero", "081234567890", "6281234567890"},
		{"plus62", "+6281234567890", "6281234567890"},
		{"bare62", "6281234567890", "6281234567890"},
		{"spaces-and-dashes", "0812-3456-7890", "6281234567890"},
		{"unrecognized", "12345", ""},
		{"empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Normalize(c.in); got != c.want {
				t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/messaging/ -v`
Expected: FAIL to build — `package .../internal/messaging is not in std` / no Go files (package does not exist yet).
- [ ] **Step 3: Write minimal implementation**
Create `internal/messaging/whatsapp.go` (port ppgus's `Normalize` ONLY — drop `Sender`/`Noop`/`Fonnte`):
```go
// Package messaging holds phone-number helpers for the public /absen flow.
// gnrs does not push to a WhatsApp gateway server-side; the /absen handler
// builds a wa.me click-to-chat URL the SPA navigates to. Normalize canonicalises
// Indonesian phone input to the "62…" form wa.me expects.
package messaging

import "strings"

// Normalize coerces Indonesian phone input to the "62…" form wa.me expects.
// Accepts "+62…", "62…", and "0…". Strips spaces/dashes. Returns "" for input
// it can't recognise so callers can fall back instead of building a broken URL.
func Normalize(in string) string {
	s := strings.Map(func(r rune) rune {
		switch {
		case r >= '0' && r <= '9':
			return r
		case r == '+':
			return r
		}
		return -1
	}, in)
	s = strings.TrimSpace(s)
	switch {
	case strings.HasPrefix(s, "+62"):
		return s[1:]
	case strings.HasPrefix(s, "62"):
		return s
	case strings.HasPrefix(s, "0"):
		return "62" + s[1:]
	}
	return ""
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/messaging/ -v`
Expected: PASS (all six subtests).
- [ ] **Step 5: Commit**
```bash
git add internal/messaging/whatsapp.go internal/messaging/whatsapp_test.go
git commit -m "feat(messaging): add Indonesian phone Normalize helper"
```

---

### Task 4: `httpx.IPRateLimiter`
**Files:**
- Create: `internal/httpx/ratelimit.go`
- Test: `internal/httpx/ratelimit_test.go`

- [ ] **Step 1: Write the failing test**
Create `internal/httpx/ratelimit_test.go`:
```go
package httpx

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestIPRateLimiterMiddleware(t *testing.T) {
	rl := NewIPRateLimiter(2, time.Minute)
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	h := rl.Middleware(next)

	call := func() int {
		req := httptest.NewRequest(http.MethodPost, "/api/public/attendances", nil)
		req.RemoteAddr = "10.0.0.1:1234"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}

	if got := call(); got != http.StatusOK {
		t.Fatalf("call 1 = %d, want 200", got)
	}
	if got := call(); got != http.StatusOK {
		t.Fatalf("call 2 = %d, want 200", got)
	}
	if got := call(); got != http.StatusTooManyRequests {
		t.Fatalf("call 3 = %d, want 429", got)
	}
}

func TestIPRateLimiterPerIPIsolation(t *testing.T) {
	rl := NewIPRateLimiter(1, time.Minute)
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	h := rl.Middleware(next)

	do := func(ip string) int {
		req := httptest.NewRequest(http.MethodPost, "/x", nil)
		req.RemoteAddr = ip + ":5000"
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		return rec.Code
	}
	if do("10.0.0.1") != http.StatusOK {
		t.Fatal("ip1 first call should pass")
	}
	if do("10.0.0.2") != http.StatusOK {
		t.Fatal("ip2 first call should pass (separate bucket)")
	}
	if do("10.0.0.1") != http.StatusTooManyRequests {
		t.Fatal("ip1 second call should be limited")
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/httpx/ -run TestIPRateLimiter -v`
Expected: FAIL to build — `undefined: NewIPRateLimiter`.
- [ ] **Step 3: Write minimal implementation**
Create `internal/httpx/ratelimit.go` (port verbatim from ppgus; uses the existing `httpx.Error` in `internal/httpx/json.go`):
```go
package httpx

import (
	"net"
	"net/http"
	"sync"
	"time"
)

// IPRateLimiter is a tiny per-IP token bucket. Tokens regenerate at
// `burst` per `window` and are capped at `burst`. Suitable for guarding
// public unauthenticated POST endpoints; not a general-purpose limiter.
type IPRateLimiter struct {
	burst  int
	window time.Duration

	mu      sync.Mutex
	buckets map[string]*bucket
}

type bucket struct {
	tokens float64
	last   time.Time
}

// NewIPRateLimiter caps each IP at `burst` requests per `window` (e.g.
// burst=10, window=time.Minute → ~10/min, refilling continuously).
func NewIPRateLimiter(burst int, window time.Duration) *IPRateLimiter {
	return &IPRateLimiter{
		burst:   burst,
		window:  window,
		buckets: make(map[string]*bucket),
	}
}

func (l *IPRateLimiter) allow(key string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	b, ok := l.buckets[key]
	if !ok {
		b = &bucket{tokens: float64(l.burst), last: now}
		l.buckets[key] = b
	}
	elapsed := now.Sub(b.last).Seconds()
	refillPerSec := float64(l.burst) / l.window.Seconds()
	b.tokens += elapsed * refillPerSec
	if b.tokens > float64(l.burst) {
		b.tokens = float64(l.burst)
	}
	b.last = now
	if b.tokens >= 1 {
		b.tokens--
		return true
	}
	return false
}

// Middleware returns a chi-compatible middleware that 429s when the
// caller's IP exceeds the bucket. RealIP middleware should run first so
// r.RemoteAddr reflects the proxied client.
func (l *IPRateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {
			ip = r.RemoteAddr
		}
		if !l.allow(ip, time.Now()) {
			Error(w, http.StatusTooManyRequests, "rate_limited",
				"Terlalu banyak permintaan, coba lagi sebentar lagi.")
			return
		}
		next.ServeHTTP(w, r)
	})
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/httpx/ -run TestIPRateLimiter -v`
Expected: PASS
- [ ] **Step 5: Commit**
```bash
git add internal/httpx/ratelimit.go internal/httpx/ratelimit_test.go
git commit -m "feat(httpx): add per-IP token-bucket rate limiter"
```

---

### Task 5: `handler.PublicAttendance` (endpoints + wa.me report)
**Files:**
- Create: `internal/handler/public_attendance.go`
- Test: `internal/handler/public_attendance_test.go`

Note: `trimPtr` already exists in `internal/handler/teachers.go:77`; `httpx.JSON`/`httpx.Error` exist. Same `package handler` — do NOT redeclare `trimPtr`.

- [ ] **Step 1: Write the failing test**
Create `internal/handler/public_attendance_test.go` (adapted to gnrs's `StudentInput`/`TeacherInput`; the public form status set excludes `alfa`):
```go
package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func newPublicHandlerEnv(t *testing.T) (*PublicAttendance, *model.Teacher, *model.Student) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	teachers := store.NewTeachers(db)
	students := store.NewStudents(db)
	attendances := store.NewAttendances(db)

	teacherNick := "MDN"
	teacher, err := teachers.Create(context.Background(), store.TeacherInput{
		Name:     "Yasril",
		Nickname: &teacherNick,
		Kelompok: "TK",
		Desa:     "TD",
		Daerah:   "TDA",
		Status:   model.TeacherActive,
	})
	if err != nil {
		t.Fatalf("create teacher: %v", err)
	}
	studentNick := "BFL"
	level := model.LevelRemaja
	kelompok := "California"
	student, err := students.Create(context.Background(), store.StudentInput{
		Name:     "Abi",
		Nickname: &studentNick,
		Gender:   "male",
		Level:    &level,
		Kelompok: &kelompok,
		Status:   model.StudentActive,
	})
	if err != nil {
		t.Fatalf("create student: %v", err)
	}

	h := NewPublicAttendance(attendances, students, teachers)
	return h, teacher, student
}

func postJSON(t *testing.T, h http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/public/attendances", bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

type publicAttendanceResponseTest struct {
	ID             string  `json:"id"`
	SubmittedPhone *string `json:"submittedPhone"`
	WaMeURL        string  `json:"waMeUrl"`
}

func TestPublicAttendanceCreate_HappyPath(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)

	dur := 75
	body := map[string]any{
		"date":           "2026-04-30",
		"durationMin":    dur,
		"teacherId":      teacher.ID,
		"studentId":      student.ID,
		"status":         "hadir",
		"materi":         "1. brief explanations\n2. Quran makna",
		"submittedPhone": "081234567890",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}

	var got publicAttendanceResponseTest
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.SubmittedPhone == nil || *got.SubmittedPhone != "6281234567890" {
		t.Errorf("submittedPhone = %v, want 6281234567890", got.SubmittedPhone)
	}
	if !strings.HasPrefix(got.WaMeURL, "https://wa.me/6281234567890?") {
		t.Errorf("waMeUrl = %q, want https://wa.me/6281234567890?…", got.WaMeURL)
	}

	parsed, err := url.Parse(got.WaMeURL)
	if err != nil {
		t.Fatalf("parse waMeUrl: %v", err)
	}
	text := parsed.Query().Get("text")
	for _, want := range []string{
		"*LAPORAN PENGAJIAN PPG*",
		"● *Murid*      : Abi-BFL",
		"● *Tanggal*   : 2026-04-30",
		"● *Guru*        : Yasril-MDN",
		"● *Durasi*     : 01:15",
		"● *Kehadiran*     : HADIR",
		"● *Materi:*",
		"1. brief explanations",
		"الحمدلله جزاكم الله خيرا",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("waMeUrl text missing %q\nfull text:\n%s", want, text)
		}
	}
}

func TestPublicAttendanceCreate_InvalidPhone(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)
	body := map[string]any{
		"date":           "2025-05-01",
		"teacherId":      teacher.ID,
		"studentId":      student.ID,
		"status":         "hadir",
		"submittedPhone": "not-a-phone",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestPublicAttendanceCreate_MissingTeacher(t *testing.T) {
	h, _, student := newPublicHandlerEnv(t)
	body := map[string]any{
		"date":           "2025-05-01",
		"studentId":      student.ID,
		"status":         "hadir",
		"submittedPhone": "081234567890",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestPublicAttendanceCreate_AlfaRejected(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)
	body := map[string]any{
		"date":           "2025-05-01",
		"teacherId":      teacher.ID,
		"studentId":      student.ID,
		"status":         "alfa",
		"submittedPhone": "081234567890",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (public form excludes alfa)", rec.Code)
	}
}

func TestPublicAttendanceList_OnlyActive(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)

	// Seed a retired teacher + a left student that must NOT appear.
	dir := h // capture not needed; reuse handler's stores via new rows
	_ = dir
	if _, err := h.teachers.Create(context.Background(), store.TeacherInput{
		Name: "Retired", Kelompok: "K", Desa: "D", Daerah: "DA", Status: model.TeacherRetired,
	}); err != nil {
		t.Fatalf("seed retired teacher: %v", err)
	}
	if _, err := h.students.Create(context.Background(), store.StudentInput{
		Name: "Left", Gender: "female", Status: model.StudentLeft,
	}); err != nil {
		t.Fatalf("seed left student: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/public/teachers", nil)
	rec := httptest.NewRecorder()
	h.ListTeachers(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("teachers: status = %d", rec.Code)
	}
	var tres struct {
		Items []publicOption `json:"items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&tres); err != nil {
		t.Fatalf("decode teachers: %v", err)
	}
	if len(tres.Items) != 1 || tres.Items[0].ID != teacher.ID {
		t.Errorf("teachers items = %+v, want only active id=%s", tres.Items, teacher.ID)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/public/students", nil)
	rec = httptest.NewRecorder()
	h.ListStudents(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("students: status = %d", rec.Code)
	}
	var sres struct {
		Items []publicOption `json:"items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&sres); err != nil {
		t.Fatalf("decode students: %v", err)
	}
	if len(sres.Items) != 1 || sres.Items[0].ID != student.ID {
		t.Errorf("students items = %+v, want only active id=%s", sres.Items, student.ID)
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/handler/ -run TestPublicAttendance -v`
Expected: FAIL to build — `undefined: NewPublicAttendance`, `undefined: PublicAttendance`, `undefined: publicOption`.
- [ ] **Step 3: Write minimal implementation**
Create `internal/handler/public_attendance.go` (ported from ppgus; `buildWaMeURL`/`statusLabelsUpper`/`formatAttendanceMessage`/`joinNickname`/`formatDuration` live here; report body verbatim Indonesian, NOT i18n'd; status `oneof` excludes `alfa`; reuses existing `trimPtr`):
```go
package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/go-playground/validator/v10"

	"github.com/fadhilkurnia/ppg-dashboard/internal/httpx"
	"github.com/fadhilkurnia/ppg-dashboard/internal/messaging"
	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

// PublicAttendance owns the unauthenticated `/api/public/*` endpoints
// powering the `/absen` form. It exposes minimal teacher/student rosters
// for the dropdowns and accepts submissions that go straight into the
// shared attendances table.
//
// Submissions are not auto-pushed to a WhatsApp gateway. The Create response
// carries a pre-formatted wa.me click-to-chat URL targeted at the number the
// submitter entered; the SPA navigates to it so WhatsApp opens with the report
// pre-filled and the submitter taps Send. The chat target is the form's own
// submittedPhone — no server-side admin number is involved.
type PublicAttendance struct {
	attendances *store.Attendances
	students    *store.Students
	teachers    *store.Teachers
	validator   *validator.Validate
}

func NewPublicAttendance(
	a *store.Attendances,
	s *store.Students,
	t *store.Teachers,
) *PublicAttendance {
	return &PublicAttendance{
		attendances: a,
		students:    s,
		teachers:    t,
		validator:   validator.New(),
	}
}

type publicOption struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	Nickname *string `json:"nickname,omitempty"`
}

type publicOptionList struct {
	Items []publicOption `json:"items"`
}

// ListTeachers returns active teachers as minimal {id,name,nickname} records.
func (h *PublicAttendance) ListTeachers(w http.ResponseWriter, r *http.Request) {
	res, err := h.teachers.List(r.Context(), store.TeacherListParams{
		Status: "active",
		Limit:  200,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil daftar pengajar")
		return
	}
	out := make([]publicOption, 0, len(res.Items))
	for _, t := range res.Items {
		out = append(out, publicOption{ID: t.ID, Name: t.Name, Nickname: t.Nickname})
	}
	httpx.JSON(w, http.StatusOK, publicOptionList{Items: out})
}

// ListStudents returns active students for the public dropdown.
func (h *PublicAttendance) ListStudents(w http.ResponseWriter, r *http.Request) {
	res, err := h.students.List(r.Context(), store.ListParams{
		Status: "active",
		Limit:  200,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil daftar generus")
		return
	}
	out := make([]publicOption, 0, len(res.Items))
	for _, s := range res.Items {
		out = append(out, publicOption{ID: s.ID, Name: s.Name, Nickname: s.Nickname})
	}
	httpx.JSON(w, http.StatusOK, publicOptionList{Items: out})
}

// phoneRe accepts Indonesian inputs in "08…", "+62…", or "62…" form with at
// least 8 trailing digits — keeps obvious typos out without pretending to be a
// full E.164 validator (messaging.Normalize handles canonicalisation).
var phoneRe = regexp.MustCompile(`^(\+?62|0)\d{7,14}$`)

type publicAttendanceBody struct {
	Date           string  `json:"date"           validate:"required,datetime=2006-01-02"`
	DurationMin    *int    `json:"durationMin,omitempty"   validate:"omitempty,min=0,max=1440"`
	TeacherID      string  `json:"teacherId"      validate:"required,min=1"`
	StudentID      string  `json:"studentId"      validate:"required,min=1"`
	Status         string  `json:"status"         validate:"required,oneof=hadir izin_murid izin_guru by_vn"`
	Materi         *string `json:"materi,omitempty"        validate:"omitempty,max=20000"`
	SubmittedPhone string  `json:"submittedPhone" validate:"required"`
}

// publicAttendanceResponse is the 201 payload. The embedded *Attendance
// flattens its fields to the top level via JSON promotion; WaMeURL is the
// pre-built click-to-chat URL the form opens after a successful submit.
type publicAttendanceResponse struct {
	*model.Attendance
	WaMeURL string `json:"waMeUrl"`
}

// Create handles `POST /api/public/attendances`. It persists the row, formats
// the WhatsApp report body, and returns a wa.me URL pointing at the submitter's
// own number that the SPA navigates to so WhatsApp opens with the report
// pre-filled and ready to send.
func (h *PublicAttendance) Create(w http.ResponseWriter, r *http.Request) {
	var b publicAttendanceBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "Format permintaan tidak valid")
		return
	}
	b.SubmittedPhone = strings.TrimSpace(b.SubmittedPhone)
	if err := h.validator.Struct(b); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	if !phoneRe.MatchString(b.SubmittedPhone) {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "Nomor WhatsApp tidak valid")
		return
	}
	date, err := time.Parse("2006-01-02", b.Date)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "Tanggal tidak valid")
		return
	}

	normalizedPhone := messaging.Normalize(b.SubmittedPhone)
	phonePtr := &normalizedPhone

	att, err := h.attendances.Create(r.Context(), store.AttendanceInput{
		Date:           date,
		DurationMin:    b.DurationMin,
		TeacherID:      b.TeacherID,
		StudentID:      b.StudentID,
		Status:         model.AttendanceStatus(b.Status),
		Materi:         trimPtr(b.Materi),
		SubmittedPhone: phonePtr,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal menyimpan kehadiran")
		return
	}

	// Look up nicknames so the WA report can render "Name-Nickname".
	// Missing nicknames degrade to just the name — never block the response.
	var studentNick, teacherNick *string
	if s, err := h.students.Get(r.Context(), b.StudentID); err == nil {
		studentNick = s.Nickname
	}
	if t, err := h.teachers.Get(r.Context(), b.TeacherID); err == nil {
		teacherNick = t.Nickname
	}

	body := formatAttendanceMessage(att, studentNick, teacherNick)
	httpx.JSON(w, http.StatusCreated, publicAttendanceResponse{
		Attendance: att,
		WaMeURL:    buildWaMeURL(normalizedPhone, body),
	})
}

// buildWaMeURL returns a click-to-chat URL per the WhatsApp FAQ. Phone must be
// digits-only international form (no "+"); the message is percent-encoded by
// url.Values. Returns "" if no phone so the SPA can fall back to the
// "saved to DB" message instead of a broken redirect.
func buildWaMeURL(phone, body string) string {
	if phone == "" {
		return ""
	}
	q := url.Values{}
	q.Set("text", body)
	return "https://wa.me/" + phone + "?" + q.Encode()
}

var statusLabelsUpper = map[model.AttendanceStatus]string{
	model.AttendanceHadir:     "HADIR",
	model.AttendanceIzinMurid: "IZIN (MURID)",
	model.AttendanceIzinGuru:  "IZIN (GURU)",
	model.AttendanceByVN:      "BY VN",
}

// formatAttendanceMessage renders the per-session WhatsApp report. The shape
// (bullets, *bold* labels, "=" separators, Arabic closing, the verbatim title
// "LAPORAN PENGAJIAN PPG") is fixed by the admin team — keep it as-is and do
// NOT translate it.
func formatAttendanceMessage(a *model.Attendance, studentNick, teacherNick *string) string {
	const sep = "====================="
	murid := joinNickname(a.StudentName, studentNick)
	guru := joinNickname(a.TeacherName, teacherNick)
	status := statusLabelsUpper[a.Status]
	if status == "" {
		status = strings.ToUpper(string(a.Status))
	}

	var sb strings.Builder
	sb.WriteString(sep)
	sb.WriteString("\n*LAPORAN PENGAJIAN PPG*\n")
	sb.WriteString(sep)
	sb.WriteString("\n\n")

	sb.WriteString("● *Murid*      : ")
	sb.WriteString(murid)
	sb.WriteString("\n● *Tanggal*   : ")
	sb.WriteString(a.Date.Format("2006-01-02"))
	sb.WriteString("\n● *Guru*        : ")
	sb.WriteString(guru)
	sb.WriteString("\n● *Durasi*     : ")
	sb.WriteString(formatDuration(a.DurationMin))
	sb.WriteString("\n● *Kehadiran*     : ")
	sb.WriteString(status)
	sb.WriteString("\n")

	if a.Materi != nil && strings.TrimSpace(*a.Materi) != "" {
		sb.WriteString("\n● *Materi:*\n")
		sb.WriteString(strings.TrimRight(*a.Materi, "\n"))
		sb.WriteString("\n")
	}

	sb.WriteString("\n\nالحمدلله جزاكم الله خيرا")
	return sb.String()
}

func joinNickname(name string, nick *string) string {
	if nick != nil {
		n := strings.TrimSpace(*nick)
		if n != "" {
			return name + "-" + n
		}
	}
	return name
}

// formatDuration renders a minute count as HH:MM (e.g. 75 → "01:15"). Empty
// input renders as "-".
func formatDuration(min *int) string {
	if min == nil {
		return "-"
	}
	h := *min / 60
	m := *min % 60
	return fmt.Sprintf("%02d:%02d", h, m)
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/handler/ -run TestPublicAttendance -v`
Expected: PASS (HappyPath, InvalidPhone, MissingTeacher, AlfaRejected, List_OnlyActive).
- [ ] **Step 5: Commit**
```bash
git add internal/handler/public_attendance.go internal/handler/public_attendance_test.go
git commit -m "feat(handler): add public /absen attendance endpoints + wa.me report"
```

---

### Task 6: Register public routes in `cmd/server/main.go`
**Files:**
- Modify: `cmd/server/main.go:192-197` (inside `r.Route("/api", …)`, BEFORE the `authMw` group)

- [ ] **Step 1: Write the failing test (routing wired)**
Create `cmd/server/routes_test.go` to assert the public routes are mounted before auth (no JWT cookie, should NOT be 401). This requires a tiny exported helper or testing the assembled router; the simplest TDD-friendly check builds a router fragment matching main. Add this self-contained test that mounts the same handler the way main does and confirms unauthenticated access works:
```go
package main

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/fadhilkurnia/ppg-dashboard/internal/handler"
	"github.com/fadhilkurnia/ppg-dashboard/internal/httpx"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func TestPublicRoutesAreUnauthenticated(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	publicH := handler.NewPublicAttendance(
		store.NewAttendances(db), store.NewStudents(db), store.NewTeachers(db),
	)
	publicAttRL := httpx.NewIPRateLimiter(10, time.Minute)

	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		api.Get("/public/teachers", publicH.ListTeachers)
		api.Get("/public/students", publicH.ListStudents)
		api.With(publicAttRL.Middleware).Post("/public/attendances", publicH.Create)
	})

	req := httptest.NewRequest(http.MethodGet, "/api/public/teachers", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/public/teachers = %d, want 200 (no auth required)", rec.Code)
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./cmd/server/ -run TestPublicRoutesAreUnauthenticated -v`
Expected: This test will actually PASS at the handler level even before editing main (it builds its own router). To make it a genuine RED→GREEN for the main wiring, first confirm it compiles and passes (handler exists from Task 5). Treat this task's RED as: the wiring in `main.go` is missing. Verify by `grep -n "public" cmd/server/main.go` → no matches (RED for the integration).
- [ ] **Step 3: Write minimal implementation**
In `cmd/server/main.go`, add `"time"` is already imported. Inside `r.Route("/api", func(api chi.Router) {` block, register the public routes BEFORE `authMw := auth.Middleware(jwtSvc)` (i.e. right after the login/logout lines at :194-195). Replace:
```go
	r.Route("/api", func(api chi.Router) {
		authH := handler.NewAuth(users, jwtSvc, cfg.CookieSecure)
		api.Post("/auth/login", authH.Login)
		api.Post("/auth/logout", authH.Logout)

		authMw := auth.Middleware(jwtSvc)
```
with:
```go
	r.Route("/api", func(api chi.Router) {
		authH := handler.NewAuth(users, jwtSvc, cfg.CookieSecure)
		api.Post("/auth/login", authH.Login)
		api.Post("/auth/logout", authH.Logout)

		// Public, unauthenticated /absen endpoints — registered BEFORE the
		// authMw group so they need no JWT. The POST is IP-rate-limited
		// (10/min). NOTE: feature #3's dynamic-API gate must allowlist
		// /api/public/ (owned by that plan).
		publicAttH := handler.NewPublicAttendance(attendances, students, teachers)
		publicAttRL := httpx.NewIPRateLimiter(10, time.Minute)
		api.Get("/public/teachers", publicAttH.ListTeachers)
		api.Get("/public/students", publicAttH.ListStudents)
		api.With(publicAttRL.Middleware).Post("/public/attendances", publicAttH.Create)

		authMw := auth.Middleware(jwtSvc)
```
- [ ] **Step 4: Run test to verify it passes (and build is green)**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go build ./cmd/server && go test ./cmd/server/ -run TestPublicRoutesAreUnauthenticated -v`
Expected: build succeeds; PASS. Also confirm wiring present: `grep -n "public/teachers" cmd/server/main.go` → matches.
- [ ] **Step 5: Commit**
```bash
git add cmd/server/main.go cmd/server/routes_test.go
git commit -m "feat(server): register public /absen routes before auth group"
```

---

### Task 7: Frontend `api/public.ts`
**Files:**
- Create: `web/app/src/api/public.ts`

No frontend unit-test runner exists in `web/app/package.json` (only `typecheck`). Frontend verification for these tasks is `pnpm --dir web/app typecheck` plus the Chrome-DevTools flow per `TEST.md`. State this explicitly — there is no Vitest/Jest runner to invent.

- [ ] **Step 1: Write the type module (verified by typecheck, not a unit test)**
Create `web/app/src/api/public.ts` (adapt ppgus's to gnrs: `apiFetch` from `./client`, `Attendance`/`AttendanceStatus` from `./attendances` since gnrs's `api/types.ts` does not define `Attendance`). The public form excludes `alfa`, so a narrowed status union is used for input:
```ts
import { apiFetch } from './client'
import type { Attendance } from './attendances'

// Public form status set excludes 'alfa' (no-show is a staff judgment,
// not self-reported). Mirrors the server's oneof validation.
export type PublicAttendanceStatus = 'hadir' | 'izin_murid' | 'izin_guru' | 'by_vn'

export type PublicOption = {
  id: string
  name: string
  nickname?: string
}

export type PublicOptionList = {
  items: PublicOption[]
}

export type PublicAttendanceInput = {
  date: string
  durationMin?: number
  teacherId: string
  studentId: string
  status: PublicAttendanceStatus
  materi?: string
  submittedPhone: string
}

export function listPublicTeachers() {
  return apiFetch<PublicOptionList>('/api/public/teachers')
}

export function listPublicStudents() {
  return apiFetch<PublicOptionList>('/api/public/students')
}

// PublicAttendanceResponse flattens the created Attendance and adds the
// pre-built wa.me click-to-chat URL targeted at the submitted phone. The
// /absen page navigates to it after a successful POST so WhatsApp opens with
// the formatted report pre-filled. Empty only on the unreachable path where
// the server could not build a URL (submittedPhone is required + validated).
export type PublicAttendanceResponse = Attendance & {
  waMeUrl: string
}

export function submitPublicAttendance(input: PublicAttendanceInput) {
  return apiFetch<PublicAttendanceResponse>('/api/public/attendances', {
    method: 'POST',
    body: input,
  })
}
```
- [ ] **Step 2: Run typecheck to verify it fails**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck`
Expected: At this point the file is self-contained and imports resolve, so typecheck PASSES. There is no RED for a pure type module; the meaningful failure mode is a missing/typo'd import. If `pnpm` is unavailable use `npm --prefix web/app run typecheck` (matches the Makefile `typecheck` target).
- [ ] **Step 3: (No implementation beyond Step 1)**
This task is a single new file with no behavior to add minimally; the type module IS the implementation. Proceed to verify.
- [ ] **Step 4: Run typecheck to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck`
Expected: PASS (no type errors).
- [ ] **Step 5: Commit**
```bash
git add web/app/src/api/public.ts
git commit -m "feat(web): add public attendance API client"
```

---

### Task 8: i18n keys — `absen`, `absenStatus`, `validation`
**Files:**
- Modify: `web/app/src/locales/id.json` (add three top-level namespaces)
- Modify: `web/app/src/locales/en.json` (same keys, English)

- [ ] **Step 1: Define the keys (verified by typecheck + JSON validity)**
The `PublicAttendanceForm` (Task 9) references: `absen.fDate`, `absen.fDuration`, `absen.fDurationPh`, `absen.fTeacher`, `absen.pickTeacher`, `absen.fStudent`, `absen.pickStudent`, `absen.fAttendance`, `absen.fMateri`, `absen.fPhone`, `absen.phoneHint`, `absen.loadingLists`, `absen.sending`; `absenStatus.hadir|by_vn|izin_guru|izin_murid`; `validation.isoDate|requiredSelect|required|invalidPhone`. The `Absen` page (Task 10) references: `absen.heading`, `absen.note`, `absen.successHeading`, `absen.successWaHint`, `absen.sendWa`, `absen.savedToDb`, `absen.sendAnother`, `absen.submitBtn`, `absen.back`.

Add to `web/app/src/locales/id.json` (insert as new top-level keys — e.g. after the `"whatsapp"` block, before the closing brace; valid JSON, comma after the previous block):
```json
  "absen": {
    "heading": "Laporan Pengajian",
    "note": "Isi data pengajian, lalu kirim laporan via WhatsApp.",
    "fDate": "Tanggal",
    "fDuration": "Durasi (menit)",
    "fDurationPh": "mis. 75",
    "fTeacher": "Pengajar",
    "pickTeacher": "— pilih pengajar —",
    "fStudent": "Generus",
    "pickStudent": "— pilih generus —",
    "fAttendance": "Kehadiran",
    "fMateri": "Materi",
    "fPhone": "Nomor WhatsApp",
    "phoneHint": "Contoh: 081234567890. Laporan akan dibuka di WhatsApp Anda.",
    "loadingLists": "Memuat daftar…",
    "sending": "Mengirim…",
    "submitBtn": "Kirim Laporan",
    "successHeading": "Laporan tersimpan",
    "successWaHint": "WhatsApp akan terbuka dengan laporan yang sudah terisi. Tekan Kirim.",
    "sendWa": "Buka WhatsApp",
    "savedToDb": "Laporan tersimpan.",
    "sendAnother": "Kirim laporan lain",
    "back": "Kembali ke beranda"
  },
  "absenStatus": {
    "hadir": "Hadir",
    "by_vn": "Via Voice Note",
    "izin_guru": "Izin (Guru)",
    "izin_murid": "Izin (Murid)"
  },
  "validation": {
    "isoDate": "Format tanggal harus YYYY-MM-DD",
    "requiredSelect": "Wajib dipilih",
    "required": "Wajib diisi",
    "invalidPhone": "Nomor WhatsApp tidak valid"
  }
```
Add to `web/app/src/locales/en.json` (same keys, English):
```json
  "absen": {
    "heading": "Teaching Report",
    "note": "Fill in the session details, then send the report via WhatsApp.",
    "fDate": "Date",
    "fDuration": "Duration (minutes)",
    "fDurationPh": "e.g. 75",
    "fTeacher": "Teacher",
    "pickTeacher": "— select a teacher —",
    "fStudent": "Student",
    "pickStudent": "— select a student —",
    "fAttendance": "Attendance",
    "fMateri": "Material",
    "fPhone": "WhatsApp number",
    "phoneHint": "Example: 081234567890. The report will open in your WhatsApp.",
    "loadingLists": "Loading lists…",
    "sending": "Sending…",
    "submitBtn": "Send Report",
    "successHeading": "Report saved",
    "successWaHint": "WhatsApp will open with the report pre-filled. Tap Send.",
    "sendWa": "Open WhatsApp",
    "savedToDb": "Report saved.",
    "sendAnother": "Send another report",
    "back": "Back to home"
  },
  "absenStatus": {
    "hadir": "Present",
    "by_vn": "Via Voice Note",
    "izin_guru": "Excused (Teacher)",
    "izin_murid": "Excused (Student)"
  },
  "validation": {
    "isoDate": "Date must be YYYY-MM-DD",
    "requiredSelect": "Selection required",
    "required": "Required",
    "invalidPhone": "Invalid WhatsApp number"
  }
```
- [ ] **Step 2: Run to verify JSON validity (RED if malformed)**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && node -e "JSON.parse(require('fs').readFileSync('web/app/src/locales/id.json','utf8')); JSON.parse(require('fs').readFileSync('web/app/src/locales/en.json','utf8')); console.log('both valid JSON')"`
Expected before editing correctly: a `SyntaxError` if you forgot the comma after the previous block. After correct edit: prints `both valid JSON`.
- [ ] **Step 3: (Implementation is the JSON above)**
No further code; the keys ARE the implementation.
- [ ] **Step 4: Verify both locales parse and key parity**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && node -e "const id=require('./web/app/src/locales/id.json'),en=require('./web/app/src/locales/en.json');const k=o=>Object.keys(o).sort().join(',');for(const ns of ['absen','absenStatus','validation']){if(k(id[ns])!==k(en[ns])){console.error('KEY MISMATCH in',ns);process.exit(1)}}console.log('absen/absenStatus/validation keys match across id+en')"`
Expected: prints `absen/absenStatus/validation keys match across id+en`.
- [ ] **Step 5: Commit**
```bash
git add web/app/src/locales/id.json web/app/src/locales/en.json
git commit -m "feat(i18n): add absen, absenStatus, validation namespaces"
```

---

### Task 9: Frontend `PublicAttendanceForm.tsx`
**Files:**
- Create: `web/app/src/components/PublicAttendanceForm.tsx`

Adaptations from ppgus: import `useTranslation` from `react-i18next` (gnrs convention) not `@/i18n`; import `ApiError` from `@/lib/api` (gnrs's `api/client` re-exports it but importing from `@/lib/api` is unambiguous); status i18n keys are `absenStatus.*` (ppgus used `publicStatus.*`); `Field`/`Input`/`Button` already exist in gnrs with matching props (`Field` supports `label/htmlFor/error/hint`; `Input` forwards `className` + native props; `Button` accepts `className`).

- [ ] **Step 1: Write the component (verified by typecheck)**
Create `web/app/src/components/PublicAttendanceForm.tsx`:
```tsx
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { listPublicTeachers, listPublicStudents } from '@/api/public'
import type { PublicAttendanceInput } from '@/api/public'
import { ApiError } from '@/lib/api'
import { Button } from './Button'
import { Input } from './Input'
import { Field } from './Field'

// Mirrors the server's phoneRe (server is authoritative). Accepts "08…",
// "+62…", "62…" with 8–15 total trailing digits.
const phoneRe = /^(\+?62|0)\d{7,14}$/

type Props = {
  submitLabel: string
  pending?: boolean
  error?: unknown
  onSubmit: (input: PublicAttendanceInput) => void
}

export function PublicAttendanceForm({ submitLabel, pending, error, onSubmit }: Props) {
  const { t } = useTranslation()

  const statusOptions = [
    { value: 'hadir', label: t('absenStatus.hadir') },
    { value: 'by_vn', label: t('absenStatus.by_vn') },
    { value: 'izin_guru', label: t('absenStatus.izin_guru') },
    { value: 'izin_murid', label: t('absenStatus.izin_murid') },
  ] as const

  const schema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, t('validation.isoDate')),
    durationMin: z
      .union([z.string().length(0), z.coerce.number().int().min(0).max(1440)])
      .optional(),
    teacherId: z.string().min(1, t('validation.requiredSelect')),
    studentId: z.string().min(1, t('validation.requiredSelect')),
    status: z.enum(['hadir', 'by_vn', 'izin_guru', 'izin_murid']),
    materi: z.string().max(20000).optional().or(z.literal('')),
    submittedPhone: z
      .string()
      .min(1, t('validation.required'))
      .regex(phoneRe, t('validation.invalidPhone')),
  })

  type FormValues = z.infer<typeof schema>

  const teachersQ = useQuery({
    queryKey: ['public', 'teachers'],
    queryFn: listPublicTeachers,
    staleTime: 5 * 60_000,
  })
  const studentsQ = useQuery({
    queryKey: ['public', 'students'],
    queryFn: listPublicStudents,
    staleTime: 5 * 60_000,
  })

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      date: new Date().toISOString().slice(0, 10),
      durationMin: undefined,
      teacherId: '',
      studentId: '',
      status: 'hadir',
      materi: '',
      submittedPhone: '',
    },
  })

  const apiError = error instanceof ApiError ? error.message : null
  const loading = teachersQ.isPending || studentsQ.isPending

  return (
    <form
      onSubmit={handleSubmit((v) =>
        onSubmit({
          date: v.date,
          durationMin:
            typeof v.durationMin === 'number' && Number.isFinite(v.durationMin)
              ? v.durationMin
              : undefined,
          teacherId: v.teacherId,
          studentId: v.studentId,
          status: v.status,
          materi: v.materi || undefined,
          submittedPhone: v.submittedPhone,
        }),
      )}
      className="space-y-5 sm:space-y-4"
    >
      <div className="grid gap-5 sm:grid-cols-2 sm:gap-4">
        <Field label={t('absen.fDate')} htmlFor="date" error={errors.date?.message}>
          <Input id="date" type="date" className={inputMobile} {...register('date')} />
        </Field>
        <Field
          label={t('absen.fDuration')}
          htmlFor="durationMin"
          error={errors.durationMin?.message}
        >
          <Input
            id="durationMin"
            type="number"
            inputMode="numeric"
            min={0}
            max={1440}
            placeholder={t('absen.fDurationPh')}
            className={inputMobile}
            {...register('durationMin')}
          />
        </Field>
        <Field label={t('absen.fTeacher')} htmlFor="teacherId" error={errors.teacherId?.message}>
          <Controller
            control={control}
            name="teacherId"
            render={({ field }) => (
              <Select id="teacherId" {...field}>
                <option value="">{t('absen.pickTeacher')}</option>
                {teachersQ.data?.items.map((te) => (
                  <option key={te.id} value={te.id}>
                    {te.name}
                    {te.nickname ? ` (${te.nickname})` : ''}
                  </option>
                ))}
              </Select>
            )}
          />
        </Field>
        <Field label={t('absen.fStudent')} htmlFor="studentId" error={errors.studentId?.message}>
          <Controller
            control={control}
            name="studentId"
            render={({ field }) => (
              <Select id="studentId" {...field}>
                <option value="">{t('absen.pickStudent')}</option>
                {studentsQ.data?.items.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.nickname ? ` (${s.nickname})` : ''}
                  </option>
                ))}
              </Select>
            )}
          />
        </Field>
      </div>

      <Field label={t('absen.fAttendance')} htmlFor="status-group" error={errors.status?.message}>
        <Controller
          control={control}
          name="status"
          render={({ field }) => (
            <div id="status-group" role="radiogroup" className="grid gap-2 sm:grid-cols-2">
              {statusOptions.map((opt) => (
                <label
                  key={opt.value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-slate-300 bg-white px-3 py-3 text-base hover:bg-slate-50 has-[:checked]:border-slate-900 has-[:checked]:bg-slate-900 has-[:checked]:text-white sm:min-h-0 sm:py-2 sm:text-sm"
                >
                  <input
                    type="radio"
                    name={field.name}
                    value={opt.value}
                    checked={field.value === opt.value}
                    onChange={() => field.onChange(opt.value)}
                    className="h-4 w-4"
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
          )}
        />
      </Field>

      <Field label={t('absen.fMateri')} htmlFor="materi">
        <textarea
          id="materi"
          rows={6}
          className="block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:text-sm"
          {...register('materi')}
        />
      </Field>

      <Field
        label={t('absen.fPhone')}
        htmlFor="submittedPhone"
        error={errors.submittedPhone?.message}
        hint={t('absen.phoneHint')}
      >
        <Input
          id="submittedPhone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="081234567890"
          className={inputMobile}
          {...register('submittedPhone')}
        />
      </Field>

      {loading ? <p className="text-sm text-slate-500">{t('absen.loadingLists')}</p> : null}
      {apiError ? <p className="text-sm text-red-600">{apiError}</p> : null}

      <Button type="submit" className="h-12 w-full text-base sm:h-10 sm:text-sm" disabled={pending || loading}>
        {pending ? t('absen.sending') : submitLabel}
      </Button>
    </form>
  )
}

// 16px font on mobile prevents iOS Safari focus-zoom; 44px tap targets match
// WCAG/Apple touch guidance. The admin dashboard keeps its denser sm: defaults.
const inputMobile = 'h-11 text-base sm:h-10 sm:text-sm'

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 sm:h-10 sm:text-sm"
    />
  )
}
```
- [ ] **Step 2: Run typecheck to verify it fails if a key/import is wrong**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck`
Expected: PASS once `api/public.ts` (Task 7) and `Field/Input/Button` props line up. If `Field` is passed an unsupported prop or `ApiError` import path is wrong, this is the RED signal — fix and re-run. (No Vitest/Jest runner exists; typecheck + Chrome-DevTools is the verification per TEST.md.)
- [ ] **Step 3: (Implementation is the component above)**
- [ ] **Step 4: Run typecheck to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck`
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add web/app/src/components/PublicAttendanceForm.tsx
git commit -m "feat(web): add PublicAttendanceForm with zod + i18n"
```

---

### Task 10: Frontend `pages/Absen.tsx`
**Files:**
- Create: `web/app/src/pages/Absen.tsx`

Adaptations from ppgus's `routes/absen.tsx`: drop `createFileRoute` (gnrs uses react-router-dom — the route is declared in `App.tsx`, Task 11); export a named `AbsenPage` component; `useTranslation` from `react-i18next`; DROP the `LanguageSwitcher` (no such component in gnrs); DROP the "Ada pertanyaan?" footer link (locked decision — do not ship a personal number); keep the SAME-TAB `window.location.href = waMeUrl` handoff.

- [ ] **Step 1: Write the page (verified by typecheck)**
Create `web/app/src/pages/Absen.tsx`:
```tsx
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'

import { submitPublicAttendance } from '@/api/public'
import type { PublicAttendanceInput } from '@/api/public'
import { Button } from '@/components/Button'
import { PublicAttendanceForm } from '@/components/PublicAttendanceForm'

export function AbsenPage() {
  const [submitted, setSubmitted] = useState(false)
  const { t } = useTranslation()

  const mutation = useMutation({
    mutationFn: (input: PublicAttendanceInput) => submitPublicAttendance(input),
    onSuccess: (data) => {
      setSubmitted(true)
      // Same-tab navigation to wa.me hands off to WhatsApp (OS intent on
      // mobile, WhatsApp Web on desktop) with the report pre-filled.
      // window.open from an async onSuccess gets swallowed by popup blockers
      // — a same-tab navigation does not.
      if (data.waMeUrl) {
        window.location.href = data.waMeUrl
      }
    },
  })

  const waMeUrl = mutation.data?.waMeUrl ?? ''

  return (
    <div className="min-h-screen bg-slate-50 px-3 py-6 sm:px-4 sm:py-12">
      <div className="mx-auto w-full max-w-xl rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold leading-tight text-slate-900 sm:text-2xl">
            {t('absen.heading')}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{t('absen.note')}</p>
        </header>

        {submitted ? (
          <div className="space-y-5 text-center">
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-500" aria-hidden />
            <h2 className="text-lg font-semibold text-slate-900">{t('absen.successHeading')}</h2>
            {waMeUrl ? (
              <>
                <p className="text-base text-slate-600 sm:text-sm">{t('absen.successWaHint')}</p>
                <a
                  href={waMeUrl}
                  className="inline-flex h-12 w-full items-center justify-center rounded-md bg-emerald-600 px-4 text-base font-medium text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 sm:h-11 sm:text-sm"
                >
                  {t('absen.sendWa')}
                </a>
              </>
            ) : (
              <p className="text-base text-slate-600 sm:text-sm">{t('absen.savedToDb')}</p>
            )}
            <Button
              type="button"
              variant="secondary"
              className="h-12 w-full text-base sm:h-10 sm:w-auto sm:text-sm"
              onClick={() => {
                mutation.reset()
                setSubmitted(false)
              }}
            >
              {t('absen.sendAnother')}
            </Button>
          </div>
        ) : (
          <PublicAttendanceForm
            submitLabel={t('absen.submitBtn')}
            pending={mutation.isPending}
            error={mutation.error}
            onSubmit={(input) => mutation.mutate(input)}
          />
        )}

        <footer className="mt-8 flex items-center justify-start border-t border-slate-200 pt-5 text-sm text-slate-500 sm:pt-4">
          <a href="/" className="hover:underline">
            {t('absen.back')}
          </a>
        </footer>
      </div>
    </div>
  )
}
```
- [ ] **Step 2: Run typecheck to verify it fails if wiring is off**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck`
Expected: PASS once Tasks 7 & 9 are in. A wrong import (e.g. `LanguageSwitcher`) would be the RED signal. No JS unit runner — verification is typecheck + Chrome-DevTools.
- [ ] **Step 3: (Implementation is the page above)**
- [ ] **Step 4: Run typecheck to verify it passes**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck`
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add web/app/src/pages/Absen.tsx
git commit -m "feat(web): add public /absen page with wa.me handoff"
```

---

### Task 11: Wire `/absen` route in `App.tsx` (outside the auth gate)
**Files:**
- Modify: `web/app/src/App.tsx:1-46` (add import; add `<Route path="/absen">` as a sibling of `/login`, OUTSIDE the `<Layout>` wrapper)

- [ ] **Step 1: Add the import + route (verified by typecheck + Chrome-DevTools)**
In `web/app/src/App.tsx`, add the import alongside the other page imports (e.g. after the `LoginPage` import on line 5):
```tsx
import { LoginPage } from '@/pages/Login'
import { AbsenPage } from '@/pages/Absen'
```
Then add the public route as a sibling of `/login` — INSIDE `<Routes>` but OUTSIDE the auth-gated `<Route element={user ? <Layout/> : …}>`. Place it right after the `/login` route block (after line 47):
```tsx
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route path="/absen" element={<AbsenPage />} />
```
- [ ] **Step 2: Run typecheck to verify it fails if the import is wrong**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck`
Expected: PASS (AbsenPage exists from Task 10). A typo in the path/import is the RED signal.
- [ ] **Step 3: (Implementation is the route above)**
- [ ] **Step 4: Verify typecheck + full build green**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && pnpm --dir web/app typecheck && go build ./...`
Expected: both succeed. (Confirm `/absen` is NOT inside the `<Layout>` group: `grep -n "/absen" web/app/src/App.tsx` should show it above the `<Route element={user ? <Layout` line.)
- [ ] **Step 5: Commit**
```bash
git add web/app/src/App.tsx
git commit -m "feat(web): mount /absen public route outside auth gate"
```

---

### Task 12: Full suite verification + Chrome-DevTools UI pass
**Files:** none (verification only)

- [ ] **Step 1: Run the full Go suite with race + coverage on touched packages**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && make test`
Expected: PASS (all packages; `go test ./... -count=1`). Then targeted coverage:
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test ./internal/handler/ ./internal/store/ ./internal/messaging/ ./internal/httpx/ -cover`
Expected: PASS; coverage reported (touched code ≥ 80%).
- [ ] **Step 2: Run race detector on the new concurrency-bearing package**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && go test -race ./internal/httpx/ -run TestIPRateLimiter`
Expected: PASS, no data races (the limiter uses a mutex).
- [ ] **Step 3: Frontend typecheck**
Run: `cd /workspace/gnrs/.worktrees/feat/ppgus-port-claude && make typecheck`
Expected: PASS (`npm --prefix web/app run typecheck` → `tsc -b --noEmit` clean).
- [ ] **Step 4: Chrome-DevTools UI verification (no JS unit runner exists)**
Per `TEST.md` + `CHROME_DEVTOOLS.md`: build/run the per-agent dev container, then drive `http://localhost:<port>/absen` in the shared headless Chrome. Verify: (a) the page loads WITHOUT logging in (it is outside the auth gate); (b) teacher + student dropdowns populate from `GET /api/public/teachers` / `/api/public/students`; (c) submitting a valid form returns 201 and same-tab navigates to a `https://wa.me/62…?text=…` URL whose decoded text contains `*LAPORAN PENGAJIAN PPG*`; (d) an invalid phone shows the client-side `validation.invalidPhone` error; (e) the language switch (existing app-level i18n) flips `absen.*` strings between id/en while the wa.me report body stays Indonesian. Capture this in the PR's "Tested via Chrome DevTools" section.
- [ ] **Step 5: (No commit — verification gate.)**
If anything fails, fix in the owning task's files and re-run from Step 1. Do NOT open the PR until `make test`, `make typecheck`, and the Chrome-DevTools flow are all green.

---

## Cross-feature note for the PR body
This feature adds `GET /api/public/teachers`, `GET /api/public/students`, and `POST /api/public/attendances` registered BEFORE the auth group. Feature #3 (dynamic API gate, default ON) MUST include `/api/public/` in its `directAPIAllowlist`, otherwise these endpoints break once the gate lands. Land #2 before #3 (per spec §4 build order #4 → #2 → #3 → #6) and cross-link the sibling PRs.
