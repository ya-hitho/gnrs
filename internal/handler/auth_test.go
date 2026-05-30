package handler

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/fadhilkurnia/ppg-dashboard/internal/auth"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func newAuthTestDeps(t *testing.T, dynamic bool) (*Auth, *store.Users) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	users := store.NewUsers(db)
	if err := store.SeedAdmin(context.Background(), users, "admin@example.com", "admin", "password123"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	jwtSvc := auth.NewJWT([]byte("test-secret-of-at-least-32-bytes!!"), time.Hour)
	a := NewAuth(users, jwtSvc, false, dynamic)
	return a, users
}

func doLogin(t *testing.T, a *Auth, identifier, password string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"identifier":"` + identifier + `","password":"` + password + `"}`
	r := httptest.NewRequest(http.MethodPost, "/api/auth/login", strings.NewReader(body))
	w := httptest.NewRecorder()
	a.Login(w, r)
	return w
}

func TestLogin_DynamicOn_SetsAuthPathCookieAndApiBase(t *testing.T) {
	a, _ := newAuthTestDeps(t, true)
	w := doLogin(t, a, "admin@example.com", "password123")

	if w.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Result().StatusCode, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	apiBase, _ := resp["apiBase"].(string)
	if !strings.HasPrefix(apiBase, "/") || len(apiBase) != 1+auth.APIPathLen {
		t.Fatalf("apiBase = %q, want a /<6-char-prefix>", apiBase)
	}
	prefix := strings.TrimPrefix(apiBase, "/")
	if !auth.IsValidPath(prefix) {
		t.Errorf("apiBase prefix %q is not a valid dynamic path", prefix)
	}
	if resp["id"] == nil || resp["email"] != "admin@example.com" {
		t.Errorf("login body missing embedded user fields: %v", resp)
	}

	var pathCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == auth.APIPathCookieName {
			pathCookie = c
		}
	}
	if pathCookie == nil {
		t.Fatal("auth_path cookie not set")
	}
	if pathCookie.Value != prefix {
		t.Errorf("auth_path cookie = %q, want %q (matches apiBase)", pathCookie.Value, prefix)
	}
	if pathCookie.MaxAge != int(time.Hour.Seconds()) {
		t.Errorf("auth_path MaxAge = %d, want %d (JWT TTL)", pathCookie.MaxAge, int(time.Hour.Seconds()))
	}
}

func TestLogin_DynamicOff_ReturnsCanonicalApiBase(t *testing.T) {
	a, _ := newAuthTestDeps(t, false)
	w := doLogin(t, a, "admin@example.com", "password123")
	if w.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Result().StatusCode, w.Body.String())
	}
	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["apiBase"] != "/api" {
		t.Errorf("apiBase = %v, want /api when dynamic disabled", resp["apiBase"])
	}
	for _, c := range w.Result().Cookies() {
		if c.Name == auth.APIPathCookieName {
			t.Errorf("auth_path cookie should not be set when dynamic disabled")
		}
	}
}

func TestLogout_ClearsAuthPathCookie(t *testing.T) {
	a, _ := newAuthTestDeps(t, true)
	r := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	w := httptest.NewRecorder()
	a.Logout(w, r)
	var pathCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == auth.APIPathCookieName {
			pathCookie = c
		}
	}
	if pathCookie == nil {
		t.Fatal("auth_path clearing cookie not set on logout")
	}
	if pathCookie.MaxAge != -1 {
		t.Errorf("auth_path MaxAge = %d, want -1 (cleared)", pathCookie.MaxAge)
	}
}

// TestMe_DynamicOn_MissingAuthPath_SelfHeals pins the recovery behaviour: a
// request bearing a valid JWT but NO auth_path cookie (an existing session on
// the first load after the dynamic-path feature was enabled, or an evicted
// cookie) must NOT be bounced to /login. Me mints a fresh prefix, sets the
// auth_path cookie, and returns it as apiBase so the SPA self-heals.
func TestMe_DynamicOn_MissingAuthPath_SelfHeals(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	users := store.NewUsers(db)
	if err := store.SeedAdmin(context.Background(), users, "admin@example.com", "admin", "password123"); err != nil {
		t.Fatalf("seed admin: %v", err)
	}
	jwtSvc := auth.NewJWT([]byte("test-secret-of-at-least-32-bytes!!"), time.Hour)
	a := NewAuth(users, jwtSvc, false, true) // dynamic ON

	u, err := users.FindByIdentifier(context.Background(), "admin@example.com")
	if err != nil {
		t.Fatalf("find admin: %v", err)
	}
	tok, err := jwtSvc.Issue(u.ID, u.Role)
	if err != nil {
		t.Fatalf("issue token: %v", err)
	}

	// Valid JWT cookie, deliberately NO auth_path cookie. Drive Me through the
	// real auth middleware so claims land in the context exactly as in prod.
	r := httptest.NewRequest(http.MethodGet, "/api/auth/me", nil)
	r.AddCookie(&http.Cookie{Name: auth.CookieName, Value: tok})
	w := httptest.NewRecorder()
	auth.Middleware(jwtSvc)(http.HandlerFunc(a.Me)).ServeHTTP(w, r)

	if w.Result().StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200 (valid JWT must self-heal, not be bounced); body=%s",
			w.Result().StatusCode, w.Body.String())
	}

	var resp map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	apiBase, _ := resp["apiBase"].(string)
	if apiBase == "/api" || len(apiBase) != 1+auth.APIPathLen {
		t.Fatalf("apiBase = %q, want a freshly minted /<%d-char-prefix>, not the canonical /api",
			apiBase, auth.APIPathLen)
	}
	prefix := strings.TrimPrefix(apiBase, "/")
	if !auth.IsValidPath(prefix) {
		t.Errorf("recovered apiBase prefix %q is not a valid dynamic path", prefix)
	}

	var pathCookie *http.Cookie
	for _, c := range w.Result().Cookies() {
		if c.Name == auth.APIPathCookieName {
			pathCookie = c
		}
	}
	if pathCookie == nil {
		t.Fatal("Me did not set a recovery auth_path cookie")
	}
	if pathCookie.Value != prefix {
		t.Errorf("auth_path cookie = %q, want %q (matches recovered apiBase)", pathCookie.Value, prefix)
	}
}
