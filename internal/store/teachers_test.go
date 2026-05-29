package store

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"

	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
)

func newTeachersDB(t *testing.T) *Teachers {
	t.Helper()
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return NewTeachers(db)
}

func teacherInput(name, daerah string, status model.TeacherStatus) TeacherInput {
	nick := "Nick"
	return TeacherInput{
		Name:     name,
		Nickname: &nick,
		Kelompok: "Pabeta",
		Desa:     "Malili",
		Daerah:   daerah,
		Status:   status,
	}
}

func TestTeachersCRUD(t *testing.T) {
	s := newTeachersDB(t)
	ctx := context.Background()

	created, err := s.Create(ctx, teacherInput("Alice", "Luwu Timur", model.TeacherActive))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.Name != "Alice" || created.Status != model.TeacherActive {
		t.Fatalf("unexpected created: %+v", created)
	}

	got, err := s.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Daerah != "Luwu Timur" {
		t.Errorf("Daerah = %q, want Luwu Timur", got.Daerah)
	}

	retired := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	in := teacherInput("Alice Renamed", "Luwu Timur", model.TeacherRetired)
	in.RetiredAt = &retired
	updated, err := s.Update(ctx, created.ID, in)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Alice Renamed" || updated.Status != model.TeacherRetired {
		t.Errorf("after update: %+v", updated)
	}
	if updated.RetiredAt == nil || !updated.RetiredAt.Equal(retired) {
		t.Errorf("RetiredAt = %v, want %v", updated.RetiredAt, retired)
	}

	if err := s.Delete(ctx, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.Get(ctx, created.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get after delete: err = %v, want ErrNotFound", err)
	}
}

func TestTeachersListFilters(t *testing.T) {
	s := newTeachersDB(t)
	ctx := context.Background()

	for _, in := range []TeacherInput{
		teacherInput("Alice", "Medan Timur", model.TeacherActive),
		teacherInput("Bob", "Luwu Timur", model.TeacherActive),
		teacherInput("Charlie", "Luwu Timur", model.TeacherRetired),
		teacherInput("David", "Medan Timur", model.TeacherRetired),
	} {
		if _, err := s.Create(ctx, in); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	res, err := s.List(ctx, TeacherListParams{})
	if err != nil {
		t.Fatalf("list all: %v", err)
	}
	if res.Total != 4 {
		t.Errorf("total = %d, want 4", res.Total)
	}

	res, _ = s.List(ctx, TeacherListParams{Status: "active"})
	if res.Total != 2 {
		t.Errorf("active total = %d, want 2", res.Total)
	}

	res, _ = s.List(ctx, TeacherListParams{Daerah: "Luwu Timur"})
	if res.Total != 2 {
		t.Errorf("daerah total = %d, want 2", res.Total)
	}

	res, _ = s.List(ctx, TeacherListParams{Daerah: "Medan Timur", Status: "retired"})
	if res.Total != 1 || res.Items[0].Name != "David" {
		t.Errorf("compound filter result: %+v", res)
	}

	res, _ = s.List(ctx, TeacherListParams{Query: "li"})
	// matches Alice and Charlie via name; nicknames are all "Nick" so no extra matches.
	if res.Total != 2 {
		t.Errorf("query total = %d, want 2 (Alice, Charlie)", res.Total)
	}
}

func TestTeachersListGenderAndSort(t *testing.T) {
	s := newTeachersDB(t)
	ctx := context.Background()

	male := "male"
	female := "female"

	// One male (Bob), one female (Alice), one with NULL gender (Zed).
	bob := teacherInput("Bob", "Luwu Timur", model.TeacherActive)
	bob.Gender = &male
	alice := teacherInput("Alice", "Luwu Timur", model.TeacherActive)
	alice.Gender = &female
	zed := teacherInput("Zed", "Luwu Timur", model.TeacherActive)
	zed.Gender = nil // NULL gender
	for _, in := range []TeacherInput{bob, alice, zed} {
		if _, err := s.Create(ctx, in); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	// Gender filter excludes the NULL-gender row.
	res, err := s.List(ctx, TeacherListParams{Gender: "male"})
	if err != nil {
		t.Fatalf("list male: %v", err)
	}
	if res.Total != 1 || res.Items[0].Name != "Bob" {
		t.Errorf("male filter = %+v, want only Bob", res)
	}

	res, _ = s.List(ctx, TeacherListParams{Gender: "female"})
	if res.Total != 1 || res.Items[0].Name != "Alice" {
		t.Errorf("female filter = %+v, want only Alice", res)
	}

	// No gender filter: all three (incl. NULL) returned.
	res, _ = s.List(ctx, TeacherListParams{})
	if res.Total != 3 {
		t.Errorf("unfiltered total = %d, want 3 (incl NULL gender)", res.Total)
	}

	// Sort name DESC -> Zed first, Alice last.
	res, _ = s.List(ctx, TeacherListParams{Sort: "name", Dir: "desc"})
	if res.Items[0].Name != "Zed" || res.Items[2].Name != "Alice" {
		t.Errorf("name desc = [%s ... %s], want [Zed ... Alice]", res.Items[0].Name, res.Items[2].Name)
	}

	// Bad sort falls back to name ASC -> Alice first.
	res, _ = s.List(ctx, TeacherListParams{Sort: "nope"})
	if res.Items[0].Name != "Alice" {
		t.Errorf("fallback first = %q, want Alice", res.Items[0].Name)
	}
}
