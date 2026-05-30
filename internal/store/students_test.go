package store

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
)

func newTestDB(t *testing.T) *Students {
	t.Helper()
	db := openTestDB(t)
	return NewStudents(db)
}

func sampleInput(name string) StudentInput {
	level := model.LevelCaberawit
	kelompok := "Chicago"
	parentName := "Bob"
	parentPhone := "+62123"
	dob := time.Date(2015, 6, 1, 0, 0, 0, 0, time.UTC)
	return StudentInput{
		Name:        name,
		DateOfBirth: &dob,
		Gender:      "female",
		Level:       &level,
		Kelompok:    &kelompok,
		Status:      model.StudentActive,
		ParentName:  &parentName,
		ParentPhone: &parentPhone,
	}
}

func TestStudentsCRUD(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	created, err := s.Create(ctx, sampleInput("Alice"))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.ID == "" || created.Name != "Alice" || created.Status != model.StudentActive {
		t.Fatalf("unexpected created: %+v", created)
	}
	if created.Level == nil || *created.Level != model.LevelCaberawit {
		t.Errorf("Level = %v, want Caberawit", created.Level)
	}

	in := sampleInput("Alice Renamed")
	leftAt := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	reason := "Pulang"
	in.Status = model.StudentLeft
	in.LeftAt = &leftAt
	in.LeaveReason = &reason

	updated, err := s.Update(ctx, created.ID, in)
	if err != nil {
		t.Fatalf("update: %v", err)
	}
	if updated.Name != "Alice Renamed" || updated.Status != model.StudentLeft {
		t.Errorf("after update: %+v", updated)
	}
	if updated.LeftAt == nil || !updated.LeftAt.Equal(leftAt) {
		t.Errorf("LeftAt = %v, want %v", updated.LeftAt, leftAt)
	}

	if err := s.Delete(ctx, created.ID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if _, err := s.Get(ctx, created.ID); !errors.Is(err, ErrNotFound) {
		t.Errorf("Get after delete: err = %v, want ErrNotFound", err)
	}
}

func TestStudentsListSearchAndStatus(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	for _, name := range []string{"Charlie", "Bob", "Alice", "Dave"} {
		if _, err := s.Create(ctx, sampleInput(name)); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}

	left := sampleInput("Eve")
	left.Status = model.StudentLeft
	if _, err := s.Create(ctx, left); err != nil {
		t.Fatalf("seed left: %v", err)
	}

	res, err := s.List(ctx, ListParams{Limit: 2})
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if res.Total != 5 {
		t.Errorf("Total = %d, want 5", res.Total)
	}
	if len(res.Items) != 2 {
		t.Fatalf("Items len = %d, want 2", len(res.Items))
	}
	if res.Items[0].Name != "Alice" || res.Items[1].Name != "Bob" {
		t.Errorf("first page = [%s, %s], want [Alice, Bob]", res.Items[0].Name, res.Items[1].Name)
	}

	res, _ = s.List(ctx, ListParams{Status: "active"})
	if res.Total != 4 {
		t.Errorf("active total = %d, want 4", res.Total)
	}

	res, _ = s.List(ctx, ListParams{Query: "li"})
	// Alice and Charlie match.
	if res.Total != 2 {
		t.Errorf("query total = %d, want 2", res.Total)
	}
}

func TestStudentsListGenderAndSort(t *testing.T) {
	s := newTestDB(t)
	ctx := context.Background()

	// Two females (Alice, Bob) and two males (Carol, Dave).
	for _, name := range []string{"Bob", "Alice"} {
		in := sampleInput(name) // sampleInput uses gender "female"
		if _, err := s.Create(ctx, in); err != nil {
			t.Fatalf("seed female: %v", err)
		}
	}
	for _, name := range []string{"Dave", "Carol"} {
		in := sampleInput(name)
		in.Gender = "male"
		if _, err := s.Create(ctx, in); err != nil {
			t.Fatalf("seed male: %v", err)
		}
	}

	res, err := s.List(ctx, ListParams{Gender: "female"})
	if err != nil {
		t.Fatalf("list female: %v", err)
	}
	if res.Total != 2 {
		t.Errorf("female total = %d, want 2", res.Total)
	}
	for _, it := range res.Items {
		if it.Gender != "female" {
			t.Errorf("got gender %q in female filter", it.Gender)
		}
	}

	res, _ = s.List(ctx, ListParams{Gender: "male"})
	if res.Total != 2 {
		t.Errorf("male total = %d, want 2", res.Total)
	}

	// Sort by name DESC -> Dave, Carol, Bob, Alice.
	res, _ = s.List(ctx, ListParams{Sort: "name", Dir: "desc"})
	if got := []string{res.Items[0].Name, res.Items[3].Name}; got[0] != "Dave" || got[1] != "Alice" {
		t.Errorf("name desc order = %v, want first Dave last Alice", got)
	}

	// Bad sort falls back to name ASC -> Alice first.
	res, _ = s.List(ctx, ListParams{Sort: "bogus", Dir: ""})
	if res.Items[0].Name != "Alice" {
		t.Errorf("fallback first = %q, want Alice", res.Items[0].Name)
	}
}

func TestStudentsCheckLevelEnum(t *testing.T) {
	s := newTestDB(t)
	bad := model.StudentLevel("Bogus")
	in := sampleInput("X")
	in.Level = &bad
	if _, err := s.Create(context.Background(), in); err == nil {
		t.Error("expected CHECK constraint failure on bogus level, got nil")
	}
}
