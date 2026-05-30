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
//   - auth/me, the session-check + prefix-recovery endpoint: a request bearing
//     a valid JWT but no auth_path cookie (first load after the feature was
//     enabled, or the cookie was evicted) reaches Me, which mints a fresh
//     prefix so the SPA self-heals instead of being bounced to /login. It is
//     still behind the JWT auth middleware, so this is no weaker than login.
//   - public self-service endpoints (no session at all)
//   - photo <img> URLs, which the browser issues as plain GETs that cannot
//     carry the rotating prefix.
//
// Everything else under /api must come through the dynamic prefix and the
// matching auth_path cookie.
//
// Entries ending in "/" match by directory prefix; all others must match
// exactly, so allowlisting "/api/auth/me" does not also expose
// "/api/auth/me/password" or "/api/auth/me/photo".
var directAPIAllowlist = []string{
	"/api/auth/login",
	"/api/auth/logout",
	"/api/auth/me",
	"/api/files/photos/",
	"/api/public/",
}

func isDirectAPIAllowed(p string) bool {
	for _, a := range directAPIAllowlist {
		if strings.HasSuffix(a, "/") {
			if strings.HasPrefix(p, a) {
				return true
			}
		} else if p == a {
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
