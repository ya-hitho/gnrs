package store

import (
	"path/filepath"
	"testing"
)

func TestMigrate041SubmittedPhoneColumn(t *testing.T) {
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM pragma_table_info('attendances') WHERE name = 'submitted_phone'`,
	).Scan(&count); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if count != 1 {
		t.Fatalf("submitted_phone column count = %d, want 1", count)
	}
}
