package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

func newPublicHandlerEnv(t *testing.T) (*PublicAttendance, *model.Teacher, *model.Student) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if err := store.Migrate(db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	teachers := store.NewTeachers(db)
	students := store.NewStudents(db)
	attendances := store.NewAttendances(db)

	teacherNick := "MDN"
	teacher, err := teachers.Create(context.Background(), store.TeacherInput{
		Name:     "Yasril",
		Nickname: &teacherNick,
		Kelompok: "TK",
		Desa:     "TD",
		Daerah:   "TDA",
		Status:   model.TeacherActive,
	})
	if err != nil {
		t.Fatalf("create teacher: %v", err)
	}
	studentNick := "BFL"
	level := model.LevelRemaja
	kelompok := "California"
	student, err := students.Create(context.Background(), store.StudentInput{
		Name:     "Abi",
		Nickname: &studentNick,
		Gender:   "male",
		Level:    &level,
		Kelompok: &kelompok,
		Status:   model.StudentActive,
	})
	if err != nil {
		t.Fatalf("create student: %v", err)
	}

	h := NewPublicAttendance(attendances, students, teachers)
	return h, teacher, student
}

func postJSON(t *testing.T, h http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	buf, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/public/attendances", bytes.NewReader(buf))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h(rec, req)
	return rec
}

type publicAttendanceResponseTest struct {
	ID             string  `json:"id"`
	SubmittedPhone *string `json:"submittedPhone"`
	WaMeURL        string  `json:"waMeUrl"`
}

func TestPublicAttendanceCreate_HappyPath(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)

	dur := 75
	body := map[string]any{
		"date":           "2026-04-30",
		"durationMin":    dur,
		"teacherId":      teacher.ID,
		"studentId":      student.ID,
		"status":         "hadir",
		"materi":         "1. brief explanations\n2. Quran makna",
		"submittedPhone": "081234567890",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201; body=%s", rec.Code, rec.Body.String())
	}

	var got publicAttendanceResponseTest
	if err := json.NewDecoder(rec.Body).Decode(&got); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.SubmittedPhone == nil || *got.SubmittedPhone != "6281234567890" {
		t.Errorf("submittedPhone = %v, want 6281234567890", got.SubmittedPhone)
	}
	if !strings.HasPrefix(got.WaMeURL, "https://wa.me/6281234567890?") {
		t.Errorf("waMeUrl = %q, want https://wa.me/6281234567890?…", got.WaMeURL)
	}

	parsed, err := url.Parse(got.WaMeURL)
	if err != nil {
		t.Fatalf("parse waMeUrl: %v", err)
	}
	text := parsed.Query().Get("text")
	for _, want := range []string{
		"*LAPORAN PENGAJIAN PPG*",
		"● *Murid*      : Abi-BFL",
		"● *Tanggal*   : 2026-04-30",
		"● *Guru*        : Yasril-MDN",
		"● *Durasi*     : 01:15",
		"● *Kehadiran*     : HADIR",
		"● *Materi:*",
		"1. brief explanations",
		"الحمدلله جزاكم الله خيرا",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("waMeUrl text missing %q\nfull text:\n%s", want, text)
		}
	}
}

func TestPublicAttendanceCreate_InvalidPhone(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)
	body := map[string]any{
		"date":           "2025-05-01",
		"teacherId":      teacher.ID,
		"studentId":      student.ID,
		"status":         "hadir",
		"submittedPhone": "not-a-phone",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestPublicAttendanceCreate_MissingTeacher(t *testing.T) {
	h, _, student := newPublicHandlerEnv(t)
	body := map[string]any{
		"date":           "2025-05-01",
		"studentId":      student.ID,
		"status":         "hadir",
		"submittedPhone": "081234567890",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}

func TestPublicAttendanceCreate_AlfaRejected(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)
	body := map[string]any{
		"date":           "2025-05-01",
		"teacherId":      teacher.ID,
		"studentId":      student.ID,
		"status":         "alfa",
		"submittedPhone": "081234567890",
	}
	rec := postJSON(t, h.Create, body)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400 (public form excludes alfa)", rec.Code)
	}
}

func TestPublicAttendanceList_OnlyActive(t *testing.T) {
	h, teacher, student := newPublicHandlerEnv(t)

	// Seed a retired teacher + a left student that must NOT appear.
	if _, err := h.teachers.Create(context.Background(), store.TeacherInput{
		Name: "Retired", Kelompok: "K", Desa: "D", Daerah: "DA", Status: model.TeacherRetired,
	}); err != nil {
		t.Fatalf("seed retired teacher: %v", err)
	}
	if _, err := h.students.Create(context.Background(), store.StudentInput{
		Name: "Left", Gender: "female", Status: model.StudentLeft,
	}); err != nil {
		t.Fatalf("seed left student: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/public/teachers", nil)
	rec := httptest.NewRecorder()
	h.ListTeachers(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("teachers: status = %d", rec.Code)
	}
	var tres struct {
		Items []publicOption `json:"items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&tres); err != nil {
		t.Fatalf("decode teachers: %v", err)
	}
	if len(tres.Items) != 1 || tres.Items[0].ID != teacher.ID {
		t.Errorf("teachers items = %+v, want only active id=%s", tres.Items, teacher.ID)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/public/students", nil)
	rec = httptest.NewRecorder()
	h.ListStudents(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("students: status = %d", rec.Code)
	}
	var sres struct {
		Items []publicOption `json:"items"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&sres); err != nil {
		t.Fatalf("decode students: %v", err)
	}
	if len(sres.Items) != 1 || sres.Items[0].ID != student.ID {
		t.Errorf("students items = %+v, want only active id=%s", sres.Items, student.ID)
	}
}
