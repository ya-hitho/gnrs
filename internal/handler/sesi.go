package handler

import (
	"context"
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

type Sesi struct {
	s         *store.SesiStore
	kelas     *store.KelasStore
	bacaan    *store.Bacaan
	validator *validator.Validate
}

// NewSesi wires the sesi handler. The kelas + bacaan stores are optional
// dependencies: when both are present, ending a sesi whose libraryKind is
// 'quran' auto-creates bacaan_log rows for each kelas anggota so their
// Kontrol Bacaan progress reflects the pengajian session.
func NewSesi(s *store.SesiStore, kelas *store.KelasStore, bacaan *store.Bacaan) *Sesi {
	return &Sesi{s: s, kelas: kelas, bacaan: bacaan, validator: validator.New()}
}

type sesiBody struct {
	Tanggal       string   `json:"tanggal"      validate:"required,len=10"`
	Mulai         *string  `json:"mulai,omitempty"        validate:"omitempty,len=5"`
	Selesai       *string  `json:"selesai,omitempty"      validate:"omitempty,len=5"`
	Topik         string   `json:"topik"        validate:"required,max=500"`
	Catatan       *string  `json:"catatan,omitempty"`
	Tingkat       *string  `json:"tingkat,omitempty"      validate:"omitempty,max=100"`
	MateriAjarID  *string  `json:"materiAjarId,omitempty"`
	MateriAjarIDs []string `json:"materiAjarIds,omitempty"`
	GuruID        *string  `json:"guruId,omitempty"`
	KelasID       *string  `json:"kelasId,omitempty"`
	LibraryKind   *string  `json:"libraryKind,omitempty"  validate:"omitempty,oneof=kurikulum quran hadits tilawati doa"`
	LibraryAspect *string  `json:"libraryAspect,omitempty" validate:"omitempty,oneof=reciting memorizing review manqul"`
	LibraryRef    *string  `json:"libraryRef,omitempty"   validate:"omitempty,max=500"`
}

func (h *Sesi) parse(r *http.Request) (store.SesiInput, error) {
	var b sesiBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		return store.SesiInput{}, errBadJSON
	}
	if err := h.validator.Struct(b); err != nil {
		return store.SesiInput{}, err
	}
	return store.SesiInput{
		Tanggal:       strings.TrimSpace(b.Tanggal),
		Mulai:         trimPtr(b.Mulai),
		Selesai:       trimPtr(b.Selesai),
		Topik:         strings.TrimSpace(b.Topik),
		Catatan:       trimPtr(b.Catatan),
		Tingkat:       trimPtr(b.Tingkat),
		MateriAjarID:  trimPtr(b.MateriAjarID),
		MateriAjarIDs: b.MateriAjarIDs,
		GuruID:        trimPtr(b.GuruID),
		KelasID:       trimPtr(b.KelasID),
		LibraryKind:   trimPtr(b.LibraryKind),
		LibraryAspect: trimPtr(b.LibraryAspect),
		LibraryRef:    trimPtr(b.LibraryRef),
	}, nil
}

func (h *Sesi) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	list, err := h.s.List(r.Context(), store.SesiListParams{
		From:    strings.TrimSpace(q.Get("from")),
		To:      strings.TrimSpace(q.Get("to")),
		Tingkat: strings.TrimSpace(q.Get("tingkat")),
		GuruID:  strings.TrimSpace(q.Get("guruId")),
		KelasID: strings.TrimSpace(q.Get("kelasId")),
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil daftar sesi")
		return
	}
	httpx.JSON(w, http.StatusOK, list)
}

func (h *Sesi) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	v, err := h.s.Get(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Sesi tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil sesi")
		return
	}
	httpx.JSON(w, http.StatusOK, v)
}

func (h *Sesi) Create(w http.ResponseWriter, r *http.Request) {
	in, err := h.parse(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	var by string
	if c, ok := auth.ClaimsFrom(r.Context()); ok {
		by = c.UserID
	}
	v, err := h.s.Create(r.Context(), in, by)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal menyimpan sesi")
		return
	}
	httpx.JSON(w, http.StatusCreated, v)
}

func (h *Sesi) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	in, err := h.parse(r)
	if err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}
	v, err := h.s.Update(r.Context(), id, in)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Sesi tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal memperbarui sesi")
		return
	}
	httpx.JSON(w, http.StatusOK, v)
}

func (h *Sesi) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if err := h.s.Delete(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Sesi tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal menghapus sesi")
		return
	}
	httpx.JSON(w, http.StatusNoContent, nil)
}

func (h *Sesi) Start(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	v, err := h.s.SetStarted(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Sesi tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal memulai sesi")
		return
	}
	httpx.JSON(w, http.StatusOK, v)
}

func (h *Sesi) End(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	v, err := h.s.SetEnded(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Sesi tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengakhiri sesi")
		return
	}
	// Best-effort: when the ending sesi is a Qur'an pengajian bound to a
	// kelas, drop a bacaan_log entry for each anggota so Kontrol Bacaan
	// reflects what was just covered. Failures are logged-only — we don't
	// fail the end-sesi response.
	h.maybeLogQuranBacaan(r.Context(), v)
	httpx.JSON(w, http.StatusOK, v)
}

// maybeLogQuranBacaan creates bacaan_log rows for kelas anggota when the
// sesi is a Qur'an session. The library_ref format is
//   "<surah>" | "<surah>:<ayat>" | "<surah>:<from>-<to>"
// matching MateriSourcePicker's buildQuranRef.
func (h *Sesi) maybeLogQuranBacaan(ctx context.Context, s *store.Sesi) {
	if h.kelas == nil || h.bacaan == nil {
		return
	}
	if s == nil || s.LibraryKind == nil || *s.LibraryKind != "quran" {
		return
	}
	if s.KelasID == nil || *s.KelasID == "" || s.LibraryRef == nil || *s.LibraryRef == "" {
		return
	}
	surah, from, to, ok := parseQuranRef(*s.LibraryRef)
	if !ok {
		return
	}
	anggota, err := h.kelas.ListAnggota(ctx, *s.KelasID)
	if err != nil || len(anggota) == 0 {
		return
	}
	createdBy := ""
	if s.CreatedBy != nil {
		createdBy = *s.CreatedBy
	}
	for _, a := range anggota {
		_, _ = h.bacaan.Create(ctx, store.BacaanInput{
			UserID:   a.MuridID,
			Source:   "pengajian",
			Tanggal:  s.Tanggal,
			Surah:    surah,
			AyatFrom: from,
			AyatTo:   to,
			SesiID:   &s.ID,
		}, createdBy)
	}
}

func parseQuranRef(ref string) (surah, from, to int, ok bool) {
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return 0, 0, 0, false
	}
	parts := strings.SplitN(ref, ":", 2)
	s, err := strconv.Atoi(strings.TrimSpace(parts[0]))
	if err != nil || s < 1 || s > 114 {
		return 0, 0, 0, false
	}
	if len(parts) == 1 {
		// Whole surah — we don't know the upper bound here; treat as 1..1
		// so progress at least nudges. The frontend usually fills the range.
		return s, 1, 1, true
	}
	right := strings.TrimSpace(parts[1])
	if right == "" {
		return s, 1, 1, true
	}
	if i := strings.IndexByte(right, '-'); i >= 0 {
		a, errA := strconv.Atoi(strings.TrimSpace(right[:i]))
		b, errB := strconv.Atoi(strings.TrimSpace(right[i+1:]))
		if errA != nil || errB != nil || a < 1 || b < a {
			return 0, 0, 0, false
		}
		return s, a, b, true
	}
	a, err := strconv.Atoi(right)
	if err != nil || a < 1 {
		return 0, 0, 0, false
	}
	return s, a, a, true
}
