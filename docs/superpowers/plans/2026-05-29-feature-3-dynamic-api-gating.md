# Dynamic API-path Gating (default ON) + 403-as-unauth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port ppgus's dynamic per-session API-path gate into gnrs — enabled by default — so every `/api/*` call is routed through a rotating 6-char prefix bound to an `auth_path` cookie, and the SPA treats `403 api_path_required`/`403 bad_api_path` (alongside `401`) as "unauthenticated → bounce to login".

**Architecture:** A chi middleware (`auth.DynamicAPIPath`) rewrites `/<6-char-prefix>/<rest>` → `/api/<rest>` when the request's `auth_path` cookie matches, and refuses direct `/api/*` (403) except for a small bootstrap **`directAPIAllowlist`** (`/api/auth/login`, `/api/auth/logout`, `/api/files/photos/`, `/api/public/`). On login the server generates a fresh prefix, sets the `auth_path` cookie (TTL tied to the JWT), and returns the user augmented with `apiBase`. The SPA reads its starting base from a `<meta name="gnrs-api-base">` tag the Go SPA handler substitutes per request, and re-resolves every outgoing path through `resolveApiPath()` in the single shared `request()` in `lib/api.ts`.

**WARNING — this is a hard cutover (default-on).** gnrs has **two** calling conventions and BOTH must resolve through the base or the SPA 403s immediately after login: (1) `apiFetch`/`api.{get,post,...}` callers that pass literal `/api/...` strings (~123 call sites, all funneled through `request()` in `lib/api.ts`, re-exported by `api/client.ts`), and (2) `lib/auth.tsx`'s LIVE auth path (`api.post('/auth/login')` / `api.get('/auth/me')` — non-`/api` paths that today get prefixed to `/api/...` by `request()`). The retrofit centralizes in `lib/api.ts request()` (covers both) plus `lib/auth.tsx` (403-as-unauth + `setApiBase`). Photo `<img src="/api/files/...">` URLs are **browser-issued GETs that cannot carry the rotating prefix**, so they MUST stay on the allowlisted `/api/files/photos/` path and MUST NOT be rewritten. **Do NOT** copy ppgus's refresh-token machinery — gnrs has none (`auth.RefreshCookieName`, `IssueRefresh`, `VerifyRefresh`, `GetRefreshJTI` do not exist in gnrs).

**Tech Stack:** Go 1.25 + chi v5 + `crypto/rand`/`crypto/subtle`; embedded React 18 SPA (Vite, react-router-dom, TanStack Query, react-i18next); `internal/httpx` JSON/error envelope; cookie-based JWT auth (`auth.CookieName = "auth"`). No migration (cookie-only). No frontend test runner exists in gnrs — frontend verification is the Chrome-DevTools flow per `TEST.md`.

---

### Task 1: Config flag `DynamicAPIPath` (default true)
**Files:**
- Modify: `internal/config/config.go:11-22` (Config struct), `internal/config/config.go:24-36` (Load)
- Test: `internal/config/config_test.go` (Create)

- [ ] **Step 1: Write the failing test**

Create `internal/config/config_test.go`:
```go
package config

import (
	"os"
	"testing"
)

// withEnv sets env vars for the duration of the test and restores them after.
func withEnv(t *testing.T, kv map[string]string) {
	t.Helper()
	for k, v := range kv {
		old, had := os.LookupEnv(k)
		if err := os.Setenv(k, v); err != nil {
			t.Fatalf("setenv %s: %v", k, err)
		}
		t.Cleanup(func() {
			if had {
				_ = os.Setenv(k, old)
			} else {
				_ = os.Unsetenv(k)
			}
		})
	}
}

func TestLoadDynamicAPIPathDefaultsTrue(t *testing.T) {
	withEnv(t, map[string]string{
		"JWT_SECRET": "test-secret-of-at-least-32-bytes!!",
	})
	_ = os.Unsetenv("DYNAMIC_API_PATH")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if !cfg.DynamicAPIPath {
		t.Errorf("DynamicAPIPath = false, want true (default ON)")
	}
}

func TestLoadDynamicAPIPathOverrideFalse(t *testing.T) {
	withEnv(t, map[string]string{
		"JWT_SECRET":       "test-secret-of-at-least-32-bytes!!",
		"DYNAMIC_API_PATH": "false",
	})
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.DynamicAPIPath {
		t.Errorf("DynamicAPIPath = true, want false (DYNAMIC_API_PATH=false)")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/config/ -run TestLoadDynamicAPIPath -v`
Expected: FAIL — compile error `cfg.DynamicAPIPath undefined (type Config has no field or method DynamicAPIPath)`.

- [ ] **Step 3: Write minimal implementation**

In `internal/config/config.go`, add the field to the `Config` struct (after `Dev bool` on line 21):
```go
	Dev             bool
	DynamicAPIPath  bool
```

In `Load()` (inside the `Config{...}` literal, after `Dev: getBool("DEV", false),` on line 35):
```go
		Dev:            getBool("DEV", false),
		DynamicAPIPath: getBool("DYNAMIC_API_PATH", true),
```
(The `getBool` helper already exists at `internal/config/config.go:66`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/config/ -run TestLoadDynamicAPIPath -v`
Expected: PASS (both subtests).

- [ ] **Step 5: Commit**
```bash
git add internal/config/config.go internal/config/config_test.go
git commit -m "feat(config): add DynamicAPIPath flag default true"
```

---

### Task 2: API-path generation + cookie helpers (`auth/apipath.go`)
**Files:**
- Create: `internal/auth/apipath.go`
- Test: `internal/auth/apipath_test.go` (Create)

- [ ] **Step 1: Write the failing test**

Create `internal/auth/apipath_test.go` (ported verbatim from ppgus `internal/auth/apipath_test.go`):
```go
package auth

import "testing"

func TestGeneratePathConformsToShape(t *testing.T) {
	for i := 0; i < 50; i++ {
		got, err := GeneratePath()
		if err != nil {
			t.Fatalf("GeneratePath: %v", err)
		}
		if !IsValidPath(got) {
			t.Fatalf("GeneratePath returned non-conforming value: %q", got)
		}
	}
}

func TestGeneratePathDistinct(t *testing.T) {
	a, err := GeneratePath()
	if err != nil {
		t.Fatalf("GeneratePath: %v", err)
	}
	b, err := GeneratePath()
	if err != nil {
		t.Fatalf("GeneratePath: %v", err)
	}
	if a == b {
		t.Fatalf("expected distinct paths, got %q twice", a)
	}
}

func TestIsValidPath(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want bool
	}{
		{"empty", "", false},
		{"too short", "abc", false},
		{"too long", "0123456", false},
		{"uppercase", "A3F8D2", false},
		{"mixed case", "a3F8d2", false},
		{"symbol", "a3f8d!", false},
		{"trailing space", "a3f8d ", false},
		{"valid hex-style", "a3f8d2", true},
		{"valid letters past f", "xyz789", true},
		{"all letters rejected", "abcxyz", false},
		{"natural word rejected", "assets", false},
		{"valid zeros", "000000", true},
		{"valid mixed", "g1h2i3", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsValidPath(tc.in); got != tc.want {
				t.Errorf("IsValidPath(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

func TestEqualPath(t *testing.T) {
	cases := []struct {
		a, b string
		want bool
	}{
		{"a3f8d2", "a3f8d2", true},
		{"a3f8d2", "b3f8d2", false},
		{"a3f8d2", "a3f8d", false}, // length mismatch
		{"", "", true},             // documented behaviour: identical empties match
	}
	for _, tc := range cases {
		t.Run(tc.a+"_vs_"+tc.b, func(t *testing.T) {
			if got := EqualPath(tc.a, tc.b); got != tc.want {
				t.Errorf("EqualPath(%q, %q) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/auth/ -run 'TestGeneratePath|TestIsValidPath|TestEqualPath' -v`
Expected: FAIL — compile error `undefined: GeneratePath`, `undefined: IsValidPath`, `undefined: EqualPath`.

- [ ] **Step 3: Write minimal implementation**

Create `internal/auth/apipath.go` (ported verbatim from ppgus `internal/auth/apipath.go`; gnrs is the same Go module path so imports are unchanged):
```go
package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"net/http"
)

// APIPathCookieName holds the per-session dynamic API prefix. It is a
// 6-character lowercase alphanumeric (base36) string.
const APIPathCookieName = "auth_path"

// APIPathLen is the length of a dynamic API prefix in characters.
const APIPathLen = 6

// apiPathAlphabet is the base36 alphabet (0-9, a-z) used to encode a
// dynamic API prefix. Lowercase keeps URLs case-stable and avoids the
// reader confusion that mixed-case identifiers cause.
const apiPathAlphabet = "0123456789abcdefghijklmnopqrstuvwxyz"

// GeneratePath returns a random APIPathLen-character lowercase
// alphanumeric API prefix containing at least one digit. The digit
// requirement makes the prefix visually distinct from natural English
// paths (e.g. "assets", "robots"), eliminating accidental collision
// with static-asset URLs. Uses rejection sampling so each character is
// uniformly distributed over the 36-letter alphabet despite 36 not
// dividing 256.
func GeneratePath() (string, error) {
	for {
		s, err := generateRaw()
		if err != nil {
			return "", err
		}
		if hasDigit(s) {
			return s, nil
		}
	}
}

func generateRaw() (string, error) {
	const n = len(apiPathAlphabet) // 36
	// 252 is the largest multiple of 36 <= 255; bytes >= 252 are rejected
	// to keep the distribution unbiased.
	const maxAccept = 252

	out := make([]byte, APIPathLen)
	buf := make([]byte, APIPathLen)
	filled := 0
	for filled < APIPathLen {
		if _, err := rand.Read(buf); err != nil {
			return "", fmt.Errorf("read random api path: %w", err)
		}
		for _, b := range buf {
			if b >= maxAccept {
				continue
			}
			out[filled] = apiPathAlphabet[int(b)%n]
			filled++
			if filled == APIPathLen {
				break
			}
		}
	}
	return string(out), nil
}

func hasDigit(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			return true
		}
	}
	return false
}

// IsValidPath reports whether s is a syntactically valid dynamic API
// path: exactly APIPathLen lowercase alphanumeric characters with at
// least one digit. The digit constraint keeps the prefix syntactically
// disjoint from English-word static paths like /assets/, /robots, etc.,
// so the middleware can refuse mismatched prefixes without breaking
// static-asset URLs.
func IsValidPath(s string) bool {
	if len(s) != APIPathLen {
		return false
	}
	seenDigit := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			seenDigit = true
		case c >= 'a' && c <= 'z':
		default:
			return false
		}
	}
	return seenDigit
}

// EqualPath compares two API-path strings in constant time. The caller is
// expected to have length-checked both inputs (via IsValidPath) before
// relying on the result for a security decision.
func EqualPath(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// SetAPIPathCookie writes the dynamic API path cookie. The cookie is
// HttpOnly and SameSite=Lax to match the existing access cookie, and uses
// the same TTL as the access JWT so both expire together.
func SetAPIPathCookie(w http.ResponseWriter, path string, secure bool, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     APIPathCookieName,
		Value:    path,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   maxAge,
	})
}

// ClearAPIPathCookie removes the dynamic API path cookie from the client.
func ClearAPIPathCookie(w http.ResponseWriter, secure bool) {
	http.SetCookie(w, &http.Cookie{
		Name:     APIPathCookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
}

// ReadAPIPathCookie returns the cookie value if present and well formed.
// The second return is false if the cookie is missing or malformed.
func ReadAPIPathCookie(r *http.Request) (string, bool) {
	c, err := r.Cookie(APIPathCookieName)
	if err != nil || c.Value == "" {
		return "", false
	}
	if !IsValidPath(c.Value) {
		return "", false
	}
	return c.Value, true
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/auth/ -run 'TestGeneratePath|TestIsValidPath|TestEqualPath' -v`
Expected: PASS (all subtests).

- [ ] **Step 5: Commit**
```bash
git add internal/auth/apipath.go internal/auth/apipath_test.go
git commit -m "feat(auth): add dynamic api-path generation and cookie helpers"
```

---

### Task 3: Dynamic API-path middleware with gnrs allowlist (`auth/apipath_middleware.go`)
**Files:**
- Create: `internal/auth/apipath_middleware.go`
- Test: `internal/auth/apipath_middleware_test.go` (Create)

- [ ] **Step 1: Write the failing test**

Create `internal/auth/apipath_middleware_test.go` (adapted from ppgus; the allowlist cases reflect gnrs's `directAPIAllowlist`: login, logout, `/api/files/photos/`, `/api/public/`). Note the `/api/auth/logout` case moves from the ppgus "Forbidden" set into the "Allowlist" set, and `/api/files/photos/<file>` is added:
```go
package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// echoHandler returns the request path it received so we can assert on
// how the middleware rewrote (or preserved) the URL.
func echoHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Echo-Path", r.URL.Path)
		w.WriteHeader(http.StatusOK)
	})
}

func newReq(t *testing.T, method, target, cookieVal string) *http.Request {
	t.Helper()
	r := httptest.NewRequest(method, target, nil)
	if cookieVal != "" {
		r.AddCookie(&http.Cookie{Name: APIPathCookieName, Value: cookieVal})
	}
	return r
}

func TestDynamicAPIPath_Disabled_PassesThrough(t *testing.T) {
	h := DynamicAPIPath(false)(echoHandler())
	r := newReq(t, http.MethodGet, "/a3f8d2/students", "a3f8d2")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if got, want := w.Header().Get("X-Echo-Path"), "/a3f8d2/students"; got != want {
		t.Errorf("path = %q, want %q (disabled middleware must not rewrite)", got, want)
	}
}

func TestDynamicAPIPath_NoPrefix_PassesThrough(t *testing.T) {
	h := DynamicAPIPath(true)(echoHandler())
	cases := []string{
		"/",
		"/healthz",
		"/login",
		"/assets/main.js",
		"/a3f8", // too short
	}
	for _, p := range cases {
		t.Run(p, func(t *testing.T) {
			r := newReq(t, http.MethodGet, p, "")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if got := w.Header().Get("X-Echo-Path"); got != p {
				t.Errorf("path = %q, want %q (non-prefix request must pass through)", got, p)
			}
			if w.Result().StatusCode != http.StatusOK {
				t.Errorf("status = %d, want 200", w.Result().StatusCode)
			}
		})
	}
}

func TestDynamicAPIPath_DirectAPI_Allowlist(t *testing.T) {
	// Endpoints the SPA / browser must hit at the canonical /api prefix:
	// login + logout bootstrap, public attendance endpoints, and photo
	// <img> URLs (which can't carry the rotating prefix).
	h := DynamicAPIPath(true)(echoHandler())
	cases := []string{
		"/api/auth/login",
		"/api/auth/logout",
		"/api/public/teachers",
		"/api/public/students",
		"/api/public/attendances",
		"/api/files/photos/abc123.jpg",
	}
	for _, p := range cases {
		t.Run(p, func(t *testing.T) {
			r := newReq(t, http.MethodGet, p, "")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if got := w.Header().Get("X-Echo-Path"); got != p {
				t.Errorf("path = %q, want %q (allowlisted /api must pass through)", got, p)
			}
			if w.Result().StatusCode != http.StatusOK {
				t.Errorf("status = %d, want 200", w.Result().StatusCode)
			}
		})
	}
}

func TestDynamicAPIPath_DirectAPI_Forbidden(t *testing.T) {
	// Direct /api/<protected> calls must be refused regardless of whether
	// the caller has an auth_path cookie, so external tools cannot bypass
	// the per-session prefix.
	h := DynamicAPIPath(true)(echoHandler())
	cases := []string{
		"/api",
		"/api/",
		"/api/auth/me",
		"/api/students",
		"/api/students/abc-123",
		"/api/teachers",
		"/api/attendances",
		"/api/stats/dashboard",
		"/api/files/photos", // no trailing slash: not the allowlisted prefix
	}
	for _, p := range cases {
		t.Run(p, func(t *testing.T) {
			r := newReq(t, http.MethodGet, p, "a3f8d2")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Result().StatusCode != http.StatusForbidden {
				t.Errorf("status = %d, want 403 (direct /api must be blocked)", w.Result().StatusCode)
			}
			if w.Header().Get("X-Echo-Path") != "" {
				t.Error("downstream handler should not have run")
			}
		})
	}
}

func TestDynamicAPIPath_NotAPrefixSegment_PassesThrough(t *testing.T) {
	// "/a3f8d2continued" looks like a 6-alphanumeric prefix but is followed
	// by more characters in the same segment. Must not be rewritten.
	h := DynamicAPIPath(true)(echoHandler())
	r := newReq(t, http.MethodGet, "/a3f8d2continued", "a3f8d2")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if got := w.Header().Get("X-Echo-Path"); got != "/a3f8d2continued" {
		t.Errorf("path = %q, want passthrough", got)
	}
}

func TestDynamicAPIPath_ValidPrefix_RewritesToCanonical(t *testing.T) {
	h := DynamicAPIPath(true)(echoHandler())
	cases := []struct {
		in   string
		want string
	}{
		{"/a3f8d2", "/api"},
		{"/a3f8d2/", "/api/"},
		{"/a3f8d2/auth/me", "/api/auth/me"},
		{"/a3f8d2/students/abc-123", "/api/students/abc-123"},
		{"/xyz789/auth/me", "/api/auth/me"}, // alphanumeric beyond hex range
	}
	for _, tc := range cases {
		t.Run(tc.in, func(t *testing.T) {
			cookie := tc.in[1:7]
			r := newReq(t, http.MethodGet, tc.in, cookie)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if got := w.Header().Get("X-Echo-Path"); got != tc.want {
				t.Errorf("path = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestDynamicAPIPath_MissingCookie_Forbidden(t *testing.T) {
	h := DynamicAPIPath(true)(echoHandler())
	r := newReq(t, http.MethodGet, "/a3f8d2/students", "")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Result().StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Result().StatusCode)
	}
	if w.Header().Get("X-Echo-Path") != "" {
		t.Error("downstream handler should not have run")
	}
}

func TestDynamicAPIPath_MismatchedCookie_Forbidden(t *testing.T) {
	h := DynamicAPIPath(true)(echoHandler())
	r := newReq(t, http.MethodGet, "/a3f8d2/students", "deadbe")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Result().StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Result().StatusCode)
	}
}

func TestDynamicAPIPath_InvalidCookieValue_Forbidden(t *testing.T) {
	// Cookie value is a 6-alphanumeric-looking string but with uppercase;
	// the IsValidPath check inside ReadAPIPathCookie rejects it, so the
	// middleware should refuse the request.
	h := DynamicAPIPath(true)(echoHandler())
	r := newReq(t, http.MethodGet, "/a3f8d2/students", "A3F8D2")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Result().StatusCode != http.StatusForbidden {
		t.Errorf("status = %d, want 403", w.Result().StatusCode)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/auth/ -run TestDynamicAPIPath -v`
Expected: FAIL — compile error `undefined: DynamicAPIPath`.

- [ ] **Step 3: Write minimal implementation**

Create `internal/auth/apipath_middleware.go` (ported from ppgus; the only adaptation is the gnrs-specific `directAPIAllowlist`):
```go
package auth

import (
	"net/http"
	"strings"

	"github.com/fadhilkurnia/ppg-dashboard/internal/httpx"
)

// canonicalAPIPrefix is the path under which the API is always mounted on
// the chi router. The dynamic-prefix middleware rewrites any matching
// /{6 alphanumeric}/* URL to /api/* before the request reaches chi routing.
const canonicalAPIPrefix = "/api"

// directAPIAllowlist is the set of /api paths that remain reachable at the
// canonical prefix even when the dynamic-path feature is on. These are the
// endpoints a client must hit before (or without) a per-session prefix:
//   - login/logout bootstrap (the SPA has no prefix yet, or is tearing one down)
//   - public self-service endpoints (no session at all)
//   - photo <img> URLs, which the browser issues as plain GETs that cannot
//     carry the rotating prefix.
// Everything else under /api must come through the dynamic prefix and the
// matching auth_path cookie.
var directAPIAllowlist = []string{
	"/api/auth/login",
	"/api/auth/logout",
	"/api/files/photos/",
	"/api/public/",
}

func isDirectAPIAllowed(p string) bool {
	for _, a := range directAPIAllowlist {
		if p == a || strings.HasPrefix(p, a) {
			return true
		}
	}
	return false
}

// DynamicAPIPath returns a middleware that gates /api/* behind a
// per-session prefix. Two-part behaviour:
//
//  1. Direct /api/<rest> requests are refused unless <rest> matches the
//     small allowlist (login/logout + public + photo files), so the API can
//     only be reached via the dynamic prefix once a session is established.
//
//  2. /<APIPathLen-alphanumeric>/<rest> URLs are rewritten to /api/<rest>
//     iff the auth_path cookie matches the prefix byte-for-byte. A
//     prefix-shaped first segment without a matching cookie is refused
//     with 403 bad_api_path. A first segment that is not a syntactically
//     valid prefix (no digit, wrong length, etc.) passes through so
//     static assets and SPA routes still load.
//
// If enabled is false the middleware is a no-op, so deployments with the
// feature flag off pay no cost.
func DynamicAPIPath(enabled bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		if !enabled {
			return next
		}
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			p := r.URL.Path

			// 1. Block direct /api/* unless on the bootstrap allowlist.
			if p == canonicalAPIPrefix || strings.HasPrefix(p, canonicalAPIPrefix+"/") {
				if !isDirectAPIAllowed(p) {
					httpx.Error(w, http.StatusForbidden, "api_path_required",
						"Akses langsung ke /api tidak diizinkan; gunakan jalur dinamis")
					return
				}
				next.ServeHTTP(w, r)
				return
			}

			// 2. Rewrite dynamic prefix to canonical /api if it matches
			//    the cookie; otherwise pass through (static asset, SPA
			//    route) or 403 on prefix-shaped-but-mismatched.
			if len(p) < 1+APIPathLen || p[0] != '/' {
				next.ServeHTTP(w, r)
				return
			}
			prefix := p[1 : 1+APIPathLen]
			if !IsValidPath(prefix) {
				next.ServeHTTP(w, r)
				return
			}
			rest := p[1+APIPathLen:]
			if rest != "" && !strings.HasPrefix(rest, "/") {
				next.ServeHTTP(w, r)
				return
			}

			cookieVal, ok := ReadAPIPathCookie(r)
			if !ok || !EqualPath(prefix, cookieVal) {
				httpx.Error(w, http.StatusForbidden, "bad_api_path", "Akses tidak diizinkan")
				return
			}

			newPath := canonicalAPIPrefix + rest
			r2 := r.Clone(r.Context())
			r2.URL.Path = newPath
			r2.URL.RawPath = ""
			next.ServeHTTP(w, r2)
		})
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/auth/ -run TestDynamicAPIPath -v`
Expected: PASS (all subtests).

- [ ] **Step 5: Commit**
```bash
git add internal/auth/apipath_middleware.go internal/auth/apipath_middleware_test.go
git commit -m "feat(auth): add dynamic api-path gating middleware"
```

---

### Task 4: Auth handler returns `apiBase` + sets/clears `auth_path` cookie
**Files:**
- Modify: `internal/handler/auth.go:17-25` (Auth struct + NewAuth), `:32-82` (Login), `:84-95` (Logout), `:97-109` (Me)
- Modify: `cmd/server/main.go:193` (`handler.NewAuth(...)` call — signature change; update in this commit so the package compiles)
- Test: `internal/handler/auth_test.go` (Create)

- [ ] **Step 1: Write the failing test**

Create `internal/handler/auth_test.go`. The harness opens a temp SQLite DB, migrates, seeds one admin via `store.SeedAdmin`, and drives `Login`/`Logout` through `httptest`. It asserts the JSON body carries `apiBase` and that `Login` sets a valid `auth_path` cookie when the gate is on:
```go
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./internal/handler/ -run 'TestLogin_|TestLogout_' -v`
Expected: FAIL — compile error `too many arguments in call to NewAuth` (current `NewAuth` takes 3 args, the test passes 4).

- [ ] **Step 3: Write minimal implementation**

In `internal/handler/auth.go`, add the canonical-base const and import `auth`/`model` (the file already imports `auth` and `store`; add `model` only if not present — it is **not** currently imported, so add it). Replace the struct + constructor (lines 17-25):
```go
// defaultAPIBase is the canonical API prefix the SPA falls back to when no
// dynamic path is in effect.
const defaultAPIBase = "/api"

type Auth struct {
	users          *store.Users
	jwt            *auth.JWT
	cookieSecure   bool
	dynamicAPIPath bool
}

func NewAuth(users *store.Users, jwtSvc *auth.JWT, cookieSecure, dynamicAPIPath bool) *Auth {
	return &Auth{
		users:          users,
		jwt:            jwtSvc,
		cookieSecure:   cookieSecure,
		dynamicAPIPath: dynamicAPIPath,
	}
}

// authResponse extends the public user shape with the resolved API base for
// the current session. apiBase is always populated so callers do not have to
// special-case the dynamic-disabled deployment.
type authResponse struct {
	*model.User
	APIBase string `json:"apiBase"`
}
```

Add the `model` import to the import block:
```go
	"github.com/fadhilkurnia/ppg-dashboard/internal/auth"
	"github.com/fadhilkurnia/ppg-dashboard/internal/httpx"
	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
```

Replace the tail of `Login` — the `tok, err := a.jwt.Issue(...)` block onward (current lines 65-81) — with the JWT issue (unchanged), then dynamic-path generation, then the `authResponse`:
```go
	tok, err := a.jwt.Issue(user.ID, user.Role)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal membuat token")
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    tok,
		Path:     "/",
		HttpOnly: true,
		Secure:   a.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(a.jwt.TTL().Seconds()),
	})

	apiBase := defaultAPIBase
	if a.dynamicAPIPath {
		path, err := auth.GeneratePath()
		if err != nil {
			httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal membuat jalur API")
			return
		}
		auth.SetAPIPathCookie(w, path, a.cookieSecure, int(a.jwt.TTL().Seconds()))
		apiBase = "/" + path
	}

	httpx.JSON(w, http.StatusOK, authResponse{User: user, APIBase: apiBase})
```

In `Logout` (currently lines 84-95), after clearing the `auth` cookie add the api-path clear (do NOT touch any refresh cookie — gnrs has none):
```go
func (a *Auth) Logout(w http.ResponseWriter, _ *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   a.cookieSecure,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   -1,
	})
	auth.ClearAPIPathCookie(w, a.cookieSecure)
	httpx.JSON(w, http.StatusNoContent, nil)
}
```

In `Me` (currently lines 97-109), replace the final `httpx.JSON(w, http.StatusOK, user)` with the `apiBase`-augmented response:
```go
	apiBase := defaultAPIBase
	if a.dynamicAPIPath {
		if p, ok := auth.ReadAPIPathCookie(r); ok {
			apiBase = "/" + p
		}
	}
	httpx.JSON(w, http.StatusOK, authResponse{User: user, APIBase: apiBase})
```

Update the caller in `cmd/server/main.go:193` so the build still compiles (it gets `cfg.DynamicAPIPath`, added in Task 1):
```go
		authH := handler.NewAuth(users, jwtSvc, cfg.CookieSecure, cfg.DynamicAPIPath)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `go test ./internal/handler/ -run 'TestLogin_|TestLogout_' -v && go build ./...`
Expected: PASS (all subtests) and a clean build (`cmd/server` compiles with the new `NewAuth` signature).

- [ ] **Step 5: Commit**
```bash
git add internal/handler/auth.go internal/handler/auth_test.go cmd/server/main.go
git commit -m "feat(auth): return apiBase and manage auth_path cookie on login"
```

---

### Task 5: SPA handler `Config{APIBaseFor}` + `__API_BASE__` substitution (`web/embed.go`)
**Files:**
- Modify: `web/embed.go` (whole file — change `Handler()` → `Handler(Config)`, add per-request `__API_BASE__` substitution + `Cache-Control: no-store`)
- Modify: `cmd/server/main.go:384-390` (`web.Handler()` call + add `apiBaseResolver`)
- Test: `web/embed_test.go` (Create)

- [ ] **Step 1: Write the failing test**

Create `web/embed_test.go`. It serves a request through the handler and asserts the placeholder is substituted with the resolver's output and that `Cache-Control: no-store` is set. Because the embedded `dist/index.html` is what ships, the test must read whatever the bundle contains; to make the assertion deterministic it checks that (a) the served shell no longer contains the literal `__API_BASE__` placeholder, and (b) when a resolver returns a known prefix, that prefix appears in the served HTML's meta tag:
```go
package web

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestHandler_SubstitutesAPIBaseAndNoStore(t *testing.T) {
	h, err := Handler(Config{
		APIBaseFor: func(*http.Request) string { return "/a3f8d2" },
	})
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)

	if w.Result().StatusCode == http.StatusServiceUnavailable {
		t.Skip("SPA bundle not built (dist/index.html missing); run `npm --prefix web/app run build` to exercise this test")
	}
	if cc := w.Header().Get("Cache-Control"); cc != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", cc)
	}
	bodyStr := w.Body.String()
	if strings.Contains(bodyStr, "__API_BASE__") {
		t.Error("served index.html still contains the __API_BASE__ placeholder")
	}
	if !strings.Contains(bodyStr, `content="/a3f8d2"`) {
		t.Errorf("served index.html does not contain the substituted base; body:\n%s", bodyStr)
	}
}

func TestHandler_NilResolverFallsBackToCanonical(t *testing.T) {
	h, err := Handler(Config{})
	if err != nil {
		t.Fatalf("Handler: %v", err)
	}
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Result().StatusCode == http.StatusServiceUnavailable {
		t.Skip("SPA bundle not built (dist/index.html missing)")
	}
	if !strings.Contains(w.Body.String(), `content="/api"`) {
		t.Errorf("nil resolver should substitute /api; body:\n%s", w.Body.String())
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./web/ -run TestHandler_ -v`
Expected: FAIL — compile error `too many arguments in call to Handler` / `undefined: Config` (current `Handler()` takes no args).

- [ ] **Step 3: Write minimal implementation**

Replace the whole `web/embed.go` (preserving gnrs's existing SPA-fallback behaviour — serve `index.html` for any path that isn't a real asset — but adding the `Config`, per-request placeholder substitution, and `no-store`):
```go
package web

import (
	"bytes"
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed all:dist
var distFS embed.FS

// apiBasePlaceholder is the literal token that the SPA's index.html ships
// with so the server can substitute the per-session API base at serve time.
const apiBasePlaceholder = "__API_BASE__"

// Config configures the embedded SPA handler. APIBaseFor is invoked for every
// request that serves index.html and must return the API base the SPA should
// call (e.g. "/api" or "/a3f8d2"). Nil falls back to "/api" so the static SPA
// remains usable when the caller does not opt into the dynamic-path feature.
type Config struct {
	APIBaseFor func(r *http.Request) string
}

// Handler returns an http.Handler that serves the embedded SPA, falling back
// to index.html for any non-asset path so client-side routing works. The
// handler substitutes apiBasePlaceholder in index.html with the value
// returned by cfg.APIBaseFor. If the SPA bundle hasn't been built yet, it
// returns a helpful 503 instead.
func Handler(cfg Config) (http.Handler, error) {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return nil, err
	}

	indexBytes, err := fs.ReadFile(sub, "index.html")
	if err != nil {
		return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(http.StatusServiceUnavailable)
			_, _ = w.Write([]byte("SPA bundle missing. Run `pnpm --dir web/app build` first, or set DEV=1 to skip serving the SPA."))
		}), nil
	}

	resolve := cfg.APIBaseFor
	if resolve == nil {
		resolve = func(*http.Request) string { return "/api" }
	}

	fileServer := http.FileServer(http.FS(sub))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/")
		serveIndex := false
		if path == "" || path == "index.html" {
			serveIndex = true
		} else if _, err := fs.Stat(sub, path); err != nil {
			serveIndex = true
		}

		if serveIndex {
			writeIndex(w, indexBytes, resolve(r))
			return
		}
		fileServer.ServeHTTP(w, r)
	}), nil
}

func writeIndex(w http.ResponseWriter, tpl []byte, apiBase string) {
	rendered := bytes.ReplaceAll(tpl, []byte(apiBasePlaceholder), []byte(apiBase))
	h := w.Header()
	h.Set("Content-Type", "text/html; charset=utf-8")
	// index.html is now per-session, so caches must not share it across users.
	h.Set("Cache-Control", "no-store")
	_, _ = w.Write(rendered)
}
```

Update the caller in `cmd/server/main.go`. Replace `spa, err := web.Handler()` (line 385) with:
```go
		spa, err := web.Handler(web.Config{
			APIBaseFor: apiBaseResolver(cfg.DynamicAPIPath),
		})
```

Add the `apiBaseResolver` helper near `requestLogger` at the bottom of `cmd/server/main.go`:
```go
// apiBaseResolver returns the function the SPA handler uses to compute the
// per-request API base for index.html substitution. When the dynamic-path
// feature is disabled it always reports the canonical /api prefix.
func apiBaseResolver(enabled bool) func(r *http.Request) string {
	if !enabled {
		return func(*http.Request) string { return "/api" }
	}
	return func(r *http.Request) string {
		if p, ok := auth.ReadAPIPathCookie(r); ok {
			return "/" + p
		}
		return "/api"
	}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web/app run build && go test ./web/ -run TestHandler_ -v && go build ./...`
Expected: PASS — the bundle is built so the tests do not skip; `__API_BASE__` is replaced with `/a3f8d2` (and `/api` for the nil resolver), `Cache-Control: no-store` is present, and `cmd/server` compiles with the new `web.Handler(web.Config{...})` call.
(If `npm run build` is impractical in the dev loop, the tests `t.Skip` rather than fail and the substitution is verified instead through the Task 9 Chrome-DevTools flow.)

- [ ] **Step 5: Commit**
```bash
git add web/embed.go cmd/server/main.go
git commit -m "feat(web): inject per-session api base into index.html shell"
```

---

### Task 6: index.html meta tag + wire the gate middleware
**Files:**
- Modify: `web/app/index.html:3-13` (`<head>` — add the `gnrs-api-base` meta)
- Modify: `cmd/server/main.go:186-187` (add `r.Use(auth.DynamicAPIPath(cfg.DynamicAPIPath))` after `requestLogger`)

- [ ] **Step 1: Write the failing test**

No Go unit test asserts the chi middleware registration directly (it is integration-level). The failing signal is the gate's runtime behaviour, verified by the existing `internal/auth` middleware tests (Task 3, already green) plus the Task 9 Chrome-DevTools flow. For this wiring step the verification gate is: `make test` stays green and `make typecheck` stays green (index.html is not type-checked, but the meta must be valid HTML that Vite copies into `dist/`). Proceed to Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `grep -c 'gnrs-api-base' web/app/index.html`
Expected: `0` (the meta tag does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Add the meta tag to `web/app/index.html`'s `<head>` (after the viewport meta on line 5):
```html
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="gnrs-api-base" content="__API_BASE__" />
    <title>GNRS US</title>
```

Register the middleware in `cmd/server/main.go`, immediately after `r.Use(requestLogger)` (line 186):
```go
	r.Use(requestLogger)
	r.Use(auth.DynamicAPIPath(cfg.DynamicAPIPath))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `grep -c 'gnrs-api-base' web/app/index.html && go build ./... && go test ./internal/auth/ ./internal/handler/ ./internal/config/ -count=1`
Expected: prints `1`; build succeeds; all Go tests pass. (The `DynamicAPIPath` middleware now runs before chi routing on every request.)

- [ ] **Step 5: Commit**
```bash
git add web/app/index.html cmd/server/main.go
git commit -m "feat(web): add gnrs-api-base meta and wire api-path middleware"
```

---

### Task 7: Frontend `lib/apiBase.ts` (meta read + get/set/resolve)
**Files:**
- Create: `web/app/src/lib/apiBase.ts`

- [ ] **Step 1: Write the failing test**

gnrs has **no frontend test runner** (no vitest/jest in `web/app/package.json`; scripts are `dev`/`build`/`preview`/`typecheck` only — see `web/app/package.json`). Per `TEST.md`, frontend behaviour is verified through the Chrome-DevTools flow (Task 9), not a unit test. The compile-time gate for this module is `make typecheck`. The "failing test" is therefore: importing `resolveApiPath`/`getApiBase`/`setApiBase` from `@/lib/apiBase` in Task 8 fails to type-check until this module exists. Proceed to Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `ls web/app/src/lib/apiBase.ts 2>&1`
Expected: `No such file or directory` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `web/app/src/lib/apiBase.ts` (ported from ppgus `web/app/src/api/base.ts`; the only adaptation is the gnrs meta name `gnrs-api-base`):
```ts
// Module-level dynamic API base. The server injects a 6-character
// alphanumeric prefix into the <meta name="gnrs-api-base"> tag of index.html
// when the DYNAMIC_API_PATH feature is enabled; otherwise the meta content is
// /api. The login flow may also push a fresh base via setApiBase() without a
// page reload.

const META_NAME = 'gnrs-api-base'
const CANONICAL_BASE = '/api'
const PLACEHOLDER = '__API_BASE__'

function readMetaBase(): string {
  if (typeof document === 'undefined') return CANONICAL_BASE
  const meta = document.querySelector<HTMLMetaElement>(`meta[name="${META_NAME}"]`)
  const raw = meta?.getAttribute('content')?.trim()
  if (!raw || raw === PLACEHOLDER) return CANONICAL_BASE
  return normalize(raw)
}

function normalize(base: string): string {
  if (!base.startsWith('/')) return `/${base}`
  if (base.length > 1 && base.endsWith('/')) return base.slice(0, -1)
  return base
}

let currentBase: string = readMetaBase()

export function getApiBase(): string {
  return currentBase
}

export function setApiBase(base: string): void {
  currentBase = normalize(base)
}

/**
 * Rewrites an absolute API path so it goes through the dynamic prefix.
 *
 * - Paths beginning with `/api/...` or exactly `/api` are mapped onto the
 *   current base (`/api/foo` -> `/a3f8d2/foo` when dynamic; identity when
 *   canonical).
 * - Other paths are returned unchanged so static assets and SPA routes stay
 *   untouched.
 */
export function resolveApiPath(path: string): string {
  if (path === CANONICAL_BASE) return currentBase
  if (path.startsWith(`${CANONICAL_BASE}/`)) {
    return currentBase + path.slice(CANONICAL_BASE.length)
  }
  return path
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web/app run typecheck`
Expected: PASS (no type errors; the new module compiles standalone).

- [ ] **Step 5: Commit**
```bash
git add web/app/src/lib/apiBase.ts
git commit -m "feat(web): add apiBase meta reader and path resolver"
```

---

### Task 8: Retrofit `lib/api.ts` `request()` + `isAuthError`; `auth.tsx`/`api/auth.ts`/`types.ts`
**Files:**
- Modify: `web/app/src/lib/api.ts:34-39` (`request()` URL branch), add `isAuthError` export + `resolveApiPath`/`setApiBase` imports
- Modify: `web/app/src/lib/auth.tsx:73-115` (`fetchMe` 403-as-unauth + `setApiBase` on login/me)
- Modify: `web/app/src/api/auth.ts` (push `setApiBase` on login/me; return `AuthMe`)
- Modify: `web/app/src/api/types.ts:1-17` (add `AuthMe = User & { apiBase: string }`)

- [ ] **Step 1: Write the failing test**

No frontend unit-test runner exists (see Task 7). The compile gate is `make typecheck`; runtime behaviour is the Task 9 Chrome-DevTools flow. The pre-change failing signal is the current short-circuit at `web/app/src/lib/api.ts:37-39`:
```ts
  const url = path.startsWith('http') || path.startsWith('/api')
    ? path
    : `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
```
With the gate ON, this leaves every `/api/...` literal unrewritten, so the browser hits the canonical `/api/...` and gets `403 api_path_required` for all non-allowlisted endpoints right after login. Proceed to Step 3.

- [ ] **Step 2: Run test to verify it fails**

Run: `grep -n "path.startsWith('/api')" web/app/src/lib/api.ts`
Expected: matches line 37 (the broken short-circuit still present).

- [ ] **Step 3: Write minimal implementation**

**`web/app/src/api/types.ts`** — add `AuthMe` after the `User` type (after line 17):
```ts
// AuthMe is the server response shape for /api/auth/login and /api/auth/me.
// It extends User with the API base for the current session (either the
// canonical "/api" or a dynamic per-session prefix like "/a3f8d2").
export type AuthMe = User & {
  apiBase: string
}
```

**`web/app/src/lib/api.ts`** — at the top of the file (after the existing leading comment block, before `const API_BASE`), import the resolver:
```ts
import { resolveApiPath, setApiBase } from './apiBase'
```
Re-export `setApiBase` at the bottom so `lib/auth.tsx`/`api/auth.ts` can import it from the canonical client. Then replace the URL-resolution branch in `request()` (lines 37-39) so ALL non-`http` paths funnel through `resolveApiPath` (bare paths are prefixed with `/api` first so the existing `api.get('/auth/me')` convention keeps working):
```ts
  // Resolve every non-absolute path through the dynamic API base. Bare paths
  // (e.g. "/auth/me") are first prefixed with /api so both calling
  // conventions — apiFetch('/api/...') and api.get('/auth/me') — end up on the
  // active per-session prefix. http(s) URLs are passed through untouched.
  const url = path.startsWith('http')
    ? path
    : resolveApiPath(path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`)
```
Add an `isAuthError` export (place it just after the `ApiError` class definition, around line 30). It mirrors ppgus's `client.ts` semantics: 401, or 403 with code `api_path_required`/`bad_api_path`, mean "session not trusted → bounce to login"; other 403s keep normal semantics:
```ts
// isAuthError reports whether err means "the SPA can't trust the current
// session and should bounce the user to /login." Covers 401 (missing/invalid
// JWT), 403 api_path_required (hit /api/* without a dynamic prefix — no session
// yet), and 403 bad_api_path (auth_path cookie stale). Other 403s (role-gated
// routes) keep their normal error semantics.
export function isAuthError(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  if (err.status === 401) return true
  if (err.status === 403 && (err.code === 'api_path_required' || err.code === 'bad_api_path')) {
    return true
  }
  return false
}
```
Add the `setApiBase` re-export at the very bottom of the file (next to the existing `apiFetch` export):
```ts
export { setApiBase } from './apiBase'
```
Note: `API_BASE` (line 8) and the bare-path fallback it powered are now superseded by `resolveApiPath`; leave the `API_BASE` const in place only if still referenced elsewhere — `grep -n "API_BASE" web/app/src/lib/api.ts` — otherwise delete the now-unused `const API_BASE` line to keep `typecheck`'s `noUnusedLocals` happy.

**`web/app/src/api/auth.ts`** — make `login`/`me` push the server's `apiBase` into shared state, returning `AuthMe`. Replace the top imports + the three functions:
```ts
import { apiFetch, setApiBase } from '@/lib/api'
import type { AuthMe, User } from './types'

// login authenticates the user and pushes the server's apiBase into the
// shared module state so subsequent calls use the dynamic prefix.
export function login(identifier: string, password: string): Promise<AuthMe> {
  return apiFetch<AuthMe>('/api/auth/login', {
    method: 'POST',
    body: { identifier, password },
  }).then((res) => {
    setApiBase(res.apiBase)
    return res
  })
}

export function logout() {
  return apiFetch<void>('/api/auth/logout', { method: 'POST' })
}

// me returns the current user and refreshes the shared apiBase so a reloaded
// SPA recovers the dynamic prefix even when the meta-tag injection was missed.
export function me(): Promise<AuthMe> {
  return apiFetch<AuthMe>('/api/auth/me').then((res) => {
    setApiBase(res.apiBase)
    return res
  })
}
```
(Leave `updateMe`, `setMyPassword`, `uploadMyPhoto`, `deleteMyPhoto` unchanged; they keep returning `User`.)

**`web/app/src/lib/auth.tsx`** — this is the LIVE auth path. Update the imports on line 10 and `fetchMe`/`login` so (a) `fetchMe` treats `isAuthError` (401 + the two 403 codes) as unauthenticated, and (b) login + me push `setApiBase`. Change the import:
```ts
import { api, ApiError, isAuthError, getToken, setToken, setApiBase } from './api'
```
Replace `fetchMe` (lines 73-82) so a stale/absent dynamic prefix during boot resolves to "logged out" instead of throwing, and the recovered base is stored:
```ts
async function fetchMe(): Promise<User | null> {
  try {
    // GNRS backend returns the user augmented with { apiBase }.
    const u = await api.get<User & { apiBase?: string }>('/auth/me')
    if (u?.apiBase) setApiBase(u.apiBase)
    return u ?? null
  } catch (err) {
    if (isAuthError(err)) return null
    throw err
  }
}
```
In `login` (lines 103-115), after resolving the user response, push the base when present (the GNRS backend now returns `apiBase`; the sitrac-v3 `{token,user}` shape stays handled):
```ts
  const login = useCallback(
    async (identifier: string, password: string) => {
      // GNRS backend: POST /api/auth/login → User & { apiBase } (sets httpOnly cookie).
      // sitrac-v3 backend returns { token, user } — handle both shapes.
      const res = await api.post<unknown>('/auth/login', { identifier, password, username: identifier })
      const token = (res as any)?.token as string | undefined
      const userResp = ((res as any)?.user ?? res) as User & { apiBase?: string }
      const apiBase = (res as any)?.apiBase as string | undefined
      if (apiBase) setApiBase(apiBase)
      if (token) setToken(token)
      qc.setQueryData(ME_QUERY_KEY, userResp)
      setUser(userResp)
    },
    [qc],
  )
```
(`ApiError` stays imported/used elsewhere in `auth.tsx`; the old `err instanceof ApiError && err.status === 401` check in `fetchMe` is fully replaced by `isAuthError`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm --prefix web/app run typecheck`
Expected: PASS — no type errors. `request()` now routes both conventions through `resolveApiPath`; `login`/`me` return `AuthMe`; `fetchMe` uses `isAuthError`; `setApiBase` is wired on login/me.

- [ ] **Step 5: Commit**
```bash
git add web/app/src/lib/api.ts web/app/src/lib/auth.tsx web/app/src/api/auth.ts web/app/src/api/types.ts
git commit -m "feat(web): route all api calls through dynamic base, treat 403 as unauth"
```

---

### Task 9: Full verification — Go suite, typecheck, and Chrome-DevTools cutover proof
**Files:**
- Verify only (no production code changes). Photo `<img>` audit target: `web/app/src/pages/KontrolBacaan.tsx:295-296`.

- [ ] **Step 1: Run the full Go test suite + typecheck**

Run: `make test && make typecheck`
Expected: PASS. `make test` runs `go test ./... -count=1` (covers `internal/config`, `internal/auth` apipath + middleware, `internal/handler` auth, `web` embed). `make typecheck` runs `tsc -b --noEmit` over the SPA. Both green.

- [ ] **Step 2: Audit the photo `<img>` — must NOT be rewritten and must stay allowlisted**

Run: `grep -n "files/photos\|/api/files\|resolveApiPath" web/app/src/pages/KontrolBacaan.tsx`
Expected: line 296 still reads `src={`/api/files/${item.photoPath}`}` — a literal string in JSX, **not** routed through `resolveApiPath` (only `request()` in `lib/api.ts` calls `resolveApiPath`; raw `<img src>` strings are untouched). The browser issues this as a plain GET against `/api/files/...` with no rotating prefix; the gate's `directAPIAllowlist` entry `/api/files/photos/` lets `/api/files/photos/<file>` through. **Caveat to log in the PR:** KontrolBacaan builds `/api/files/${item.photoPath}` while the route is `/api/files/photos/{filename}` and the allowlist prefix is `/api/files/photos/` — so the photo only loads (and only stays allowlisted) when `item.photoPath` already carries the `photos/` segment. This is pre-existing behaviour; this feature must not change `<img>` URLs. If photos 403 under the gate, that is the signal `item.photoPath` lacks `photos/` — flag it, do not patch it in this feature.

- [ ] **Step 3: Build the dev container and run the Chrome-DevTools cutover flow**

Per `CLAUDE.md` (*Per-agent local test container*) and `CHROME_DEVTOOLS.md` pre-flight, build the worktree image, run it on a free `18300`–`18999` loopback port with `DYNAMIC_API_PATH` unset (so it defaults ON), then drive Chrome DevTools. There is no frontend test runner, so this is the authoritative frontend verification:
```bash
podman build -t gnrs-dev-ppgus-port-claude:latest .
podman volume create gnrs-data-dev-ppgus-port-claude
podman run -d --name gnrs-dev-ppgus-port-claude \
  --env-file .env -e PORT=8080 \
  -p 127.0.0.1:18337:8080 \
  -v gnrs-data-dev-ppgus-port-claude:/app/data \
  gnrs-dev-ppgus-port-claude:latest
podman logs --tail 50 gnrs-dev-ppgus-port-claude
```
Then via `mcp__chrome-devtools__*` against `http://localhost:18337`:
  1. Load `/login`; `list_network_requests` → the page GET returns `Cache-Control: no-store` and the served HTML's `<meta name="gnrs-api-base">` content is `/api` (no session yet).
  2. Log in. The `POST /api/auth/login` (allowlisted) returns 200 with `apiBase: "/<prefix>"` and a `Set-Cookie: auth_path=<prefix>`.
  3. After redirect to the dashboard, `list_network_requests` → every authed API call goes to `/<prefix>/...` (e.g. `/<prefix>/auth/me`, `/<prefix>/stats/dashboard`) and returns 200 — confirms BOTH conventions (`api.get` live-auth path AND `apiFetch` literals) resolved through the base.
  4. Open Kontrol Bacaan; confirm member photos render (GET `/api/files/photos/...` 200 via the allowlist, NOT rewritten).
  5. Reload the dashboard (full page reload): session persists — `/auth/me` succeeds on the prefix and no bounce to `/login`.
  6. Confirm there is NO `403` on any non-allowlisted `/api/...` call in the network log (a stray 403 means a missed calling convention — the hard-cutover failure mode).
  7. Log out → `POST /api/auth/logout` 200 with `Set-Cookie: auth_path=;Max-Age=0`; subsequent boot resolves to logged-out (`/login`) rather than erroring.
Capture the network panel screenshots/HARs for the PR "Tested via Chrome DevTools" section.
Expected: all 7 checks pass; zero unexpected 403s post-login.

- [ ] **Step 4: (Sanity) confirm flag-off path still works**

Run (recreate the container with the gate disabled): rebuild not needed; just rerun with `-e DYNAMIC_API_PATH=false`:
```bash
podman rm -f gnrs-dev-ppgus-port-claude
podman run -d --name gnrs-dev-ppgus-port-claude \
  --env-file .env -e PORT=8080 -e DYNAMIC_API_PATH=false \
  -p 127.0.0.1:18337:8080 \
  -v gnrs-data-dev-ppgus-port-claude:/app/data \
  gnrs-dev-ppgus-port-claude:latest
```
Then in Chrome DevTools: login + dashboard work with all calls on the canonical `/api/...` (no prefix, no `auth_path` cookie, meta content `/api`).
Expected: full app works on the canonical prefix — proves the flag is a clean toggle and the middleware/resolver are true no-ops when disabled.

- [ ] **Step 5: Commit (docs/PR notes only if any verification artifact is tracked; otherwise no commit)**

This task changes no source. If a verification note file is tracked for the PR, commit it; otherwise record results in the PR body. Do not create a summary/findings file solely for this.
```bash
# Only if a tracked verification artifact was added:
# git add <artifact>
# git commit -m "test(web): record dynamic api-path cutover verification"
```

---

## Build order within this feature

Tasks 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9. Task 4 and Task 5 each change `cmd/server/main.go` and the package must keep compiling at each commit, so apply those `main.go` edits inside the same commit as their task (the plan does this). The `directAPIAllowlist` (Task 3) already includes `/api/public/` and `/api/files/photos/` per the cross-feature contract, so Feature #2's public endpoints and photo `<img>` URLs are reachable regardless of merge order; if Feature #2 has not yet landed, the `/api/public/*` allowlist entries are harmless (they just match no registered route → the `api.NotFound` 404, never a 403).

## Cross-feature contract (must match the sibling plans verbatim)
- Gate `directAPIAllowlist` = `/api/auth/login`, `/api/auth/logout`, `/api/files/photos/`, `/api/public/`.
- Meta tag name = `gnrs-api-base`. Env flag `DYNAMIC_API_PATH` default `true`.
- `web.Handler(web.Config{APIBaseFor func(*http.Request) string})`; placeholder `__API_BASE__`; shell `Cache-Control: no-store`.
- Frontend: `resolveApiPath`/`getApiBase`/`setApiBase` in `web/app/src/lib/apiBase.ts`; `isAuthError` + `setApiBase` re-export in `web/app/src/lib/api.ts`; `AuthMe = User & { apiBase: string }` in `web/app/src/api/types.ts`.
