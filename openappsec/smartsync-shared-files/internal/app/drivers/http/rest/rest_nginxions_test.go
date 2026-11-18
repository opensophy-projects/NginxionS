// NginxionS: the REST API of the shared storage as the agent and the tuning service call it
package rest

import (
	"context"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"openappsec.io/health"
	"openappsec.io/smartsync-shared-files/internal/app/sharedfiles"
	"openappsec.io/smartsync-shared-files/internal/pkg/filesdb/filesystem"
)

type config struct{ values map[string]interface{} }

func (c config) SetMany(context.Context, map[string]interface{}) error { return nil }
func (c config) Set(context.Context, string, interface{}) error        { return nil }
func (c config) Get(key string) interface{}                            { return c.values[key] }
func (c config) GetAll() map[string]interface{}                        { return c.values }
func (c config) IsSet(key string) bool                                 { _, ok := c.values[key]; return ok }
func (c config) RegisterHook(string, func(interface{}) error)          {}
func (c config) HealthCheck(context.Context) (string, error)           { return "ok", nil }
func (c config) GetString(key string) (string, error) {
	if v, ok := c.values[key].(string); ok {
		return v, nil
	}
	return "", errors.New("no " + key)
}
func (c config) GetInt(key string) (int, error) {
	if v, ok := c.values[key].(int); ok {
		return v, nil
	}
	return 0, errors.New("no " + key)
}
func (c config) GetBool(key string) (bool, error) { v, _ := c.values[key].(bool); return v, nil }
func (c config) GetDuration(key string) (time.Duration, error) {
	if v, ok := c.values[key].(time.Duration); ok {
		return v, nil
	}
	return 0, errors.New("no " + key)
}

type healthy struct{}

func (healthy) Live() health.LivenessResponse { return health.LivenessResponse{Up: true} }
func (healthy) Ready(context.Context) health.ReadinessResponse {
	return health.ReadinessResponse{Ready: true}
}
func (healthy) AddReadinessChecker(health.Checker) {}

func moduleRoot() string {
	_, file, _, _ := runtime.Caller(0)
	return filepath.Join(filepath.Dir(file), "../../../../..")
}

func newServer(t *testing.T) (*Adapter, http.Handler) {
	t.Helper()
	ctx := context.Background()
	values := map[string]interface{}{
		"filesystem_db.root":      t.TempDir() + "/",
		"filesystem_db.ttl":       time.Hour,
		"server.timeout":          5 * time.Second,
		"server.port":             0,
		"server.alternative_port": 0,
		"errors.filepath":         filepath.Join(moduleRoot(), "configs/error-responses.json"),
		"errors.code":             "1111",
	}
	fs, err := filesystem.NewAdapter(config{values})
	if err != nil {
		t.Fatal(err)
	}
	svc, err := sharedfiles.NewSharedFilesService(fs)
	if err != nil {
		t.Fatal(err)
	}
	a, err := NewHTTPAdapter(ctx, config{values}, healthy{}, svc)
	if err != nil {
		t.Fatalf("NewHTTPAdapter: %v", err)
	}
	return a, a.server.(*http.Server).Handler
}

func call(h http.Handler, method, path, body string, tenant bool) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if tenant {
		r.Header.Set("X-Tenant-Id", "local")
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func TestSharedFilesAPI(t *testing.T) {
	_, h := newServer(t)

	if w := call(h, http.MethodPut, "/api/tenant/asset/remote/data.data", "learned", true); w.Code != http.StatusOK {
		t.Fatalf("PUT: %d %s", w.Code, w.Body)
	}
	w := call(h, http.MethodGet, "/api/tenant/asset/remote/data.data", "", true)
	if w.Code != http.StatusOK || w.Body.String() != "learned" {
		t.Fatalf("GET: %d %q", w.Code, w.Body)
	}
	if w := call(h, http.MethodGet, "/api/tenant/asset/missing", "", true); w.Code != http.StatusNotFound {
		t.Errorf("GET of a missing file: %d", w.Code)
	}

	w = call(h, http.MethodGet, "/api/?prefix=tenant/asset/", "", true)
	if w.Code != http.StatusOK {
		t.Fatalf("list: %d %s", w.Code, w.Body)
	}
	var list struct {
		KeyCount int
		Contents []struct{ Key, LastModified string }
	}
	if err := xml.Unmarshal(w.Body.Bytes(), &list); err != nil {
		t.Fatalf("the list is not XML: %v %s", err, w.Body)
	}
	if list.KeyCount != 1 || list.Contents[0].Key != "tenant/asset/remote/data.data" || list.Contents[0].LastModified == "" {
		t.Errorf("list: %+v", list)
	}

	// outside the storage: refused, nothing read or written
	for _, path := range []string{"/api/..%2Fsecret", "/api/tenant/..%2F..%2Fsecret"} {
		if w := call(h, http.MethodGet, path, "", true); w.Code == http.StatusOK {
			t.Errorf("GET %s: %d", path, w.Code)
		}
		if w := call(h, http.MethodPut, path, "x", true); w.Code == http.StatusOK {
			t.Errorf("PUT %s: %d", path, w.Code)
		}
	}
	if w := call(h, http.MethodGet, "/api/?prefix=../", "", true); w.Code != http.StatusInternalServerError {
		t.Errorf("list outside the storage: %d", w.Code)
	}

	// no tenant: refused (the agent and the tuning service always send one)
	if w := call(h, http.MethodGet, "/api/tenant/asset/remote/data.data", "", false); w.Code == http.StatusOK {
		t.Errorf("a request without X-Tenant-Id: %d", w.Code)
	}
}

func TestHealthAndLifecycle(t *testing.T) {
	a, h := newServer(t)
	for _, path := range []string{"/health/live", "/health/ready"} {
		w := call(h, http.MethodGet, path, "", false)
		body, _ := io.ReadAll(w.Body)
		if w.Code != http.StatusOK {
			t.Errorf("%s: %d %s", path, w.Code, body)
		}
	}
	t.Setenv("SERVER_HOST", "")
	if listenHost() != "" {
		t.Error("SERVER_HOST is not taken")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := a.Stop(ctx); err != nil {
		t.Errorf("Stop of servers never started: %v", err)
	}
}

func TestNewHTTPAdapterNeedsItsConfiguration(t *testing.T) {
	for _, missing := range []string{"server.timeout", "errors.filepath", "errors.code", "server.port", "server.alternative_port"} {
		values := map[string]interface{}{
			"server.timeout":          time.Second,
			"server.port":             0,
			"server.alternative_port": 0,
			"errors.filepath":         filepath.Join(moduleRoot(), "configs/error-responses.json"),
			"errors.code":             "1111",
		}
		delete(values, missing)
		if _, err := NewHTTPAdapter(context.Background(), config{values}, healthy{}, nil); err == nil {
			t.Errorf("no %s: accepted", missing)
		}
	}
}
