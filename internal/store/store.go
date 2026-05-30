package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"embed"
	"strconv"
	"strings"
	"sync"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	"github.com/golang-migrate/migrate/v4/source/iofs"
	"github.com/jackc/pgx/v5/stdlib"
)

//go:embed migrations/*.sql
var migrationsFS embed.FS

// driverName is the database/sql driver registered by this package. It wraps
// pgx's stdlib driver with a placeholder rewriter so the existing query
// strings (written with SQLite-style `?` placeholders) keep working against
// PostgreSQL, which uses `$1, $2, …` ordinals.
const driverName = "pgx-rebind"

var registerOnce sync.Once

func register() {
	registerOnce.Do(func() {
		sql.Register(driverName, rebindDriver{base: stdlib.GetDefaultDriver()})
	})
}

// Open dials PostgreSQL at the given DSN (e.g.
// "postgres://user:pass@host:5432/db?sslmode=disable") and returns a ready
// connection pool. The `?` → `$n` rewriting happens transparently inside the
// driver, so callers keep writing `?` placeholders.
func Open(dsn string) (*sql.DB, error) {
	register()
	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, err
	}
	// Unlike SQLite (single writer), PostgreSQL handles concurrent
	// connections, so a small pool is fine and avoids serialising requests.
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return db, nil
}

// Migrate applies every pending up-migration in migrations/ using the
// golang-migrate PostgreSQL driver. It is a no-op when the schema is current.
func Migrate(db *sql.DB) error {
	src, err := iofs.New(migrationsFS, "migrations")
	if err != nil {
		return err
	}
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		return err
	}
	m, err := migrate.NewWithInstance("iofs", src, "postgres", driver)
	if err != nil {
		return err
	}
	if err := m.Up(); err != nil && err != migrate.ErrNoChange {
		return err
	}
	return nil
}

// scanner abstracts *sql.Row and *sql.Rows so we can share scan helpers.
type scanner interface {
	Scan(dest ...any) error
}

// orderClause builds a safe ORDER BY for list endpoints. Only the columns in
// the allowlist may be sorted on; anything else falls back to name. The
// direction is ASC unless an explicit "desc" is given. A trailing "id ASC"
// makes the order deterministic for equal keys / pagination.
func orderClause(sort, dir string) string {
	col := "name"
	switch strings.ToLower(strings.TrimSpace(sort)) {
	case "name":
		col = "name"
	case "created_at":
		col = "created_at"
	}
	direction := "ASC"
	if strings.ToLower(strings.TrimSpace(dir)) == "desc" {
		direction = "DESC"
	}
	return "ORDER BY " + col + " " + direction + ", id ASC"
}

// rebind rewrites SQLite-style `?` placeholders into PostgreSQL `$1, $2, …`
// ordinals, numbered left-to-right (which matches database/sql's positional
// argument order). Question marks inside single-quoted string literals are
// left untouched. Operates on bytes: `'` and `?` are single-byte ASCII and
// never appear inside a UTF-8 multibyte sequence, so this is safe for any
// input including Arabic/Indonesian text.
func rebind(query string) string {
	if !strings.ContainsRune(query, '?') {
		return query
	}
	var b strings.Builder
	b.Grow(len(query) + 8)
	n := 0
	inString := false
	for i := 0; i < len(query); i++ {
		c := query[i]
		switch {
		case c == '\'':
			inString = !inString
			b.WriteByte(c)
		case c == '?' && !inString:
			n++
			b.WriteByte('$')
			b.WriteString(strconv.Itoa(n))
		default:
			b.WriteByte(c)
		}
	}
	return b.String()
}

// --- database/sql driver wrapper ----------------------------------------
//
// The wrapper is intentionally thin: it forwards every call to the underlying
// pgx stdlib connection, rewriting the SQL through rebind() at the three
// places a query string enters the driver (Prepare, QueryContext,
// ExecContext). Everything else (transactions, pinging, named-value checking)
// delegates to pgx so its rich type handling is preserved. Implementing
// Exec/QueryContext (rather than only Prepare) lets no-argument multi-statement
// commands — e.g. a whole migration file — run via pgx's simple protocol.

type rebindDriver struct{ base driver.Driver }

func (d rebindDriver) Open(name string) (driver.Conn, error) {
	c, err := d.base.Open(name)
	if err != nil {
		return nil, err
	}
	return &rebindConn{base: c}, nil
}

type rebindConn struct{ base driver.Conn }

func (c *rebindConn) Prepare(query string) (driver.Stmt, error) {
	return c.base.Prepare(rebind(query))
}

func (c *rebindConn) Close() error { return c.base.Close() }

func (c *rebindConn) Begin() (driver.Tx, error) { //nolint:staticcheck // required by driver.Conn
	return c.base.Begin() //nolint:staticcheck
}

func (c *rebindConn) PrepareContext(ctx context.Context, query string) (driver.Stmt, error) {
	if p, ok := c.base.(driver.ConnPrepareContext); ok {
		return p.PrepareContext(ctx, rebind(query))
	}
	return c.base.Prepare(rebind(query))
}

func (c *rebindConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	if q, ok := c.base.(driver.QueryerContext); ok {
		return q.QueryContext(ctx, rebind(query), args)
	}
	return nil, driver.ErrSkip
}

func (c *rebindConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	if e, ok := c.base.(driver.ExecerContext); ok {
		return e.ExecContext(ctx, rebind(query), args)
	}
	return nil, driver.ErrSkip
}

func (c *rebindConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	if b, ok := c.base.(driver.ConnBeginTx); ok {
		return b.BeginTx(ctx, opts)
	}
	return c.base.Begin() //nolint:staticcheck
}

func (c *rebindConn) Ping(ctx context.Context) error {
	if p, ok := c.base.(driver.Pinger); ok {
		return p.Ping(ctx)
	}
	return nil
}

func (c *rebindConn) ResetSession(ctx context.Context) error {
	if r, ok := c.base.(driver.SessionResetter); ok {
		return r.ResetSession(ctx)
	}
	return nil
}

func (c *rebindConn) IsValid() bool {
	if v, ok := c.base.(driver.Validator); ok {
		return v.IsValid()
	}
	return true
}

func (c *rebindConn) CheckNamedValue(nv *driver.NamedValue) error {
	if cn, ok := c.base.(driver.NamedValueChecker); ok {
		return cn.CheckNamedValue(nv)
	}
	return driver.ErrSkip
}
