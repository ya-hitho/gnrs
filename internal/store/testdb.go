package store

import (
	"database/sql"
	"fmt"
	"strings"
	"sync/atomic"
)

// OpenIsolated provisions an isolated PostgreSQL schema for a test run: it
// (re)creates `schema`, opens a pool whose search_path is pinned to that
// schema, applies every migration there, and returns the pool together with a
// cleanup func that drops the schema. `dsn` is a standard PostgreSQL URL such
// as $TEST_DATABASE_URL. Per-schema isolation lets independent tests share one
// database without colliding on table names.
func OpenIsolated(dsn, schema string) (*sql.DB, func() error, error) {
	quoted := `"` + strings.ReplaceAll(schema, `"`, `""`) + `"`

	admin, err := Open(dsn)
	if err != nil {
		return nil, nil, fmt.Errorf("open admin connection: %w", err)
	}
	if _, err := admin.Exec(`DROP SCHEMA IF EXISTS ` + quoted + ` CASCADE`); err != nil {
		_ = admin.Close()
		return nil, nil, fmt.Errorf("drop schema: %w", err)
	}
	if _, err := admin.Exec(`CREATE SCHEMA ` + quoted); err != nil {
		_ = admin.Close()
		return nil, nil, fmt.Errorf("create schema: %w", err)
	}
	_ = admin.Close()

	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	db, err := Open(dsn + sep + "search_path=" + schema)
	if err != nil {
		return nil, nil, err
	}
	if err := Migrate(db); err != nil {
		_ = db.Close()
		return nil, nil, fmt.Errorf("migrate: %w", err)
	}

	cleanup := func() error {
		_ = db.Close()
		admin, err := Open(dsn)
		if err != nil {
			return err
		}
		defer admin.Close()
		_, err = admin.Exec(`DROP SCHEMA IF EXISTS ` + quoted + ` CASCADE`)
		return err
	}
	return db, cleanup, nil
}

var schemaSeq atomic.Int64

// UniqueSchemaName derives a unique, lowercase, identifier-safe schema name
// from base (typically a test name).
func UniqueSchemaName(base string) string {
	safe := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '_':
			return r
		case r >= 'A' && r <= 'Z':
			return r + ('a' - 'A')
		default:
			return '_'
		}
	}, base)
	if len(safe) > 40 {
		safe = safe[:40]
	}
	return fmt.Sprintf("test_%s_%d", safe, schemaSeq.Add(1))
}
