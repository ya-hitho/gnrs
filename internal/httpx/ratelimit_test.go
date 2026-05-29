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
