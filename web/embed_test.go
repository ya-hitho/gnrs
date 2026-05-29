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
