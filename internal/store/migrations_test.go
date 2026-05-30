package store

import (
	"testing"
)

func TestMigrate041SubmittedPhoneColumn(t *testing.T) {
	db := openTestDB(t)
	var count int
	if err := db.QueryRow(
		`SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'attendances' AND column_name = 'submitted_phone'`,
	).Scan(&count); err != nil {
		t.Fatalf("pragma: %v", err)
	}
	if count != 1 {
		t.Fatalf("submitted_phone column count = %d, want 1", count)
	}
}
