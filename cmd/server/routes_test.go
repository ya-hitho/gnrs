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
