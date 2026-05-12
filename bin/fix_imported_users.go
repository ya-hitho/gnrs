//go:build ignore

// fix_imported_users.go — backfill required NOT-NULL-in-Go columns for
// every guru + murid user whose email ends with "@stub.gnrs.local" (i.e.
// rows the kehadiran importer auto-created). Without this, /api/students
// and /api/teachers crash because gender/level are scanned into plain
// string fields.
//
// Defaults (user will refine via the UI):
//   gender = 'male'
//   level  = 'Caberawit' (murid only)
//   kelompok/desa = '' (already non-NULL via ALTER defaults; safe re-set)
//   daerah = uppercase suffix after the last '-' in the nickname (guess)
//   joined_at = 2024-01-01
//   membership_status = 'active'
package main

import (
	"database/sql"
	"log"
	"os"
	"strings"

	_ "modernc.org/sqlite"
)

func main() {
	dbPath := os.Getenv("GNRS_DB")
	if dbPath == "" {
		dbPath = "data/app.db"
	}
	db, err := sql.Open("sqlite", dbPath+"?_journal=WAL&_busy_timeout=10000")
	if err != nil {
		log.Fatalf("open: %v", err)
	}
	defer db.Close()

	tx, err := db.Begin()
	if err != nil {
		log.Fatalf("begin: %v", err)
	}
	defer tx.Rollback()

	rows, err := tx.Query(
		`SELECT id, nickname, role FROM users
		 WHERE email LIKE '%@stub.gnrs.local' AND role IN ('guru','murid')`)
	if err != nil {
		log.Fatalf("scan: %v", err)
	}
	type rec struct {
		id, nick, role string
	}
	var users []rec
	for rows.Next() {
		var r rec
		var nick sql.NullString
		if err := rows.Scan(&r.id, &nick, &r.role); err != nil {
			log.Fatalf("scan row: %v", err)
		}
		if nick.Valid {
			r.nick = nick.String
		}
		users = append(users, r)
	}
	rows.Close()
	log.Printf("found %d stub users", len(users))

	guruUpd, err := tx.Prepare(
		`UPDATE users SET gender = COALESCE(gender, 'male'),
		   kelompok = COALESCE(kelompok, ''),
		   desa = COALESCE(desa, ''),
		   daerah = COALESCE(NULLIF(daerah, ''), ?),
		   joined_at = COALESCE(joined_at, '2024-01-01'),
		   membership_status = COALESCE(membership_status, 'active'),
		   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		 WHERE id = ?`)
	if err != nil {
		log.Fatalf("prep guru: %v", err)
	}
	defer guruUpd.Close()

	muridUpd, err := tx.Prepare(
		`UPDATE users SET gender = COALESCE(gender, 'male'),
		   level = COALESCE(level, 'Caberawit'),
		   kelompok = COALESCE(kelompok, ?),
		   joined_at = COALESCE(joined_at, '2024-01-01'),
		   membership_status = COALESCE(membership_status, 'active'),
		   updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
		 WHERE id = ?`)
	if err != nil {
		log.Fatalf("prep murid: %v", err)
	}
	defer muridUpd.Close()

	extractSuffix := func(nick string) string {
		i := strings.LastIndex(nick, "-")
		if i < 0 || i == len(nick)-1 {
			return ""
		}
		return strings.ToUpper(strings.TrimSpace(nick[i+1:]))
	}

	gFix, mFix := 0, 0
	for _, u := range users {
		suffix := extractSuffix(u.nick)
		switch u.role {
		case "guru":
			if _, err := guruUpd.Exec(suffix, u.id); err != nil {
				log.Printf("fix guru %s: %v", u.id, err)
				continue
			}
			gFix++
		case "murid":
			if _, err := muridUpd.Exec(suffix, u.id); err != nil {
				log.Printf("fix murid %s: %v", u.id, err)
				continue
			}
			mFix++
		}
	}
	if err := tx.Commit(); err != nil {
		log.Fatalf("commit: %v", err)
	}
	log.Printf("fixed guru: %d", gFix)
	log.Printf("fixed murid: %d", mFix)
}
