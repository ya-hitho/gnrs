package store

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
)

// MateriDiajarkan is one materi that was actually projected/taught during a
// live sesi. Recorded each time the guru picks a materi in the Live Stage
// (append, not replace) so the end-sesi summary can list everything taught.
type MateriDiajarkan struct {
	ID                string  `json:"id"`
	SesiID            string  `json:"sesiId"`
	Kind              string  `json:"kind"`
	MateriAjarID      *string `json:"materiAjarId,omitempty"`
	Ref               *string `json:"ref,omitempty"`
	Label             *string `json:"label,omitempty"`
	NeedsParentReview bool    `json:"needsParentReview"`
	ParentNote        *string `json:"parentNote,omitempty"`
	Completed         bool    `json:"completed"`
	CompletedAt       *string `json:"completedAt,omitempty"`
	TaughtAt          string  `json:"taughtAt"`
	CreatedAt         string  `json:"createdAt"`
	UpdatedAt         string  `json:"updatedAt"`
}

type MateriDiajarkanInput struct {
	Kind         string
	MateriAjarID *string
	Ref          *string
	Label        *string
}

type DiajarkanStore struct {
	db *sql.DB
}

func NewDiajarkan(db *sql.DB) *DiajarkanStore { return &DiajarkanStore{db: db} }

const diajarkanCols = `id, sesi_id, kind, materi_ajar_id, ref, label,
	needs_parent_review, parent_note, completed, completed_at,
	taught_at, created_at, updated_at`

func (s *DiajarkanStore) ListBySesi(ctx context.Context, sesiID string) ([]MateriDiajarkan, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT `+diajarkanCols+` FROM sesi_materi_diajarkan
		 WHERE sesi_id = ? ORDER BY taught_at ASC, created_at ASC`, sesiID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []MateriDiajarkan{}
	for rows.Next() {
		v, err := scanDiajarkan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *v)
	}
	return out, rows.Err()
}

func (s *DiajarkanStore) Create(ctx context.Context, sesiID string, in MateriDiajarkanInput) (*MateriDiajarkan, error) {
	id := ulid.Make().String()
	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO sesi_materi_diajarkan
		   (id, sesi_id, kind, materi_ajar_id, ref, label,
		    needs_parent_review, parent_note, completed, completed_at,
		    taught_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 0, NULL, ?, ?, ?)`,
		id, sesiID, in.Kind, in.MateriAjarID, in.Ref, in.Label, now, now, now,
	)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

func (s *DiajarkanStore) Get(ctx context.Context, id string) (*MateriDiajarkan, error) {
	row := s.db.QueryRowContext(ctx, `SELECT `+diajarkanCols+` FROM sesi_materi_diajarkan WHERE id = ?`, id)
	v, err := scanDiajarkan(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return v, nil
}

// Update applies sparse changes (only non-nil fields). Used by the end-sesi
// summary dialog to toggle needs_parent_review and edit parent_note per row,
// and by the Live Stage to mark a materi completed before switching.
type MateriDiajarkanUpdate struct {
	NeedsParentReview *bool
	ParentNote        *string
	Completed         *bool
}

func (s *DiajarkanStore) Update(ctx context.Context, id string, in MateriDiajarkanUpdate) (*MateriDiajarkan, error) {
	sets := []string{}
	args := []any{}
	if in.NeedsParentReview != nil {
		sets = append(sets, "needs_parent_review = ?")
		v := 0
		if *in.NeedsParentReview {
			v = 1
		}
		args = append(args, v)
	}
	if in.ParentNote != nil {
		sets = append(sets, "parent_note = ?")
		if *in.ParentNote == "" {
			args = append(args, nil)
		} else {
			args = append(args, *in.ParentNote)
		}
	}
	if in.Completed != nil {
		sets = append(sets, "completed = ?")
		v := 0
		if *in.Completed {
			v = 1
		}
		args = append(args, v)
		now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
		sets = append(sets, "completed_at = ?")
		if *in.Completed {
			args = append(args, now)
		} else {
			args = append(args, nil)
		}
	}
	if len(sets) == 0 {
		return s.Get(ctx, id)
	}
	now := time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
	sets = append(sets, "updated_at = ?")
	args = append(args, now, id)
	res, err := s.db.ExecContext(ctx,
		`UPDATE sesi_materi_diajarkan SET `+strings.Join(sets, ", ")+` WHERE id = ?`, args...,
	)
	if err != nil {
		return nil, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, ErrNotFound
	}
	return s.Get(ctx, id)
}

func (s *DiajarkanStore) Delete(ctx context.Context, id string) error {
	res, err := s.db.ExecContext(ctx, `DELETE FROM sesi_materi_diajarkan WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

func scanDiajarkan(s scanner) (*MateriDiajarkan, error) {
	var v MateriDiajarkan
	var review, completed int
	if err := s.Scan(
		&v.ID, &v.SesiID, &v.Kind, &v.MateriAjarID, &v.Ref, &v.Label,
		&review, &v.ParentNote, &completed, &v.CompletedAt,
		&v.TaughtAt, &v.CreatedAt, &v.UpdatedAt,
	); err != nil {
		return nil, err
	}
	v.NeedsParentReview = review != 0
	v.Completed = completed != 0
	return &v, nil
}
