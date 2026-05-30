package store

import (
	"database/sql"
	"os"
	"testing"
)

// openTestDB returns a migrated, schema-isolated *sql.DB for a test, or skips
// the test when TEST_DATABASE_URL is not configured. Example value:
// postgres://postgres:postgres@localhost:5432/gnrs_test?sslmode=disable
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run PostgreSQL-backed tests")
	}
	db, cleanup, err := OpenIsolated(dsn, UniqueSchemaName(t.Name()))
	if err != nil {
		t.Fatalf("provision test schema: %v", err)
	}
	t.Cleanup(func() { _ = cleanup() })
	return db
}
