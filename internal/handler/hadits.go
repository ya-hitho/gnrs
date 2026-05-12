package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/fadhilkurnia/ppg-dashboard/internal/httpx"
	"github.com/fadhilkurnia/ppg-dashboard/internal/store"
)

type Hadits struct {
	s *store.HaditsStore
}

func NewHadits(s *store.HaditsStore) *Hadits { return &Hadits{s: s} }

type kitabUpdateBody struct {
	JumlahHalaman int `json:"jumlahHalaman"`
}

// UpdateKitab — admin endpoint. Currently only jumlah_halaman is editable
// (the target page count used by the Pencapaian / raport coverage).
func (h *Hadits) UpdateKitab(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	var b kitabUpdateBody
	if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "Format permintaan tidak valid")
		return
	}
	if b.JumlahHalaman < 0 || b.JumlahHalaman > 10000 {
		httpx.Error(w, http.StatusBadRequest, "bad_request", "Jumlah halaman harus 0-10000")
		return
	}
	if err := h.s.UpdateKitabJumlahHalaman(r.Context(), slug, b.JumlahHalaman); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Kitab tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal memperbarui kitab")
		return
	}
	k, _ := h.s.GetKitabBySlug(r.Context(), slug)
	httpx.JSON(w, http.StatusOK, k)
}

func (h *Hadits) ListKitab(w http.ResponseWriter, r *http.Request) {
	scope := strings.TrimSpace(r.URL.Query().Get("scope"))
	list, err := h.s.ListKitab(r.Context(), scope)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil daftar kitab")
		return
	}
	httpx.JSON(w, http.StatusOK, list)
}

func (h *Hadits) GetKitab(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	k, err := h.s.GetKitabBySlug(r.Context(), slug)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Kitab tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil kitab")
		return
	}
	httpx.JSON(w, http.StatusOK, k)
}

func (h *Hadits) ListBab(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	k, err := h.s.GetKitabBySlug(r.Context(), slug)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Kitab tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil kitab")
		return
	}
	list, err := h.s.ListBab(r.Context(), k.ID)
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil daftar bab")
		return
	}
	httpx.JSON(w, http.StatusOK, list)
}

// ListHadits paginates hadits for a kitab (URL slug). Query params: babId,
// q, limit, offset. Response: { items, total, limit, offset }.
func (h *Hadits) ListHadits(w http.ResponseWriter, r *http.Request) {
	slug := chi.URLParam(r, "slug")
	k, err := h.s.GetKitabBySlug(r.Context(), slug)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			httpx.Error(w, http.StatusNotFound, "not_found", "Kitab tidak ditemukan")
			return
		}
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil kitab")
		return
	}
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	items, total, err := h.s.ListHadits(r.Context(), store.HaditsListParams{
		KitabID: k.ID,
		BabID:   strings.TrimSpace(q.Get("babId")),
		Query:   strings.TrimSpace(q.Get("q")),
		Limit:   limit,
		Offset:  offset,
	})
	if err != nil {
		httpx.Error(w, http.StatusInternalServerError, "internal", "Gagal mengambil hadits")
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}
