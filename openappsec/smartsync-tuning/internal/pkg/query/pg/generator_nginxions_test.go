// NginxionS: the SQL of the tuning service (statistics of the learning page, the log of the agent, its table)
package pg

import (
	"database/sql/driver"
	"errors"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	"github.com/lib/pq"
	oerrors "openappsec.io/errors"
	"openappsec.io/smartsync-tuning/models"
)

type conf map[string]string

func (c conf) GetString(key string) (string, error) {
	if v, ok := c[key]; ok {
		return v, nil
	}
	return "", errors.New("no " + key)
}

func schemaPath() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "../../../../configs/tableSchema.json")
}

func newGen(t *testing.T) *QueriesGen {
	t.Helper()
	qg, err := NewQueriesGen(conf{confKeySchemaPath: schemaPath()})
	if err != nil {
		t.Fatalf("NewQueriesGen: %v", err)
	}
	return qg
}

func TestNewQueriesGenErrors(t *testing.T) {
	if _, err := NewQueriesGen(conf{}); err == nil {
		t.Error("no schema path")
	}
	if _, err := NewQueriesGen(conf{confKeySchemaPath: "/nonexistent/schema.json"}); err == nil {
		t.Error("a missing schema file")
	}
	bad := filepath.Join(t.TempDir(), "bad.json")
	if err := writeFile(bad, "not json"); err != nil {
		t.Fatal(err)
	}
	if _, err := NewQueriesGen(conf{confKeySchemaPath: bad}); err == nil {
		t.Error("a schema that is not JSON")
	}
}

func TestStatisticsQueries(t *testing.T) {
	qg := newGen(t)
	if len(qg.fieldsSet) == 0 {
		t.Fatal("no field of the schema")
	}
	queries := map[string]string{
		"total":      qg.GetTotalRequests("t"),
		"general":    qg.GetGeneralStatsQuery("t"),
		"elapsed":    qg.GetElapsedTime("t"),
		"severity":   qg.GetSeverityStatsQuery("t"),
		"parameter":  qg.GetTuneParameterQuery("matchedparameter", 3, "t"),
		"url":        qg.GetTuneURLQueryFormat(3, "t"),
		"exceptions": qg.GetExceptionsQuery("t"),
		"params":     qg.GetParamsForCollapsingFormat("t"),
		"urls":       qg.GetUrlsForCollapsingFormat("t"),
		"requests":   qg.GetNumOfRequests("t"),
	}
	for name, q := range queries {
		if !strings.Contains(strings.ToLower(q), "select") || !strings.Contains(q, "appsec") {
			t.Errorf("%s: %s", name, q)
		}
		if strings.Count(q, "(") != strings.Count(q, ")") {
			t.Errorf("%s: unbalanced parentheses: %s", name, q)
		}
	}
	if !strings.Contains(count("a", "b"), "b") {
		t.Errorf("count: %s", count("a", "b"))
	}
}

func TestInsertOfAnAgentLog(t *testing.T) {
	qg := newGen(t)
	index := 3
	msg := &models.AgentMessage{
		TenantID: "local",
		Log: &models.LogMsg{
			EventTime:     "2026-11-18T10:00:00.000",
			EventName:     "Web Request",
			EventSeverity: "Critical",
			EventTags:     []string{"waf"},
			EventData:     models.EventData{LogIndex: &index, SecurityAction: "Prevent"},
		},
	}
	stmt, vals, err := qg.Insert(msg)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(stmt, "INSERT INTO appsec (") || len(vals) == 0 {
		t.Fatalf("insert: %s %v", stmt, vals)
	}
	if strings.Count(stmt, "$") != len(vals) {
		t.Errorf("%d placeholders for %d values: %s", strings.Count(stmt, "$"), len(vals), stmt)
	}
	if genPlaceholders(nil) != "()" || genPlaceholders(make([]driver.Value, 2)) != "($1, $2)" {
		t.Error("placeholders")
	}
}

func TestTableStatements(t *testing.T) {
	qg := newGen(t)
	stmt, err := qg.CreateTable("local")
	if err != nil || !strings.HasPrefix(stmt, "CREATE TABLE appsec (") || !strings.Contains(stmt, "PARTITION BY RANGE(") {
		t.Errorf("CreateTable: %s %v", stmt, err)
	}
	if !strings.HasPrefix(qg.CreateDatabase(), "CREATE DATABASE ") {
		t.Errorf("CreateDatabase: %s", qg.CreateDatabase())
	}
	if idx := qg.CreateIndexes("local"); len(idx) == 0 || !strings.Contains(idx[0], "(assetid, eventtime)") {
		t.Errorf("CreateIndexes: %v", idx)
	}
	if _, err := qg.CreateTablePartition("", "yesterday"); err == nil {
		t.Error("a partition of a time that is not one")
	}
	// a schema without its partitioning field cannot make the table
	if _, err := (&QueriesGen{}).CreateTable("x"); err == nil {
		t.Error("a table without a partitioning field")
	}
}

func TestParseErrorAndScanArray(t *testing.T) {
	qg := &QueriesGen{}
	if qg.ParseError(&pq.Error{Code: "42P01"}) != oerrors.ClassNotFound {
		t.Error("a missing table is not 'not found'")
	}
	if qg.ParseError(&pq.Error{Code: "23514"}) == oerrors.ClassNotFound {
		t.Error("a check violation is 'not found'")
	}
	if qg.ParseError(errors.New("other")) != oerrors.ClassUnknown {
		t.Error("an error of another driver")
	}
	var arr []string
	if err := qg.ScanArray([]byte(`{a,b}`), &arr); err != nil || len(arr) != 2 {
		t.Errorf("ScanArray: %v %v", arr, err)
	}
	if err := qg.ScanArray(42, &arr); err == nil {
		t.Error("a number scanned as an array")
	}
	if NewPQDriver() == nil {
		t.Error("no driver")
	}
}
