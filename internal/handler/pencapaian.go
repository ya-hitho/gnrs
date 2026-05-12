package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/go-playground/validator/v10"

	"github.com/fadhilkurnia/ppg-dashboard/internal/auth"
	"github.com/fadhilkurnia/ppg-dashboard/internal/httpx"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

type Pencapaian struct {
	s         *store.PencapaianStore
	users     *store.Users
	validator *validator.Validate
}

func NewPencapaian(s *store.PencapaianStore, users *store.Users) *Pencapaian {
	return &Pencapaian{s: s, users: users, validator: validator.New()}
}

// canSeeMurid returns true when the caller is allowed to view pencapaian
// for the given murid id. Mirrors the bacaan visibility rules.
func (h *Pencapaian) canSeeMurid(r *http.Request, muridUserID string) bool {
	c, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		return false
	}
	caller, err := h.users.FindByID(r.Context(), c.UserID)
	if err != nil {
		return false
	}
	role := string(caller.Role)
	switch role {
	case "admin", "pengurus", "guru":
		return true
	case "ortu":
		// Match by parent_email.
		m, err := h.users.FindByID(r.Context(), muridUserID)
		if err != nil {
			return false
		}
		return m.ParentEmail != nil &&
			strings.EqualFold(strings.TrimSpace(*m.ParentEmail), strings.TrimSpace(caller.Email))
	case "murid":
		return caller.ID == muridUserID
	default:
		return false
	}
}

func (h *Pencapaian) canEdit(r *http.Request) bool {
	c, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		return false
	}
	switch string(c.Role) {
	case "admin", "pengurus", "guru":
		return true
	}
	return false
}

// List returns one row per materi_ajar in the umur range, with the
// matching pencapaian (if any) joined. Requires `muridUserId`.
func (h *Pencapaian) List(w http.ResponseWriter, r *http.Request) {
	muridID := strings.TrimSpace(r.URL.Query().Get("muridUserId"))
	if muridID == "" {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "muridUserId wajib")
		return
	}
	if !h.canSeeMurid(r, muridID) {
		httpx.Error(w, http.StatusForbidden, "forbidden", "tidak boleh melihat murid ini")
		return
	}
	p := store.PencapaianListParams{MuridUserID: muridID}
	if v := r.URL.Query().Get("fromUmur"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "bad_request", "fromUmur tidak valid")
			return
		}
		p.FromUmur = &n
	}
	if v := r.URL.Query().Get("fromSem"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || (n != 1 && n != 2) {
			httpx.Error(w, http.StatusBadRequest, "bad_request", "fromSem harus 1 atau 2")
			return
		}
		p.FromSem = &n
	}
	if v := r.URL.Query().Get("toUmur"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			httpx.Error(w, http.StatusBadRequest, "bad_request", "toUmur tidak valid")
			return
		}
		p.ToUmur = &n
	}
	if v := r.URL.Query().Get("toSem"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || (n != 1 && n != 2) {
			httpx.Error(w, http.StatusBadRequest, "bad_request", "toSem harus 1 atau 2")
			return
		}
		p.ToSem = &n
	}
	items, err := h.s.ListForMurid(r.Context(), p)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "gagal memuat pencapaian")
		return
	}
	// Flatten for JSON: a list of {materi, umur, pencapaian}.
	type row struct {
		Materi     store.MateriAjar  `json:"materi"`
		Umur       *int              `json:"umur,omitempty"`
		Pencapaian *store.Pencapaian `json:"pencapaian,omitempty"`
	}
	out := make([]row, 0, len(items))
	for _, it := range items {
		out = append(out, row{Materi: it.Materi, Umur: it.Umur, Pencapaian: it.Pencapaian})
	}
	httpx.JSON(w, http.StatusOK, out)
}

type pencapaianUpsertBody struct {
	MuridUserID  string  `json:"muridUserId"  validate:"required"`
	MateriAjarID string  `json:"materiAjarId" validate:"required"`
	Status       string  `json:"status"       validate:"required,oneof=belum proses tuntas"`
	NilaiAngka   *int    `json:"nilaiAngka,omitempty"   validate:"omitempty,gte=0,lte=100"`
	NilaiHuruf   *string `json:"nilaiHuruf,omitempty"   validate:"omitempty,max=4"`
	Tanggal      *string `json:"tanggal,omitempty"`
	Catatan      *string `json:"catatan,omitempty"`
}

func (h *Pencapaian) Upsert(w http.ResponseWriter, r *http.Request) {
	if !h.canEdit(r) {
		httpx.Error(w, http.StatusForbidden, "forbidden", "hanya admin/pengurus/guru")
		return
	}
	var b pencapaianUpsertBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "format salah")
		return
	}
	if err := h.validator.Struct(b); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	c, _ := auth.ClaimsFrom(r.Context())
	row, err := h.s.Upsert(r.Context(), store.PencapaianUpsertInput{
		MuridUserID:  b.MuridUserID,
		MateriAjarID: b.MateriAjarID,
		Status:       b.Status,
		NilaiAngka:   b.NilaiAngka,
		NilaiHuruf:   b.NilaiHuruf,
		Tanggal:      b.Tanggal,
		Catatan:      b.Catatan,
	}, c.UserID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "gagal menyimpan pencapaian")
		return
	}
	httpx.JSON(w, http.StatusOK, row)
}

func (h *Pencapaian) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.canEdit(r) {
		httpx.Error(w, http.StatusForbidden, "forbidden", "hanya admin/pengurus/guru")
		return
	}
	id := chi.URLParam(r, "id")
	if err := h.s.Delete(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "pencapaian tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "gagal menghapus")
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}
