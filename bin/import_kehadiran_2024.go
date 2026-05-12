//go:build ignore

// import_kehadiran_2024.go — read excel/Kegiatan Pengajian PPG US 2024.xlsx
// and bulk-insert into the attendances table. Matches murid + guru by
// name/nickname; creates placeholder users when no match exists.
//
// All writes (user-create + attendance inserts) flow through one tx so
// SQLite never sees a second writer.
//
// Run with the path to the live SQLite DB:
//   GNRS_DB=./data/app.db go run bin/import_kehadiran_2024.go
package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"
	"github.com/xuri/excelize/v2"
	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

const (
	defaultInput = "excel/Kegiatan Pengajian PPG US 2024.xlsx"
	mainSheet    = "KEG. PENGAJIAN HARIAN"
)

func main() {
	dbPath := os.Getenv("GNRS_DB")
	if dbPath == "" {
		dbPath = "data/app.db"
	}
	inputPath := os.Getenv("INPUT")
	if inputPath == "" {
		inputPath = defaultInput
	}
	log.Printf("input=%s db=%s", inputPath, dbPath)
	db, err := sql.Open("sqlite", dbPath+"?_journal=WAL&_busy_timeout=10000")
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()
	f, err := excelize.OpenFile(inputPath)
	if err != nil {
		log.Fatalf("open xlsx: %v", err)
	}
	defer f.Close()
	rows, err := f.GetRows(mainSheet)
	if err != nil {
		log.Fatalf("read sheet: %v", err)
	}
	if len(rows) < 2 {
		log.Fatalf("no data rows")
	}
	header := rows[0]
	colIdx := map[string]int{}
	for i, h := range header {
		colIdx[strings.ToUpper(strings.TrimSpace(strings.TrimSuffix(h, ":")))] = i
	}
	get := func(row []string, name string) string {
		i, ok := colIdx[name]
		if !ok || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}

	tx, err := db.Begin()
	if err != nil {
		log.Fatalf("begin tx: %v", err)
	}
	defer tx.Rollback()

	// Seed the user-cache from the live users table — read on the tx so
	// we see a consistent snapshot.
	userCache := map[string]string{}
	if r, err := tx.Query(`SELECT id, COALESCE(nickname, ''), name, role FROM users WHERE role IN ('murid','guru')`); err == nil {
		for r.Next() {
			var id, nick, name, role string
			if err := r.Scan(&id, &nick, &name, &role); err == nil {
				if nick != "" {
					userCache[role+"|"+strings.ToLower(nick)] = id
				}
				if name != "" {
					userCache[role+"|"+strings.ToLower(name)] = id
				}
			}
		}
		r.Close()
	}

	resolveUser := func(label, role string) (string, error) {
		key := role + "|" + strings.ToLower(label)
		if id, ok := userCache[key]; ok {
			return id, nil
		}
		newID := ulid.Make().String()
		slug := strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(label, " ", "-"), "_", "-"))
		email := fmt.Sprintf("%s.%s.%s@stub.gnrs.local", role, slug, strings.ToLower(newID[len(newID)-6:]))
		hash, _ := bcrypt.GenerateFromPassword([]byte("changeme"), bcrypt.DefaultCost)
		now := time.Now().UTC()
		_, err := tx.Exec(
			`INSERT INTO users (id, email, password, name, role, active, nickname,
			   membership_status, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, 1, ?, 'active', ?, ?)`,
			newID, email, string(hash), label, role, label, now, now,
		)
		if err != nil {
			return "", fmt.Errorf("create %s %q: %w", role, label, err)
		}
		userCache[key] = newID
		return newID, nil
	}
	mapStatus := func(s string) string {
		switch strings.ToUpper(strings.TrimSpace(s)) {
		case "HADIR":
			return "hadir"
		case "IZIN (MURID)", "IZIN MURID":
			return "izin_murid"
		case "IZIN (GURU)", "IZIN GURU":
			return "izin_guru"
		case "BY VN":
			return "by_vn"
		}
		return ""
	}
	parseDate := func(s string) (time.Time, bool) {
		s = strings.TrimSpace(s)
		for _, layout := range []string{
			"2006-01-02",
			"01/02/2006",
			"02/01/2006",
			"January 2, 2006",
			"2 January 2006",
			"02-Jan-2006",
			"2006/01/02",
		} {
			if t, err := time.Parse(layout, s); err == nil {
				return t, true
			}
		}
		return time.Time{}, false
	}
	parseDuration := func(s string) (int, bool) {
		s = strings.TrimSpace(s)
		if s == "" {
			return 0, false
		}
		s = strings.ReplaceAll(s, " menit", "")
		s = strings.ReplaceAll(s, "menit", "")
		s = strings.TrimSpace(s)
		if strings.Count(s, ":") >= 1 {
			parts := strings.Split(s, ":")
			h, m := 0, 0
			fmt.Sscanf(parts[0], "%d", &h)
			if len(parts) >= 2 {
				fmt.Sscanf(parts[1], "%d", &m)
			}
			total := h*60 + m
			if total > 0 {
				return total, true
			}
		}
		var n int
		if _, err := fmt.Sscanf(s, "%d", &n); err == nil && n > 0 {
			return n, true
		}
		return 0, false
	}
	inserted := 0
	skipped := 0
	skippedReasons := map[string]int{}
	for i, row := range rows[1:] {
		tgl := get(row, "TANGGAL")
		guru := get(row, "NAMA GURU")
		murid := get(row, "NAMA MURID")
		kehadiran := get(row, "KEHADIRAN")
		materi := get(row, "MATERI")
		if materi == "" {
			materi = get(row, "MATERI:")
		}
		durasi := get(row, "DURASI")
		date, ok := parseDate(tgl)
		if !ok || guru == "" || murid == "" {
			skipped++
			skippedReasons["bad_date_or_empty"]++
			continue
		}
		st := mapStatus(kehadiran)
		if st == "" {
			skipped++
			skippedReasons["bad_status"]++
			continue
		}
		guruID, err := resolveUser(guru, "guru")
		if err != nil {
			if i < 5 {
				log.Printf("row %d: %v", i+2, err)
			}
			skipped++
			skippedReasons["guru_create"]++
			continue
		}
		muridID, err := resolveUser(murid, "murid")
		if err != nil {
			if i < 5 {
				log.Printf("row %d: %v", i+2, err)
			}
			skipped++
			skippedReasons["murid_create"]++
			continue
		}
		var dur any
		if d, ok := parseDuration(durasi); ok {
			dur = d
		}
		var mat any
		if materi != "" {
			mat = materi
		}
		id := ulid.Make().String()
		_, err = tx.Exec(
			`INSERT INTO attendances (id, date, duration_min, teacher_id, student_id, status, materi)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			id, date.UTC().Format("2006-01-02"), dur, guruID, muridID, st, mat,
		)
		if err != nil {
			if i < 5 {
				log.Printf("row %d insert: %v", i+2, err)
			}
			skipped++
			skippedReasons["insert"]++
			continue
		}
		inserted++
	}
	if err := tx.Commit(); err != nil {
		log.Fatalf("commit: %v", err)
	}
	log.Printf("inserted: %d", inserted)
	log.Printf("skipped:  %d", skipped)
	for k, v := range skippedReasons {
		log.Printf("  %s: %d", k, v)
	}
	log.Printf("cached user labels: %d", len(userCache))
}
