package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"golang.org/x/crypto/bcrypt"

	"github.com/fadhilkurnia/ppg-dashboard/internal/model"
)

// Students is a thin facade over the users table for the /api/students
// endpoint group. Generus are stored as users with role='murid' since
// migration 008; this facade preserves the existing model.Student / StudentInput
// contract so the frontend Generus pages keep working unchanged.
type Students struct {
	db *sql.DB
}

func NewStudents(db *sql.DB) *Students {
	return &Students{db: db}
}

type StudentInput struct {
	Name        string
	Nickname    *string
	DateOfBirth *time.Time
	Gender      string
	Level       *model.StudentLevel
	Kelompok    *string
	JoinedAt    *time.Time
	LeftAt      *time.Time
	LeaveReason *string
	Status      model.StudentStatus
	ParentName        *string
	ParentTitle       *string
	ParentPhone       *string
	ParentPhoneRegion *string
	ParentEmail       *string
}

type ListParams struct {
	Query    string
	Status   string
	Kelompok string
	Limit    int
	Offset   int
}

type ListResult struct {
	Items []model.Student `json:"items"`
	Total int             `json:"total"`
}

const selectStudentCols = `id, name, nickname, date_of_birth, gender, level, kelompok,
	joined_at, left_at, leave_reason, membership_status,
	parent_name, parent_title, parent_phone, parent_phone_region, parent_email, photo_path, created_at, updated_at`

func (s *Students) Create(ctx context.Context, in StudentInput) (*model.Student, error) {
	if in.Status == "" {
		in.Status = model.StudentActive
	}
	id := ulid.Make().String()
	now := time.Now().UTC()

	hash, err := bcrypt.GenerateFromPassword([]byte("changeme"), bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("hash default password: %w", err)
	}

	_, err = s.db.ExecContext(ctx,
		`INSERT INTO users (
		   id, email, password, name, role, active,
		   nickname, date_of_birth, gender, kelompok,
		   level, parent_name, parent_title, parent_phone, parent_phone_region, parent_email,
		   joined_at, left_at, leave_reason, membership_status,
		   created_at, updated_at
		 ) VALUES (?, ?, ?, ?, 'murid', 1,
		           ?, ?, ?, ?,
		           ?, ?, ?, ?, ?, ?,
		           ?, ?, ?, ?,
		           ?, ?)`,
		id, id+"@stub.gnrs.local", string(hash), in.Name,
		in.Nickname, nullableDate(in.DateOfBirth), in.Gender, in.Kelompok,
		nullableLevel(in.Level), in.ParentName, in.ParentTitle, in.ParentPhone, in.ParentPhoneRegion, in.ParentEmail,
		nullableDate(in.JoinedAt), nullableDate(in.LeftAt), in.LeaveReason, string(in.Status),
		now, now,
	)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func (s *Students) Get(ctx context.Context, id string) (*model.Student, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT `+selectStudentCols+` FROM users WHERE id = ? AND role = 'murid'`, id)
	return scanStudent(row)
}

func (s *Students) Update(ctx context.Context, id string, in StudentInput) (*model.Student, error) {
	if in.Status == "" {
		in.Status = model.StudentActive
	}
	now := time.Now().UTC()
	res, err := s.db.ExecContext(ctx,
		`UPDATE users SET
		   name = ?, nickname = ?, date_of_birth = ?, gender = ?, level = ?, kelompok = ?,
		   joined_at = ?, left_at = ?, leave_reason = ?, membership_status = ?,
		   parent_name = ?, parent_title = ?, parent_phone = ?, parent_phone_region = ?, parent_email = ?, updated_at = ?
		 WHERE id = ? AND role = 'murid'`,
		in.Name, in.Nickname,
		nullableDate(in.DateOfBirth), in.Gender, nullableLevel(in.Level), in.Kelompok,
		nullableDate(in.JoinedAt), nullableDate(in.LeftAt), in.LeaveReason, string(in.Status),
		in.ParentName, in.ParentTitle, in.ParentPhone, in.ParentPhoneRegion, in.ParentEmail,
		now, id,
	)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, id)
}

func (s *Students) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM users WHERE id = ? AND role = 'murid'`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Students) List(ctx context.Context, p ListParams) (*ListResult, error) {
	if p.Limit <= 0 || p.Limit > 200 {
		p.Limit = 50
	}
	if p.Offset < 0 {
		p.Offset = 0
	}

	clauses := []string{"role = 'murid'"}
	var args []any
	if q := strings.TrimSpace(p.Query); q != "" {
		clauses = append(clauses, "(name LIKE ? OR nickname LIKE ?)")
		like := "%" + q + "%"
		args = append(args, like, like)
	}
	if p.Status != "" {
		clauses = append(clauses, "membership_status = ?")
		args = append(args, p.Status)
	}
	if p.Kelompok != "" {
		clauses = append(clauses, "kelompok = ?")
		args = append(args, p.Kelompok)
	}
	where := " WHERE " + strings.Join(clauses, " AND ")

	var total int
	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users`+where, args...).Scan(&total); err != nil {
		return nil, fmt.Errorf("count students: %w", err)
	}

	listArgs := append(append([]any{}, args...), p.Limit, p.Offset)
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+selectStudentCols+` FROM users`+where+` ORDER BY name ASC LIMIT ? OFFSET ?`,
		listArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []model.Student{}
	for rows.Next() {
		st, err := readStudent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, *st)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &ListResult{Items: items, Total: total}, nil
}

type Bucket struct {
	Label string `json:"label"`
	Count int    `json:"count"`
}

type LevelKelompokCell struct {
	Level    string `json:"level"`
	Kelompok string `json:"kelompok"`
	Count    int    `json:"count"`
}

type StudentStats struct {
	Total       int                 `json:"total"`
	ActiveTotal int                 `json:"activeTotal"`
	ByGender    []Bucket            `json:"byGender"`
	ByStatus    []Bucket            `json:"byStatus"`
	ByLevel     []Bucket            `json:"byLevel"`
	ByKelompok  []Bucket            `json:"byKelompok"`
	Matrix      []LevelKelompokCell `json:"matrix"`
}

func (s *Students) Stats(ctx context.Context) (*StudentStats, error) {
	out := &StudentStats{}

	if err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM users WHERE role = 'murid'`).Scan(&out.Total); err != nil {
		return nil, err
	}
	if err := s.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM users WHERE role = 'murid' AND membership_status = 'active'`).Scan(&out.ActiveTotal); err != nil {
		return nil, err
	}

	gender, err := groupCount(ctx, s.db,
		`SELECT COALESCE(gender, ''), COUNT(*) FROM users
		  WHERE role = 'murid' AND membership_status = 'active' GROUP BY gender`)
	if err != nil {
		return nil, err
	}
	out.ByGender = orderedBuckets(gender, []string{"female", "male"})

	status, err := groupCount(ctx, s.db,
		`SELECT membership_status, COUNT(*) FROM users WHERE role = 'murid' GROUP BY membership_status`)
	if err != nil {
		return nil, err
	}
	out.ByStatus = orderedBuckets(status, []string{"active", "left"})

	level, err := groupCount(ctx, s.db,
		`SELECT COALESCE(level, ''), COUNT(*) FROM users
		  WHERE role = 'murid' AND membership_status = 'active' GROUP BY level`)
	if err != nil {
		return nil, err
	}
	out.ByLevel = orderedBuckets(level, []string{
		string(model.LevelCaberawit),
		string(model.LevelPraRemaja),
		string(model.LevelRemaja),
		string(model.LevelPraNikah),
		"",
	})

	kelompok, err := groupCount(ctx, s.db,
		`SELECT COALESCE(kelompok, ''), COUNT(*) FROM users
		  WHERE role = 'murid' AND membership_status = 'active' GROUP BY kelompok`)
	if err != nil {
		return nil, err
	}
	out.ByKelompok = orderedBuckets(kelompok, append(append([]string{}, model.StudentKelompoks...), ""))

	rows, err := s.db.QueryContext(ctx,
		`SELECT COALESCE(level, ''), COALESCE(kelompok, ''), COUNT(*)
		   FROM users
		  WHERE role = 'murid' AND membership_status = 'active'
		  GROUP BY level, kelompok`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var c LevelKelompokCell
		if err := rows.Scan(&c.Level, &c.Kelompok, &c.Count); err != nil {
			return nil, err
		}
		out.Matrix = append(out.Matrix, c)
	}
	return out, rows.Err()
}

func groupCount(ctx context.Context, db *sql.DB, query string) (map[string]int, error) {
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var k string
		var n int
		if err := rows.Scan(&k, &n); err != nil {
			return nil, err
		}
		out[k] = n
	}
	return out, rows.Err()
}

func orderedBuckets(counts map[string]int, order []string) []Bucket {
	out := make([]Bucket, 0, len(order))
	for _, k := range order {
		out = append(out, Bucket{Label: k, Count: counts[k]})
	}
	return out
}

func scanStudent(s scanner) (*model.Student, error) {
	st, err := readStudent(s)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return st, nil
}

func readStudent(s scanner) (*model.Student, error) {
	var st model.Student
	var status string
	var dob, joinedAt, leftAt sql.NullTime
	var level sql.NullString
	var photoPath *string
	if err := s.Scan(
		&st.ID, &st.Name, &st.Nickname, &dob, &st.Gender, &level, &st.Kelompok,
		&joinedAt, &leftAt, &st.LeaveReason, &status,
		&st.ParentName, &st.ParentTitle, &st.ParentPhone, &st.ParentPhoneRegion, &st.ParentEmail,
		&photoPath, &st.CreatedAt, &st.UpdatedAt,
	); err != nil {
		return nil, err
	}
	st.PhotoURL = model.PhotoURL(photoPath)
	st.Status = model.StudentStatus(status)
	if dob.Valid {
		v := dob.Time
		st.DateOfBirth = &v
	}
	if joinedAt.Valid {
		v := joinedAt.Time
		st.JoinedAt = &v
	}
	if leftAt.Valid {
		v := leftAt.Time
		st.LeftAt = &v
	}
	if level.Valid {
		v := model.StudentLevel(level.String)
		st.Level = &v
	}
	return &st, nil
}
