package query

// NginxionS: the connections of the adapter (openappsec/smartsync-tuning, "Connection leak in query Adapter"). Each
// operation opened a connection and never closed it, nor its statements and rows: under load the connections piled
// up to max_connections of Postgres until the GC closed them. A fake driver counts what is opened and closed.

import (
	"context"
	"database/sql/driver"
	"io"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lib/pq"
	"openappsec.io/errors"
	"openappsec.io/smartsync-tuning/models"
)

type countingDriver struct {
	opened, closed, stmts, stmtsClosed, rows, rowsClosed atomic.Int64
}

func (d *countingDriver) Open(string) (driver.Conn, error) {
	d.opened.Add(1)
	return &countingConn{d: d}, nil
}

type countingConn struct {
	d      *countingDriver
	closed bool
	bad    bool
}

func (c *countingConn) Prepare(string) (driver.Stmt, error) {
	if c.closed {
		return nil, errors.New("prepare on a closed connection")
	}
	if c.bad {
		return nil, driver.ErrBadConn
	}
	c.d.stmts.Add(1)
	return &countingStmt{c: c}, nil
}

func (c *countingConn) Close() error {
	if c.closed {
		return errors.New("closed twice")
	}
	c.closed = true
	c.d.closed.Add(1)
	return nil
}

func (c *countingConn) Begin() (driver.Tx, error) { return nil, errors.New("no transactions") }
func (c *countingConn) IsValid() bool             { return !c.bad }

type countingStmt struct{ c *countingConn }

func (s *countingStmt) Close() error  { s.c.d.stmtsClosed.Add(1); return nil }
func (s *countingStmt) NumInput() int { return -1 }
func (s *countingStmt) Exec([]driver.Value) (driver.Result, error) {
	return driver.RowsAffected(1), nil
}
func (s *countingStmt) Query([]driver.Value) (driver.Rows, error) {
	s.c.d.rows.Add(1)
	return &countingRows{s: s, left: 2}, nil
}
func (s *countingStmt) QueryContext(context.Context, []driver.NamedValue) (driver.Rows, error) {
	return s.Query(nil)
}

type countingRows struct {
	s    *countingStmt
	left int
}

func (r *countingRows) Columns() []string { return []string{"n"} }
func (r *countingRows) Close() error      { r.s.c.d.rowsClosed.Add(1); return nil }
func (r *countingRows) Next(dest []driver.Value) error {
	if r.left == 0 {
		return io.EOF
	}
	r.left--
	dest[0] = int64(7)
	return nil
}

type fakeGen struct{ GenQueries }

func (fakeGen) GetNumOfRequests(string) string { return "SELECT 7" }
func (fakeGen) Insert(*models.AgentMessage) (string, []driver.Value, error) {
	return "INSERT INTO t VALUES (1)", nil, nil
}
func (fakeGen) CreateIndexes(string) []string                    { return nil }
func (fakeGen) ParseError(error) errors.Class                    { return errors.ClassUnknown }
func (fakeGen) GenerateLogQuery(models.TuneEvent, string) string { return "SELECT 7" }

type noConfig struct{}

func (noConfig) GetString(string) (string, error)          { return "", errors.New("unset") }
func (noConfig) IsSet(string) bool                         { return false }
func (noConfig) GetDuration(string) (time.Duration, error) { return 0, errors.New("unset") }

func newCountingAdapter(d *countingDriver) *Adapter {
	return &Adapter{config: noConfig{}, driver: d, genQuery: fakeGen{}, dbName: "x", tenantsLock: &sync.Mutex{}}
}

func TestAdapterClosesWhatItOpens(t *testing.T) {
	d := &countingDriver{}
	qa := newCountingAdapter(d)
	ctx := context.Background()
	const n = 200
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := qa.InsertLog(ctx, &models.AgentMessage{TenantID: "t"}); err != nil {
				t.Error(err)
			}
			if v, err := qa.GetNumOfRequests(ctx, "t"); err != nil || v != 7 {
				t.Error(v, err)
			}
			if logs, err := qa.GetTuningLogs(ctx, "a", models.TuneEvent{}); err != nil || len(logs.Rows) != 2 {
				t.Error(logs, err)
			}
		}()
	}
	wg.Wait()
	if open := d.opened.Load() - d.closed.Load(); open > maxIdleConns {
		t.Fatalf("%d connections left open after %d operations (opened %d), at most %d idle expected",
			open, 3*n, d.opened.Load(), maxIdleConns)
	}
	if d.opened.Load() >= 3*n {
		t.Fatalf("no connection was reused: %d opened for %d operations", d.opened.Load(), 3*n)
	}
	if d.stmts.Load() != d.stmtsClosed.Load() {
		t.Fatalf("statements: %d prepared, %d closed", d.stmts.Load(), d.stmtsClosed.Load())
	}
	if d.rows.Load() != d.rowsClosed.Load() {
		t.Fatalf("rows: %d opened, %d closed", d.rows.Load(), d.rowsClosed.Load())
	}
	qa.Close()
	if d.opened.Load() != d.closed.Load() {
		t.Fatalf("after Close: %d opened, %d closed", d.opened.Load(), d.closed.Load())
	}
}

func TestAdapterDropsABrokenConnection(t *testing.T) {
	d := &countingDriver{}
	qa := newCountingAdapter(d)
	ctx := context.Background()
	if _, err := qa.GetNumOfRequests(ctx, "t"); err != nil {
		t.Fatal(err)
	}
	// the idle connection broke (the server restarted): it is not handed out again
	for _, c := range qa.idleConns() {
		c.(*countingConn).bad = true
	}
	if _, err := qa.GetNumOfRequests(ctx, "t"); err != nil {
		t.Fatal(err)
	}
	if d.opened.Load() != 2 || d.closed.Load() != 1 {
		t.Fatalf("opened %d, closed %d: the broken connection must be closed and a new one opened",
			d.opened.Load(), d.closed.Load())
	}
}

// On a real Postgres (NGINXIONS_TEST_POSTGRES_DSN, e.g. postgres://u:p@127.0.0.1:5432/db?sslmode=disable): the
// number of sessions stays at the idle pool however many operations ran.
func TestAdapterSessionsOnPostgres(t *testing.T) {
	dsn := os.Getenv("NGINXIONS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("NGINXIONS_TEST_POSTGRES_DSN is not set")
	}
	qa := &Adapter{config: noConfig{}, driver: &pq.Driver{}, genQuery: fakeGen{}, dbName: dsn,
		tenantsLock: &sync.Mutex{}}
	defer qa.Close()
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := qa.GetNumOfRequests(ctx, "t"); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	admin, err := (&pq.Driver{}).Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	count := func(q string) int64 {
		stmt, err := admin.Prepare(q)
		if err != nil {
			t.Fatal(err)
		}
		defer stmt.Close()
		rows, err := stmt.Query(nil) //nolint:staticcheck // the driver API, no database/sql here
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		v := make([]driver.Value, 1)
		if err := rows.Next(v); err != nil {
			t.Fatal(err)
		}
		return v[0].(int64)
	}
	sessions := count("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()")
	if sessions > maxIdleConns {
		t.Fatalf("%d sessions open after 100 queries, at most %d expected", sessions, maxIdleConns)
	}
	// the statements of the pooled connections are closed too
	for i := 0; i < 20; i++ {
		if _, err := qa.GetNumOfRequests(ctx, "t"); err != nil {
			t.Fatal(err)
		}
	}
	logs, err := qa.queryLogsRaw(ctx, "SELECT count(*) FROM pg_prepared_statements")
	if err != nil {
		t.Fatal(err)
	}
	if len(logs.Rows) != 1 || logs.Rows[0][0] != "1" {
		t.Fatalf("prepared statements left on a pooled connection: %v", logs.Rows)
	}
}

func TestPostgresURLEscapesTheCredentials(t *testing.T) {
	got := postgresURL("appsec", "p@ss/w#rd%", "postgres", "5432", "db", "disable")
	if got != "postgres://appsec:p%40ss%2Fw%23rd%25@postgres:5432/db?sslmode=disable" {
		t.Fatal(got)
	}
	if _, err := pq.ParseURL(got); err != nil {
		t.Fatal(err)
	}
	if got := postgresURL("u", "p", "postgres", "5432", "", "require"); got != "postgres://u:p@postgres:5432/?sslmode=require" {
		t.Fatal(got)
	}
}
