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
