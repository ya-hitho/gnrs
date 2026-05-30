package store

import (
	"context"
	"testing"
	"time"

	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
)

func newAttendanceTestDB(t *testing.T) (*Attendances, *Students, *Teachers) {
	t.Helper()
	db := openTestDB(t)
	return NewAttendances(db), NewStudents(db), NewTeachers(db)
}

func TestAttendanceCreateSubmittedPhoneRoundTrip(t *testing.T) {
	att, students, teachers := newAttendanceTestDB(t)
	ctx := context.Background()

	teacher, err := teachers.Create(ctx, TeacherInput{
		Name: "Yasril", Kelompok: "TK", Desa: "TD", Daerah: "TDA", Status: model.TeacherActive,
	})
	if err != nil {
		t.Fatalf("create teacher: %v", err)
	}
	student, err := students.Create(ctx, StudentInput{
		Name: "Abi", Gender: "male", Kelompok: ptr("Chicago"), Status: model.StudentActive,
	})
	if err != nil {
		t.Fatalf("create student: %v", err)
	}

	phone := "6281234567890"
	created, err := att.Create(ctx, AttendanceInput{
		Date:           time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC),
		TeacherID:      teacher.ID,
		StudentID:      student.ID,
		Status:         model.AttendanceHadir,
		SubmittedPhone: &phone,
	})
	if err != nil {
		t.Fatalf("create attendance: %v", err)
	}
	if created.SubmittedPhone == nil || *created.SubmittedPhone != phone {
		t.Fatalf("created.SubmittedPhone = %v, want %q", created.SubmittedPhone, phone)
	}

	got, err := att.Get(ctx, created.ID)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.SubmittedPhone == nil || *got.SubmittedPhone != phone {
		t.Fatalf("got.SubmittedPhone = %v, want %q", got.SubmittedPhone, phone)
	}
}

func TestAttendanceCreateNilSubmittedPhone(t *testing.T) {
	att, students, teachers := newAttendanceTestDB(t)
	ctx := context.Background()
	teacher, _ := teachers.Create(ctx, TeacherInput{
		Name: "Yasril", Kelompok: "TK", Desa: "TD", Daerah: "TDA", Status: model.TeacherActive,
	})
	student, _ := students.Create(ctx, StudentInput{
		Name: "Abi", Gender: "male", Kelompok: ptr("Chicago"), Status: model.StudentActive,
	})
	created, err := att.Create(ctx, AttendanceInput{
		Date: time.Now(), TeacherID: teacher.ID, StudentID: student.ID, Status: model.AttendanceHadir,
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if created.SubmittedPhone != nil {
		t.Fatalf("SubmittedPhone = %v, want nil", created.SubmittedPhone)
	}
}

func ptr(s string) *string { return &s }
