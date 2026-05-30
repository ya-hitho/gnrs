package store

import "testing"

func TestRebind(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"none", "SELECT 1", "SELECT 1"},
		{"single", "WHERE id = ?", "WHERE id = $1"},
		{"two", "WHERE a = ? AND b = ?", "WHERE a = $1 AND b = $2"},
		{"values", "VALUES (?, ?, ?)", "VALUES ($1, $2, $3)"},
		{"in-list", "id IN (?, ?, ?)", "id IN ($1, $2, $3)"},
		{
			"qmark in string literal is preserved",
			"WHERE note = 'a?b' AND id = ?",
			"WHERE note = 'a?b' AND id = $1",
		},
		{
			"doubled-quote escape keeps inner qmark literal",
			"SET teks = 'it''s a test? ok', updated = ? WHERE id = ?",
			"SET teks = 'it''s a test? ok', updated = $1 WHERE id = $2",
		},
		{
			"already-dollar placeholders untouched (no qmark)",
			"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			"ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		},
		{
			"mixed literal and placeholders across clauses",
			"INSERT INTO t (a,b) VALUES (?, 'x?y') ON CONFLICT DO NOTHING",
			"INSERT INTO t (a,b) VALUES ($1, 'x?y') ON CONFLICT DO NOTHING",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := rebind(c.in); got != c.want {
				t.Errorf("rebind(%q)\n  got  %q\n  want %q", c.in, got, c.want)
			}
		})
	}
}

func TestPgifySeedStmt(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{
			"INSERT OR IGNORE INTO hadits (id, t) VALUES ('a', 'b');",
			"INSERT INTO hadits (id, t) VALUES ('a', 'b') ON CONFLICT DO NOTHING;",
		},
		{
			// "true"/"false" words inside a quoted value must NOT be touched.
			"INSERT OR IGNORE INTO hadits (id, t) VALUES ('a', 'this is true');",
			"INSERT INTO hadits (id, t) VALUES ('a', 'this is true') ON CONFLICT DO NOTHING;",
		},
		{
			// Non OR-IGNORE statements pass through unchanged.
			"INSERT INTO compact_ajar (id) VALUES ('x');",
			"INSERT INTO compact_ajar (id) VALUES ('x');",
		},
	}
	for _, c := range cases {
		if got := pgifySeedStmt(c.in); got != c.want {
			t.Errorf("pgifySeedStmt(%q)\n  got  %q\n  want %q", c.in, got, c.want)
		}
	}
}
