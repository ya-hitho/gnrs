package messaging

import "testing"

func TestNormalize(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		{"local-zero", "081234567890", "6281234567890"},
		{"plus62", "+6281234567890", "6281234567890"},
		{"bare62", "6281234567890", "6281234567890"},
		{"spaces-and-dashes", "0812-3456-7890", "6281234567890"},
		{"unrecognized", "12345", ""},
		{"empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := Normalize(c.in); got != c.want {
				t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}
