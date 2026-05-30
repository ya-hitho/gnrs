package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func newStudentsHandler(t *testing.T) (*Students, *store.Students) {
	t.Helper()
	db := openTestDB(t)
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
