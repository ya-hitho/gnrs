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
