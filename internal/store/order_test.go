package store

import "testing"

func TestOrderClause(t *testing.T) {
	cases := []struct {
		name, sort, dir, want string
	}{
		{"default empty", "", "", "ORDER BY name ASC, id ASC"},
		{"name asc", "name", "asc", "ORDER BY name ASC, id ASC"},
		{"name desc", "name", "desc", "ORDER BY name DESC, id ASC"},
		{"created asc", "created_at", "asc", "ORDER BY created_at ASC, id ASC"},
		{"created desc", "created_at", "desc", "ORDER BY created_at DESC, id ASC"},
		{"unknown sort falls back to name", "bogus", "desc", "ORDER BY name DESC, id ASC"},
		{"unknown dir falls back to asc", "created_at", "sideways", "ORDER BY created_at ASC, id ASC"},
		{"uppercase normalized", "NAME", "DESC", "ORDER BY name DESC, id ASC"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := orderClause(c.sort, c.dir); got != c.want {
				t.Errorf("orderClause(%q,%q) = %q, want %q", c.sort, c.dir, got, c.want)
			}
		})
	}
}
