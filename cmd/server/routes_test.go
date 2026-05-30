package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/fadhilkurnia/ppg-dashboard/internal/auth"
	"github.com/fadhilkurnia/ppg-dashboard/internal/handler"
	"github.com/fadhilkurnia/ppg-dashboard/internal/httpx"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func TestPublicRoutesAreUnauthenticated(t *testing.T) {
	db := openTestDB(t)

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

// TestLoginRouteIsRateLimited pins the security invariant that /api/auth/login
// sits behind a per-IP rate limiter, using the same loginRate* knobs run()
// wires it with — so unthrottled credential brute-force / bcrypt CPU
// exhaustion cannot regress. Mirrors the run() wiring (same reconstruct style
// as TestPublicRoutesAreUnauthenticated).
func TestLoginRouteIsRateLimited(t *testing.T) {
	db := openTestDB(t)
	users := store.NewUsers(db)
	if err := store.SeedAdmin(context.Background(), users, "admin@example.com", "admin", "password123"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	jwtSvc := auth.NewJWT([]byte("test-secret-of-at-least-32-bytes!!"), time.Hour)
	authH := handler.NewAuth(users, jwtSvc, false, true)
	loginRL := httpx.NewIPRateLimiter(loginRateBurst, loginRateWindow)

	r := chi.NewRouter()
	r.Route("/api", func(api chi.Router) {
		api.With(loginRL.Middleware).Post("/auth/login", authH.Login)
	})

	body := `{"identifier":"admin","password":"wrong-password"}`
	call := func() int {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
		req.RemoteAddr = "10.0.0.7:5555"
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)
		return rec.Code
	}

	// Exhaust the burst (all reach the handler -> 401 invalid creds), then the
	// next attempt from the same IP must be throttled with 429.
	for i := range loginRateBurst {
		if got := call(); got == http.StatusTooManyRequests {
			t.Fatalf("attempt %d was throttled (429) before the burst of %d was exhausted", i+1, loginRateBurst)
		}
	}
	if got := call(); got != http.StatusTooManyRequests {
		t.Fatalf("attempt %d = %d, want 429 (login must be IP-rate-limited)", loginRateBurst+1, got)
	}
}
