# Gender Filter + Sortable Headers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an allowlisted gender filter plus sortable `name`/`created_at` column headers to the Generus (murid) and Pengajar (guru) lists, end-to-end (store → handler → frontend → i18n).

**Architecture:** Backend extends `store.ListParams`/`store.TeacherListParams` with `Gender, Sort, Dir` and routes ordering through one shared `orderClause(sort, dir)` helper (allowlist `{name, created_at}`, `id ASC` tiebreaker, default `name ASC`); handlers validate `gender ∈ {male,female,""}` and `sort/dir`, returning 400 with an Indonesian message on invalid input (parity with existing handler style). Frontend adds a gender `<select>` to each list's filter form and a reusable `SortableTh` component that writes `sort/dir/gender` into `useSearchParams` (reset page to 1; only write non-default values). New UI strings localized via the existing `id`/`en` JSON.

**Tech Stack:** Go 1.25 + chi + SQLite (`internal/store`, `internal/handler`); React 18 + react-router-dom + @tanstack/react-query + react-i18next + lucide-react (`web/app`). No migration (`users.gender` already exists). Test/build via `make test` (`go test ./...`) and `make typecheck` (`npm --prefix web/app run typecheck`); frontend behavior verified through the Chrome DevTools flow in `TEST.md` (gnrs has **no** JS test runner).

---

### Task 1: Shared `orderClause` store helper

**Files:**
- Modify: `internal/store/store.go` (append helper near the `scanner` type, ~L42)
- Test: `internal/store/order_test.go` (new)

- [ ] **Step 1: Write the failing test**
```go
// internal/store/order_test.go
package store

import "testing"

func TestOrderClause(t *testing.T) {
	cases := []struct {
		name, sort, dir, want string
	}{
		{"default empty", "", "", "ORDER BY name ASC, id ASC"},
		{"name asc", "name", "asc", "ORDER BY name ASC, id ASC"},
		{"name desc", "name", "desc", "ORDER BY name DESC, id ASC"},
		{"created asc", "created_at", "asc", "ORDER BY created_at ASC, id ASC"},
		{"created desc", "created_at", "desc", "ORDER BY created_at DESC, id ASC"},
		{"unknown sort falls back to name", "bogus", "desc", "ORDER BY name DESC, id ASC"},
		{"unknown dir falls back to asc", "created_at", "sideways", "ORDER BY created_at ASC, id ASC"},
		{"uppercase normalized", "NAME", "DESC", "ORDER BY name DESC, id ASC"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := orderClause(c.sort, c.dir); got != c.want {
				t.Errorf("orderClause(%q,%q) = %q, want %q", c.sort, c.dir, got, c.want)
			}
		})
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `go test ./internal/store/ -run TestOrderClause -v`
Expected: FAIL — compile error `undefined: orderClause`.
- [ ] **Step 3: Write minimal implementation**
Add to `internal/store/store.go`, immediately after the `scanner` interface block (after line 42):
```go
// orderClause builds a safe ORDER BY for list endpoints. Only the columns in
// the allowlist may be sorted on; anything else falls back to name. The
// direction is ASC unless an explicit "desc" is given. A trailing "id ASC"
// makes the order deterministic for equal keys / pagination.
func orderClause(sort, dir string) string {
	col := "name"
	switch strings.ToLower(strings.TrimSpace(sort)) {
	case "name":
		col = "name"
	case "created_at":
		col = "created_at"
	}
	direction := "ASC"
	if strings.ToLower(strings.TrimSpace(dir)) == "desc" {
		direction = "DESC"
	}
	return "ORDER BY " + col + " " + direction + ", id ASC"
}
```
If `strings` is not already imported in `internal/store/store.go`, add it to the import block.
- [ ] **Step 4: Run test to verify it passes**
Run: `go test ./internal/store/ -run TestOrderClause -v`
Expected: PASS (all subtests).
- [ ] **Step 5: Commit**
```bash
git add internal/store/store.go internal/store/order_test.go
git commit -m "feat(store): add shared allowlisted orderClause helper"
```

---

### Task 2: Students store — Gender filter + sortable order

**Files:**
- Modify: `internal/store/students.go` (`ListParams` ~L47-53; `List` ORDER BY ~L160-185)
- Test: `internal/store/students_test.go` (append)

- [ ] **Step 1: Write the failing test**
Append to `internal/store/students_test.go`:
```go
func TestStudentsListGenderAndSort(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	// Two females (Alice, Bob) and two males (Carol, Dave).
	for _, name := range []string{"Bob", "Alice"} {
		in := sampleInput(name) // sampleInput uses gender "female"
		if _, err := s.Create(ctx, in); err != nil {
			t.Fatalf("seed female: %v", err)
		}
	}
	for _, name := range []string{"Dave", "Carol"} {
		in := sampleInput(name)
		in.Gender = "male"
		if _, err := s.Create(ctx, in); err != nil {
			t.Fatalf("seed male: %v", err)
		}
	}

	res, err := s.List(ctx, ListParams{Gender: "female"})
	if err != nil {
		t.Fatalf("list female: %v", err)
	}
	if res.Total != 2 {
		t.Errorf("female total = %d, want 2", res.Total)
	}
	for _, it := range res.Items {
		if it.Gender != "female" {
			t.Errorf("got gender %q in female filter", it.Gender)
		}
	}

	res, _ = s.List(ctx, ListParams{Gender: "male"})
	if res.Total != 2 {
		t.Errorf("male total = %d, want 2", res.Total)
	}

	// Sort by name DESC -> Dave, Carol, Bob, Alice.
	res, _ = s.List(ctx, ListParams{Sort: "name", Dir: "desc"})
	if got := []string{res.Items[0].Name, res.Items[3].Name}; got[0] != "Dave" || got[1] != "Alice" {
		t.Errorf("name desc order = %v, want first Dave last Alice", got)
	}

	// Bad sort falls back to name ASC -> Alice first.
	res, _ = s.List(ctx, ListParams{Sort: "bogus", Dir: ""})
	if res.Items[0].Name != "Alice" {
		t.Errorf("fallback first = %q, want Alice", res.Items[0].Name)
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `go test ./internal/store/ -run TestStudentsListGenderAndSort -v`
Expected: FAIL — compile error: unknown fields `Gender`, `Sort`, `Dir` in `ListParams`.
- [ ] **Step 3: Write minimal implementation**
In `internal/store/students.go`, extend `ListParams` (currently L47-53):
```go
type ListParams struct {
	Query    string
	Status   string
	Kelompok string
	Gender   string // "", "male", or "female"
	Sort     string // "", "name", or "created_at"
	Dir      string // "", "asc", or "desc"
	Limit    int
	Offset   int
}
```
In `List`, after the `Kelompok` clause block (currently L171-174) add a gender clause:
```go
	if p.Kelompok != "" {
		clauses = append(clauses, "kelompok = ?")
		args = append(args, p.Kelompok)
	}
	if p.Gender != "" {
		clauses = append(clauses, "gender = ?")
		args = append(args, p.Gender)
	}
```
Then replace the fixed ORDER BY in the list query (currently L183-185):
```go
	listArgs := append(append([]any{}, args...), p.Limit, p.Offset)
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+selectStudentCols+` FROM users`+where+` `+orderClause(p.Sort, p.Dir)+` LIMIT ? OFFSET ?`,
		listArgs...)
```
- [ ] **Step 4: Run test to verify it passes**
Run: `go test ./internal/store/ -run 'TestStudentsList' -v`
Expected: PASS (both `TestStudentsListSearchAndStatus` and `TestStudentsListGenderAndSort`).
- [ ] **Step 5: Commit**
```bash
git add internal/store/students.go internal/store/students_test.go
git commit -m "feat(store): gender filter and sort for students list"
```

---

### Task 3: Teachers store — Gender filter (NULL-excluded) + sortable order

**Files:**
- Modify: `internal/store/teachers.go` (`TeacherListParams` ~L44-50; `List` ORDER BY ~L162-176)
- Test: `internal/store/teachers_test.go` (append)

- [ ] **Step 1: Write the failing test**
Append to `internal/store/teachers_test.go`:
```go
func TestTeachersListGenderAndSort(t *testing.T) {
	s := newTeachersDB(t)
	ctx := context.Background()

	male := "male"
	female := "female"

	// One male (Bob), one female (Alice), one with NULL gender (Zed).
	bob := teacherInput("Bob", "Luwu Timur", model.TeacherActive)
	bob.Gender = &male
	alice := teacherInput("Alice", "Luwu Timur", model.TeacherActive)
	alice.Gender = &female
	zed := teacherInput("Zed", "Luwu Timur", model.TeacherActive)
	zed.Gender = nil // NULL gender
	for _, in := range []TeacherInput{bob, alice, zed} {
		if _, err := s.Create(ctx, in); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// Gender filter excludes the NULL-gender row.
	res, err := s.List(ctx, TeacherListParams{Gender: "male"})
	if err != nil {
		t.Fatalf("list male: %v", err)
	}
	if res.Total != 1 || res.Items[0].Name != "Bob" {
		t.Errorf("male filter = %+v, want only Bob", res)
	}

	res, _ = s.List(ctx, TeacherListParams{Gender: "female"})
	if res.Total != 1 || res.Items[0].Name != "Alice" {
		t.Errorf("female filter = %+v, want only Alice", res)
	}

	// No gender filter: all three (incl. NULL) returned.
	res, _ = s.List(ctx, TeacherListParams{})
	if res.Total != 3 {
		t.Errorf("unfiltered total = %d, want 3 (incl NULL gender)", res.Total)
	}

	// Sort name DESC -> Zed first, Alice last.
	res, _ = s.List(ctx, TeacherListParams{Sort: "name", Dir: "desc"})
	if res.Items[0].Name != "Zed" || res.Items[2].Name != "Alice" {
		t.Errorf("name desc = [%s ... %s], want [Zed ... Alice]", res.Items[0].Name, res.Items[2].Name)
	}

	// Bad sort falls back to name ASC -> Alice first.
	res, _ = s.List(ctx, TeacherListParams{Sort: "nope"})
	if res.Items[0].Name != "Alice" {
		t.Errorf("fallback first = %q, want Alice", res.Items[0].Name)
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `go test ./internal/store/ -run TestTeachersListGenderAndSort -v`
Expected: FAIL — compile error: unknown fields `Gender`, `Sort`, `Dir` in `TeacherListParams`.
- [ ] **Step 3: Write minimal implementation**
In `internal/store/teachers.go`, extend `TeacherListParams` (currently L44-50):
```go
type TeacherListParams struct {
	Query  string
	Status string
	Daerah string
	Gender string // "", "male", or "female"
	Sort   string // "", "name", or "created_at"
	Dir    string // "", "asc", or "desc"
	Limit  int
	Offset int
}
```
In `List`, after the `Daerah` clause block (currently L162-165) add a gender clause. Because `gender` is nullable, an `= ?` comparison naturally excludes NULL rows (SQLite `NULL = 'male'` is never true), which is the desired behavior:
```go
	if d := strings.TrimSpace(p.Daerah); d != "" {
		clauses = append(clauses, "daerah = ?")
		args = append(args, d)
	}
	if p.Gender != "" {
		clauses = append(clauses, "gender = ?")
		args = append(args, p.Gender)
	}
```
Then replace the fixed ORDER BY in the list query (currently L174-176):
```go
	listArgs := append(append([]any{}, args...), p.Limit, p.Offset)
	rows, err := t.db.QueryContext(ctx,
		`SELECT `+selectTeacherCols+` FROM users`+where+` `+orderClause(p.Sort, p.Dir)+` LIMIT ? OFFSET ?`,
		listArgs...)
```
- [ ] **Step 4: Run test to verify it passes**
Run: `go test ./internal/store/ -run 'TestTeachersList' -v`
Expected: PASS (both `TestTeachersListFilters` and `TestTeachersListGenderAndSort`).
- [ ] **Step 5: Commit**
```bash
git add internal/store/teachers.go internal/store/teachers_test.go
git commit -m "feat(store): gender filter and sort for teachers list"
```

---

### Task 4: Students handler — validate + pass through gender/sort/dir

**Files:**
- Modify: `internal/handler/students.go` (`List` ~L103-120)
- Test: `internal/handler/students_test.go` (new — first handler test in the repo)

- [ ] **Step 1: Write the failing test**
Create `internal/handler/students_test.go`. This builds its own DB via the store package's `Open`+`Migrate` (same convention as the store tests), constructs the handler with `NewStudents`, and drives `List` with `httptest`:
```go
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func newStudentsHandler(t *testing.T) (*Students, *store.Students) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	st := store.NewStudents(db)
	return NewStudents(st), st
}

func seedStudent(t *testing.T, st *store.Students, name, gender string) {
	t.Helper()
	if _, err := st.Create(context.Background(), store.StudentInput{
		Name:   name,
		Gender: gender,
		Status: "active",
	}); err != nil {
		t.Fatalf("seed %s: %v", name, err)
	}
}

func TestStudentsListGenderPassThrough(t *testing.T) {
	h, st := newStudentsHandler(t)
	seedStudent(t, st, "Alice", "female")
	seedStudent(t, st, "Bob", "male")

	req := httptest.NewRequest(http.MethodGet, "/api/students?gender=female", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out store.ListResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Total != 1 || out.Items[0].Name != "Alice" {
		t.Errorf("gender=female result = %+v, want only Alice", out)
	}
}

func TestStudentsListBogusGender400(t *testing.T) {
	h, _ := newStudentsHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/students?gender=bogus", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestStudentsListBadSort400(t *testing.T) {
	h, _ := newStudentsHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/students?sort=age", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestStudentsListSortDirOrdering(t *testing.T) {
	h, st := newStudentsHandler(t)
	seedStudent(t, st, "Alice", "female")
	seedStudent(t, st, "Zed", "male")

	req := httptest.NewRequest(http.MethodGet, "/api/students?sort=name&dir=desc", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out store.ListResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Items[0].Name != "Zed" {
		t.Errorf("first item = %q, want Zed (name desc)", out.Items[0].Name)
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `go test ./internal/handler/ -run TestStudentsList -v`
Expected: FAIL — `TestStudentsListBogusGender400` and `TestStudentsListBadSort400` get 200 (no validation yet); the others may pass.
- [ ] **Step 3: Write minimal implementation**
Replace the body of `List` in `internal/handler/students.go` (currently L103-120) with validation + pass-through:
```go
func (h *Students) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	gender := q.Get("gender")
	if gender != "" && gender != "male" && gender != "female" {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "gender harus 'male' atau 'female'")
		return
	}
	sort := q.Get("sort")
	if sort != "" && sort != "name" && sort != "created_at" {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "sort harus 'name' atau 'created_at'")
		return
	}
	dir := q.Get("dir")
	if dir != "" && dir != "asc" && dir != "desc" {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "dir harus 'asc' atau 'desc'")
		return
	}

	res, err := h.students.List(r.Context(), store.ListParams{
		Query:    q.Get("q"),
		Status:   q.Get("status"),
		Kelompok: q.Get("kelompok"),
		Gender:   gender,
		Sort:     sort,
		Dir:      dir,
		Limit:    limit,
		Offset:   offset,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil daftar Generus")
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `go test ./internal/handler/ -run TestStudentsList -v`
Expected: PASS (all four).
- [ ] **Step 5: Commit**
```bash
git add internal/handler/students.go internal/handler/students_test.go
git commit -m "feat(handler): validate gender/sort/dir on students list"
```

---

### Task 5: Teachers handler — validate + pass through gender/sort/dir

**Files:**
- Modify: `internal/handler/teachers.go` (`List` ~L88-105)
- Test: `internal/handler/teachers_test.go` (new)

- [ ] **Step 1: Write the failing test**
Create `internal/handler/teachers_test.go`:
```go
package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func newTeachersHandler(t *testing.T) (*Teachers, *store.Teachers) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	tc := store.NewTeachers(db)
	return NewTeachers(tc), tc
}

func seedTeacher(t *testing.T, tc *store.Teachers, name, gender string) {
	t.Helper()
	in := store.TeacherInput{
		Name:     name,
		Kelompok: "Pabeta",
		Desa:     "Malili",
		Daerah:   "Luwu Timur",
		Status:   "active",
	}
	if gender != "" {
		g := gender
		in.Gender = &g
	}
	if _, err := tc.Create(context.Background(), in); err != nil {
		t.Fatalf("seed %s: %v", name, err)
	}
}

func TestTeachersListGenderPassThrough(t *testing.T) {
	h, tc := newTeachersHandler(t)
	seedTeacher(t, tc, "Alice", "female")
	seedTeacher(t, tc, "Bob", "male")
	seedTeacher(t, tc, "Zed", "") // NULL gender

	req := httptest.NewRequest(http.MethodGet, "/api/teachers?gender=female", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var out store.TeacherListResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Total != 1 || out.Items[0].Name != "Alice" {
		t.Errorf("gender=female result = %+v, want only Alice", out)
	}
}

func TestTeachersListBogusGender400(t *testing.T) {
	h, _ := newTeachersHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/teachers?gender=bogus", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestTeachersListBadSort400(t *testing.T) {
	h, _ := newTeachersHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/teachers?sort=daerah", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestTeachersListSortDirOrdering(t *testing.T) {
	h, tc := newTeachersHandler(t)
	seedTeacher(t, tc, "Alice", "female")
	seedTeacher(t, tc, "Zed", "male")

	req := httptest.NewRequest(http.MethodGet, "/api/teachers?sort=name&dir=desc", nil)
	rec := httptest.NewRecorder()
	h.List(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var out store.TeacherListResult
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Items[0].Name != "Zed" {
		t.Errorf("first item = %q, want Zed (name desc)", out.Items[0].Name)
	}
}
```
- [ ] **Step 2: Run test to verify it fails**
Run: `go test ./internal/handler/ -run TestTeachersList -v`
Expected: FAIL — `TestTeachersListBogusGender400` and `TestTeachersListBadSort400` get 200 (no validation yet).
- [ ] **Step 3: Write minimal implementation**
Replace the body of `List` in `internal/handler/teachers.go` (currently L88-105) with validation + pass-through:
```go
func (h *Teachers) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))

	gender := q.Get("gender")
	if gender != "" && gender != "male" && gender != "female" {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "gender harus 'male' atau 'female'")
		return
	}
	sort := q.Get("sort")
	if sort != "" && sort != "name" && sort != "created_at" {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "sort harus 'name' atau 'created_at'")
		return
	}
	dir := q.Get("dir")
	if dir != "" && dir != "asc" && dir != "desc" {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "dir harus 'asc' atau 'desc'")
		return
	}

	res, err := h.teachers.List(r.Context(), store.TeacherListParams{
		Query:  q.Get("q"),
		Status: q.Get("status"),
		Daerah: q.Get("daerah"),
		Gender: gender,
		Sort:   sort,
		Dir:    dir,
		Limit:  limit,
		Offset: offset,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil daftar Pengajar")
		return
	}
	httpx.JSON(w, http.StatusOK, res)
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `go test ./internal/handler/ -run TestTeachersList -v`
Expected: PASS (all four).
- [ ] **Step 5: Commit**
```bash
git add internal/handler/teachers.go internal/handler/teachers_test.go
git commit -m "feat(handler): validate gender/sort/dir on teachers list"
```

---

### Task 6: Full backend gate (race) before moving to frontend

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite with race detection**
Run: `make test`
Expected: PASS — `ok github.com/fadhilkurnia/ppg-dashboard/internal/store`, `ok .../internal/handler`, and all other packages green; no failures or data races. (`make test` runs `go test ./... -count=1`; for race coverage also run `go test -race ./internal/store/ ./internal/handler/`.)
- [ ] **Step 2: (no code; do not commit — this is a gate)**
If anything fails, fix it in the owning task's files and re-run before continuing.

---

### Task 7: Frontend API clients — serialize gender/sort/dir

**Files:**
- Modify: `web/app/src/api/students.ts` (`ListQuery` L10-16, `listStudents` L18-27)
- Modify: `web/app/src/api/teachers.ts` (`TeacherListQuery` L4-10, `listTeachers` L12-21)
- Modify: `web/app/src/api/types.ts` (add shared sort types after L17)
- Test: Chrome DevTools per `TEST.md` (no JS test runner in gnrs); type safety enforced by `make typecheck`.

- [ ] **Step 1: Add shared sort types (write first so the clients compile against them)**
In `web/app/src/api/types.ts`, after the `User` type (after L17), add:
```ts
export const SORT_COLUMNS = ['name', 'created_at'] as const
export type SortColumn = (typeof SORT_COLUMNS)[number]
export type SortDir = 'asc' | 'desc'
export type Gender = 'male' | 'female'
```
- [ ] **Step 2: Verify it does not yet compile end-to-end (clients still lack the params)**
Run: `npm --prefix web/app run typecheck`
Expected: PASS at this point (types added are unused yet); this step just confirms the new types are valid TS before wiring them in. If it errors, the type block is malformed — fix before continuing.
- [ ] **Step 3: Extend the students client**
In `web/app/src/api/students.ts`, update the imports and `ListQuery`/`listStudents`:
```ts
import { apiFetch } from './client'
import type {
  Gender,
  SortColumn,
  SortDir,
  Student,
  StudentInput,
  StudentKelompok,
  StudentList,
  StudentStatus,
} from './types'

export type ListQuery = {
  q?: string
  status?: StudentStatus
  kelompok?: StudentKelompok
  gender?: Gender
  sort?: SortColumn
  dir?: SortDir
  limit?: number
  offset?: number
}

export function listStudents(params: ListQuery = {}) {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.status) q.set('status', params.status)
  if (params.kelompok) q.set('kelompok', params.kelompok)
  if (params.gender) q.set('gender', params.gender)
  if (params.sort) q.set('sort', params.sort)
  if (params.dir) q.set('dir', params.dir)
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  if (params.offset !== undefined) q.set('offset', String(params.offset))
  const qs = q.toString()
  return apiFetch<StudentList>(`/api/students${qs ? `?${qs}` : ''}`)
}
```
(Leave `getStudent`/`createStudent`/`updateStudent`/`deleteStudent` unchanged.)
Then extend the teachers client in `web/app/src/api/teachers.ts`:
```ts
import { apiFetch } from './client'
import type {
  Gender,
  SortColumn,
  SortDir,
  Teacher,
  TeacherInput,
  TeacherList,
  TeacherStatus,
} from './types'

export type TeacherListQuery = {
  q?: string
  status?: TeacherStatus
  daerah?: string
  gender?: Gender
  sort?: SortColumn
  dir?: SortDir
  limit?: number
  offset?: number
}

export function listTeachers(params: TeacherListQuery = {}) {
  const q = new URLSearchParams()
  if (params.q) q.set('q', params.q)
  if (params.status) q.set('status', params.status)
  if (params.daerah) q.set('daerah', params.daerah)
  if (params.gender) q.set('gender', params.gender)
  if (params.sort) q.set('sort', params.sort)
  if (params.dir) q.set('dir', params.dir)
  if (params.limit !== undefined) q.set('limit', String(params.limit))
  if (params.offset !== undefined) q.set('offset', String(params.offset))
  const qs = q.toString()
  return apiFetch<TeacherList>(`/api/teachers${qs ? `?${qs}` : ''}`)
}
```
(Leave `getTeacher`/`createTeacher`/`updateTeacher`/`deleteTeacher` unchanged.)
- [ ] **Step 4: Type-check the frontend**
Run: `npm --prefix web/app run typecheck`
Expected: PASS — no type errors. (The new params are now used; pages still call the old signature subset, which remains valid since all new fields are optional.)
- [ ] **Step 5: Commit**
```bash
git add web/app/src/api/types.ts web/app/src/api/students.ts web/app/src/api/teachers.ts
git commit -m "feat(web): serialize gender/sort/dir in list API clients"
```

---

### Task 8: `SortableTh` component + i18n strings

**Files:**
- Create: `web/app/src/components/SortableTh.tsx`
- Modify: `web/app/src/locales/id.json` (add `common.sortAsc/sortDesc/sortBy`)
- Modify: `web/app/src/locales/en.json` (same keys)
- Test: Chrome DevTools per `TEST.md`; `make typecheck`.

- [ ] **Step 1: Add the i18n keys (write first so the component's `t()` calls resolve)**
In `web/app/src/locales/id.json`, add to the `common` object (e.g. after `"actions": "Aksi",`):
```json
    "sortAsc": "Urut naik",
    "sortDesc": "Urut turun",
    "sortBy": "Urutkan menurut {{col}}",
```
In `web/app/src/locales/en.json`, add to the `common` object (after `"actions": "Actions",`):
```json
    "sortAsc": "Sort ascending",
    "sortDesc": "Sort descending",
    "sortBy": "Sort by {{col}}",
```
- [ ] **Step 2: Confirm JSON still parses**
Run: `node -e "JSON.parse(require('fs').readFileSync('web/app/src/locales/id.json','utf8')); JSON.parse(require('fs').readFileSync('web/app/src/locales/en.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no JSON syntax error from the inserted keys).
- [ ] **Step 3: Write the component**
Create `web/app/src/components/SortableTh.tsx`. It renders a `<th>` whose button toggles sort state for `column`, calling `onSort(column, nextDir)`. A click on an inactive column sorts ASC; clicking the active column toggles ASC↔DESC. The active-direction chevron uses lucide `ArrowUp`/`ArrowDown` (both already used elsewhere in the app); inactive columns show a dimmed `ArrowUpDown`:
```tsx
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { SortColumn, SortDir } from '@/api/types'

interface SortableThProps {
  column: SortColumn
  label: string
  activeColumn?: SortColumn
  activeDir?: SortDir
  onSort: (column: SortColumn, dir: SortDir) => void
  className?: string
}

export function SortableTh({
  column,
  label,
  activeColumn,
  activeDir,
  onSort,
  className,
}: SortableThProps) {
  const { t } = useTranslation()
  const isActive = activeColumn === column
  // Inactive column: first click sorts ascending. Active column: toggle.
  const nextDir: SortDir = isActive && activeDir === 'asc' ? 'desc' : 'asc'
  const ariaLabel = isActive
    ? activeDir === 'asc'
      ? t('common.sortDesc')
      : t('common.sortAsc')
    : t('common.sortBy', { col: label })

  return (
    <th className={'px-4 py-2 ' + (className ?? '')}>
      <button
        type="button"
        onClick={() => onSort(column, nextDir)}
        aria-label={ariaLabel}
        title={ariaLabel}
        className="inline-flex items-center gap-1 font-inherit uppercase tracking-wide text-slate-500 hover:text-slate-800"
      >
        <span>{label}</span>
        {isActive ? (
          activeDir === 'asc' ? (
            <ArrowUp size={12} className="text-slate-700" />
          ) : (
            <ArrowDown size={12} className="text-slate-700" />
          )
        ) : (
          <ArrowUpDown size={12} className="text-slate-300" />
        )}
      </button>
    </th>
  )
}
```
- [ ] **Step 4: Type-check**
Run: `npm --prefix web/app run typecheck`
Expected: PASS — `SortableTh` compiles against the `SortColumn`/`SortDir` types from Task 7.
- [ ] **Step 5: Commit**
```bash
git add web/app/src/components/SortableTh.tsx web/app/src/locales/id.json web/app/src/locales/en.json
git commit -m "feat(web): add SortableTh component and sort i18n"
```

---

### Task 9: Wire gender filter + sortable headers into the Students page

**Files:**
- Modify: `web/app/src/pages/Students.tsx` (param parse L39-47; query L71-75; `updateSearch` L114-121; filter form ~L199-214; list `<thead>` L244-256; createdAt cell + colSpan; add `createdAt` col i18n)
- Modify: `web/app/src/locales/id.json` + `en.json` (`students.allGender/genderMale/genderFemale`, `students.cols.createdAt`)
- Test: Chrome DevTools per `TEST.md`; `make typecheck`.

- [ ] **Step 1: Add the students i18n keys (write first)**
In `web/app/src/locales/id.json`, add to `students` (e.g. after `"allKelompok": "Semua kelompok",`):
```json
    "allGender": "Semua jenis kelamin",
    "genderMale": "Laki-laki",
    "genderFemale": "Perempuan",
```
and inside `students.cols` add (after `"status": "Status"` — add a comma to the prior line):
```json
    "createdAt": "Ditambahkan"
```
In `web/app/src/locales/en.json`, add to `students` (after `"allKelompok": "All groups",`):
```json
    "allGender": "All genders",
    "genderMale": "Male",
    "genderFemale": "Female",
```
and inside `students.cols`:
```json
    "createdAt": "Added"
```
- [ ] **Step 2: Confirm JSON parses, then verify the page does NOT yet read these (gate the wiring)**
Run: `node -e "JSON.parse(require('fs').readFileSync('web/app/src/locales/id.json','utf8'));JSON.parse(require('fs').readFileSync('web/app/src/locales/en.json','utf8'));console.log('json ok')" && npm --prefix web/app run typecheck`
Expected: prints `json ok` then typecheck PASS (keys unused so far).
- [ ] **Step 3: Wire the page**
Edit `web/app/src/pages/Students.tsx`.

(a) Add the `SortableTh` import and the `Gender`/`SortColumn`/`SortDir` types. Replace the import block at L14-19:
```tsx
import {
  SORT_COLUMNS,
  STUDENT_KELOMPOKS,
  type Gender,
  type SortColumn,
  type SortDir,
  type Student,
  type StudentInput,
  type StudentKelompok,
} from '@/api/types'
```
and add after the `StudentForm` import (after L28):
```tsx
import { SortableTh } from '@/components/SortableTh'
```

(b) Parse `gender/sort/dir` from the URL. After the `kelompok` parse block (after L45, before `const page = ...`):
```tsx
  const genderParam = params.get('gender')
  const gender: Gender | undefined =
    genderParam === 'male' || genderParam === 'female' ? genderParam : undefined
  const sortParam = params.get('sort')
  const sort = (SORT_COLUMNS as readonly string[]).includes(sortParam ?? '')
    ? (sortParam as SortColumn)
    : undefined
  const dirParam = params.get('dir')
  const dir: SortDir | undefined =
    dirParam === 'asc' || dirParam === 'desc' ? dirParam : undefined
```

(c) Thread into the query (replace L71-75):
```tsx
  const { data, isPending } = useQuery({
    queryKey: ['students', { q, status, kelompok, gender, sort, dir, page }],
    queryFn: () =>
      listStudents({
        q,
        status,
        kelompok,
        gender,
        sort,
        dir,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      }),
  })
```

(d) Replace `updateSearch` (L114-121) so it carries gender/sort/dir and only writes non-default sort/dir, resetting page on filter/sort change:
```tsx
  const updateSearch = (next: {
    q?: string
    status?: string
    kelompok?: string
    gender?: string
    sort?: string
    dir?: string
    page?: number
  }) => {
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    if (next.status) sp.set('status', next.status)
    if (next.kelompok) sp.set('kelompok', next.kelompok)
    if (next.gender) sp.set('gender', next.gender)
    // Only persist a non-default sort (default = name ASC).
    if (next.sort && !(next.sort === 'name' && (next.dir ?? 'asc') === 'asc')) {
      sp.set('sort', next.sort)
      if (next.dir && next.dir !== 'asc') sp.set('dir', next.dir)
    }
    if (next.page && next.page > 1) sp.set('page', String(next.page))
    navigate({ pathname: '/students', search: sp.toString() ? `?${sp.toString()}` : '' })
  }

  const handleSort = (column: SortColumn, nextDir: SortDir) => {
    updateSearch({ q, status, kelompok, gender, sort: column, dir: nextDir, page: 1 })
  }
```

(e) Add a gender `<select>` to the filter form. The form's `onSubmit` (L172-181) reads `FormData`; add `gender` to its `updateSearch` call:
```tsx
          updateSearch({
            q: String(fd.get('q') ?? '') || undefined,
            status: String(fd.get('status') ?? '') || undefined,
            kelompok: String(fd.get('kelompok') ?? '') || undefined,
            gender: String(fd.get('gender') ?? '') || undefined,
            sort,
            dir,
            page: 1,
          })
```
and insert the select after the existing kelompok `<select>` (after L210, before the submit `<Button>`):
```tsx
        <select
          name="gender"
          defaultValue={gender ?? ''}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <option value="">{t('students.allGender')}</option>
          <option value="male">{t('students.genderMale')}</option>
          <option value="female">{t('students.genderFemale')}</option>
        </select>
```

(f) Make the Name header sortable and add a Created column to the list table. Replace the Name `<th>` (L247) and the Status `<th>` (L253) region of `<thead>` (L245-255):
```tsx
            <tr>
              <th className="px-4 py-2 w-12"></th>
              <SortableTh
                column="name"
                label={t('students.cols.name')}
                activeColumn={sort}
                activeDir={dir}
                onSort={handleSort}
              />
              <th className="hidden px-4 py-2 sm:table-cell">{t('students.cols.nickname')}</th>
              <th className="hidden px-4 py-2 sm:table-cell">{t('students.cols.gender')}</th>
              <th className="hidden px-4 py-2 sm:table-cell">{t('students.cols.age')}</th>
              <th className="hidden px-4 py-2 md:table-cell">{t('students.cols.level')}</th>
              <th className="hidden px-4 py-2 md:table-cell">{t('students.cols.kelompok')}</th>
              <th className="px-4 py-2">{t('students.cols.status')}</th>
              <SortableTh
                column="created_at"
                label={t('students.cols.createdAt')}
                activeColumn={sort}
                activeDir={dir}
                onSort={handleSort}
                className="hidden lg:table-cell"
              />
              {isAdmin ? <th className="px-4 py-2 text-right">{t('common.actions')}</th> : null}
            </tr>
```
Add a matching body cell after the Status `<td>` (after the `</td>` that closes the `StatusPill` cell, currently L289):
```tsx
                  <td className="hidden px-4 py-2 lg:table-cell">
                    {new Date(s.createdAt).toLocaleDateString()}
                  </td>
```
The list table now has one extra column, so bump both empty/loading `colSpan` values (currently `isAdmin ? 9 : 8` at L260 and L303) to:
```tsx
                <td colSpan={isAdmin ? 10 : 9} className="px-4 py-6 text-center text-slate-500">
```

(g) The pagination prev/next buttons call `updateSearch({ q, status, kelompok, page })` (L320, L328); add `gender, sort, dir` so paging preserves the active filter/sort:
```tsx
            onClick={() => updateSearch({ q, status, kelompok, gender, sort, dir, page: Math.max(1, page - 1) })}
```
```tsx
            onClick={() => updateSearch({ q, status, kelompok, gender, sort, dir, page: Math.min(totalPages, page + 1) })}
```
- [ ] **Step 4: Type-check**
Run: `npm --prefix web/app run typecheck`
Expected: PASS — all new state/props typed; `colSpan` and the new column compile.
- [ ] **Step 5: Commit**
```bash
git add web/app/src/pages/Students.tsx web/app/src/locales/id.json web/app/src/locales/en.json
git commit -m "feat(web): gender filter and sortable headers on students"
```

---

### Task 10: Wire gender filter + sortable headers into the Teachers page

**Files:**
- Modify: `web/app/src/pages/Teachers.tsx` (param parse L33-37; query L59-63; `updateSearch` L102-108; filter form ~L176-187; list `<thead>` L218-227; createdAt cell + colSpan; pagination L283/L291)
- Modify: `web/app/src/locales/id.json` + `en.json` (`teachers.allGender/genderMale/genderFemale`, `teachers.cols.createdAt`)
- Test: Chrome DevTools per `TEST.md`; `make typecheck`.

- [ ] **Step 1: Add the teachers i18n keys (write first)**
In `web/app/src/locales/id.json`, add to `teachers` (after `"allStatus": "Semua status",`):
```json
    "allGender": "Semua jenis kelamin",
    "genderMale": "Laki-laki",
    "genderFemale": "Perempuan",
```
and inside `teachers.cols` add `createdAt` (append after `"status": "Status"`, adding a comma to the prior line):
```json
    "createdAt": "Ditambahkan"
```
In `web/app/src/locales/en.json`, add to `teachers` (after `"allStatus": "All statuses",`):
```json
    "allGender": "All genders",
    "genderMale": "Male",
    "genderFemale": "Female",
```
and inside `teachers.cols`:
```json
    "createdAt": "Added"
```
- [ ] **Step 2: Confirm JSON parses + typecheck baseline**
Run: `node -e "JSON.parse(require('fs').readFileSync('web/app/src/locales/id.json','utf8'));JSON.parse(require('fs').readFileSync('web/app/src/locales/en.json','utf8'));console.log('json ok')" && npm --prefix web/app run typecheck`
Expected: prints `json ok` then typecheck PASS.
- [ ] **Step 3: Wire the page**
Edit `web/app/src/pages/Teachers.tsx`.

(a) Replace the type import (L14) and add the `SortableTh` import after the `TeacherForm` import (after L23):
```tsx
import {
  SORT_COLUMNS,
  type Gender,
  type SortColumn,
  type SortDir,
  type Teacher,
  type TeacherInput,
} from '@/api/types'
```
```tsx
import { SortableTh } from '@/components/SortableTh'
```

(b) Parse `gender/sort/dir`. After the `status` parse (after L36, before `const page = ...`):
```tsx
  const genderParam = params.get('gender')
  const gender: Gender | undefined =
    genderParam === 'male' || genderParam === 'female' ? genderParam : undefined
  const sortParam = params.get('sort')
  const sort = (SORT_COLUMNS as readonly string[]).includes(sortParam ?? '')
    ? (sortParam as SortColumn)
    : undefined
  const dirParam = params.get('dir')
  const dir: SortDir | undefined =
    dirParam === 'asc' || dirParam === 'desc' ? dirParam : undefined
```

(c) Thread into the query (replace L59-63):
```tsx
  const { data, isPending } = useQuery({
    queryKey: ['teachers', { q, status, gender, sort, dir, page }],
    queryFn: () =>
      listTeachers({ q, status, gender, sort, dir, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }),
  })
```

(d) Replace `updateSearch` (L102-108) and add `handleSort`:
```tsx
  const updateSearch = (next: {
    q?: string
    status?: string
    gender?: string
    sort?: string
    dir?: string
    page?: number
  }) => {
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    if (next.status) sp.set('status', next.status)
    if (next.gender) sp.set('gender', next.gender)
    if (next.sort && !(next.sort === 'name' && (next.dir ?? 'asc') === 'asc')) {
      sp.set('sort', next.sort)
      if (next.dir && next.dir !== 'asc') sp.set('dir', next.dir)
    }
    if (next.page && next.page > 1) sp.set('page', String(next.page))
    navigate({ pathname: '/teachers', search: sp.toString() ? `?${sp.toString()}` : '' })
  }

  const handleSort = (column: SortColumn, nextDir: SortDir) => {
    updateSearch({ q, status, gender, sort: column, dir: nextDir, page: 1 })
  }
```

(e) Add gender to the filter form. In the form `onSubmit` `updateSearch` call (L162-166):
```tsx
          updateSearch({
            q: String(fd.get('q') ?? '') || undefined,
            status: String(fd.get('status') ?? '') || undefined,
            gender: String(fd.get('gender') ?? '') || undefined,
            sort,
            dir,
            page: 1,
          })
```
and insert the select after the status `<select>` (after L184, before the submit `<Button>`):
```tsx
        <select
          name="gender"
          defaultValue={gender ?? ''}
          className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
        >
          <option value="">{t('teachers.allGender')}</option>
          <option value="male">{t('teachers.genderMale')}</option>
          <option value="female">{t('teachers.genderFemale')}</option>
        </select>
```

(f) Sortable Name header + Created column. Replace the `<thead>` `<tr>` (L219-227):
```tsx
            <tr>
              <th className="px-4 py-2 w-12"></th>
              <SortableTh
                column="name"
                label={t('teachers.cols.name')}
                activeColumn={sort}
                activeDir={dir}
                onSort={handleSort}
              />
              <th className="hidden px-4 py-2 sm:table-cell">{t('teachers.cols.nickname')}</th>
              <th className="hidden px-4 py-2 md:table-cell">{t('teachers.cols.kelompok')}</th>
              <th className="hidden px-4 py-2 md:table-cell">{t('teachers.cols.daerah')}</th>
              <th className="px-4 py-2">{t('teachers.cols.status')}</th>
              <SortableTh
                column="created_at"
                label={t('teachers.cols.createdAt')}
                activeColumn={sort}
                activeDir={dir}
                onSort={handleSort}
                className="hidden lg:table-cell"
              />
              {isAdmin ? <th className="px-4 py-2 text-right">{t('common.actions')}</th> : null}
            </tr>
```
Add the body cell after the Status `<td>` (after the `</td>` closing the `StatusPill` cell, currently L252):
```tsx
                  <td className="hidden px-4 py-2 lg:table-cell">
                    {new Date(tch.createdAt).toLocaleDateString()}
                  </td>
```
Bump both `colSpan` values (currently `isAdmin ? 7 : 6` at L232 and L266) to:
```tsx
                <td colSpan={isAdmin ? 8 : 7} className="px-4 py-6 text-center text-slate-500">
```

(g) Pagination buttons (L283, L291) — add `gender, sort, dir`:
```tsx
            onClick={() => updateSearch({ q, status, gender, sort, dir, page: Math.max(1, page - 1) })}
```
```tsx
            onClick={() => updateSearch({ q, status, gender, sort, dir, page: Math.min(totalPages, page + 1) })}
```
- [ ] **Step 4: Type-check**
Run: `npm --prefix web/app run typecheck`
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add web/app/src/pages/Teachers.tsx web/app/src/locales/id.json web/app/src/locales/en.json
git commit -m "feat(web): gender filter and sortable headers on teachers"
```

---

### Task 11: Full verification (backend + frontend + browser)

**Files:** none (verification only)

- [ ] **Step 1: Run the full Go suite**
Run: `make test`
Expected: PASS — all packages green (store + handler suites incl. the new gender/sort tests).
- [ ] **Step 2: Type-check the frontend**
Run: `make typecheck`
Expected: PASS — no TS errors across `api/*`, `components/SortableTh.tsx`, `pages/Students.tsx`, `pages/Teachers.tsx`.
- [ ] **Step 3: Browser-verify via Chrome DevTools (per `TEST.md`)**
gnrs has **no JS test runner**, so frontend behavior is verified through the Chrome DevTools MCP flow against your namespaced local dev container (build the image from this worktree, run on a free `127.0.0.1:18300-18999` port, follow `CHROME_DEVTOOLS.md` pre-flight). Drive:
  - Log in (seed admin from `.env`), open `/students`.
  - Select **Perempuan/Female** in the gender filter, Apply → `list_network_requests` shows `GET /api/students?...gender=female` returning 200, and only female rows render; URL has `?gender=female`.
  - Switch to **Daftar/List** view, click the **Name** header → request gains `sort=name&dir=desc`, header chevron flips, rows reorder; click again → ascending, and the URL drops `sort/dir` (default not persisted).
  - Click the **Ditambahkan/Added** header → `sort=created_at&dir=asc`; toggle to `desc`.
  - Repeat the gender + sort sweep on `/teachers` (verify NULL-gender teachers disappear under a gender filter).
  - Set a bad query manually (`/students?gender=bogus`) → confirm the backend 400 and that the SPA surfaces it without crashing; `list_console_messages` shows no new errors.
  - Sign out; confirm protected routes redirect to `/login`.
Capture screenshots + the `list_network_requests` excerpts for the PR's "Tested via Chrome DevTools" section. If the dev container cannot be built/run, state that explicitly in the PR per `TEST.md` instead of claiming browser verification.
- [ ] **Step 4: (no code; gate only — do not commit)** If any check fails, fix in the owning task and re-run from Step 1.
