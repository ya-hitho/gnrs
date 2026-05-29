// Package messaging holds phone-number helpers for the public /absen flow.
// gnrs does not push to a WhatsApp gateway server-side; the /absen handler
// builds a wa.me click-to-chat URL the SPA navigates to. Normalize canonicalises
// Indonesian phone input to the "62…" form wa.me expects.
package messaging

import "strings"

// Normalize coerces Indonesian phone input to the "62…" form wa.me expects.
// Accepts "+62…", "62…", and "0…". Strips spaces/dashes. Returns "" for input
// it can't recognise so callers can fall back instead of building a broken URL.
func Normalize(in string) string {
	s := strings.Map(func(r rune) rune {
		switch {
		case r >= '0' && r <= '9':
			return r
		case r == '+':
			return r
		}
		return -1
	}, in)
	s = strings.TrimSpace(s)
	switch {
	case strings.HasPrefix(s, "+62"):
		return s[1:]
	case strings.HasPrefix(s, "62"):
		return s
	case strings.HasPrefix(s, "0"):
		return "62" + s[1:]
	}
	return ""
}
