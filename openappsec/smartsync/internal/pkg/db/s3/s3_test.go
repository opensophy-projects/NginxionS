package s3repository

// NginxionS: the local tenant (an agent without a cloud) is the root of the storage, where the agent keeps its files

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"openappsec.io/smartsync-service/models"
)

func TestStoragePath(t *testing.T) {
	cases := map[[2]string]string{
		{"local", "/local/shop/Indicators/Confidence/remote/confidence.data"}: "/shop/Indicators/Confidence/remote/confidence.data",
		{"local", "local/shop/tuning/decisions.data"}:                         "/shop/tuning/decisions.data",
		{"local", "/shop/Indicators/Confidence/window_0_1/n-1/data.data"}:     "/shop/Indicators/Confidence/window_0_1/n-1/data.data",
		{"local", "/localhost/Type/remote/data.data"}:                         "/localhost/Type/remote/data.data",
		{"tenant-1", "/tenant-1/shop/remote/data.data"}:                       "/tenant-1/shop/remote/data.data",
	}
	for in, want := range cases {
		if got := storagePath(in[0], in[1]); got != want {
			t.Errorf("storagePath(%q, %q) = %q, want %q", in[0], in[1], got, want)
		}
	}
}

type fakeStorage struct {
	mu   sync.Mutex
	urls []string
}

func (f *fakeStorage) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	f.urls = append(f.urls, r.Method+" "+r.URL.RequestURI())
	f.mu.Unlock()
	_, _ = io.Copy(io.Discard, r.Body)
	if r.URL.Query().Get("list-type") == "2" {
		_, _ = io.WriteString(w, `<ListBucketResult><Contents><Key>/shop/Indicators/Confidence/window_0_1/n-1/data.data</Key></Contents></ListBucketResult>`)
		return
	}
	_, _ = io.WriteString(w, `{"a":1}`)
}

func TestLocalTenantIsTheRootOfTheStorage(t *testing.T) {
	storage := &fakeStorage{}
	server := httptest.NewServer(storage)
	defer server.Close()
	a := &Adapter{HTTPClient: server.Client(), baseURL: server.URL + "/api"}
	ctx := context.Background()
	id := models.SyncID{TenantID: "local", AssetID: "shop", Type: "Indicators/Confidence", WindowID: "window_0_1"}

	files, err := a.GetFilesList(ctx, id)
	if err != nil || len(files) != 1 || files[0] != "/shop/Indicators/Confidence/window_0_1/n-1/data.data" {
		t.Fatalf("list: %v %v", files, err)
	}
	var out map[string]int
	if _, err := a.GetFile(ctx, "local", files[0], &out); err != nil || out["a"] != 1 {
		t.Fatalf("get: %v %v", out, err)
	}
	if err := a.PostFile(ctx, "local", "/local/shop/Indicators/Confidence/remote/confidence.data", false, out); err != nil {
		t.Fatalf("put: %v", err)
	}
	want := []string{
		"GET /api/?list-type=2&prefix=/shop/Indicators/Confidence/window_0_1/",
		"GET /api/shop/Indicators/Confidence/window_0_1/n-1/data.data",
		"PUT /api/shop/Indicators/Confidence/remote/confidence.data",
	}
	if strings.Join(storage.urls, "\n") != strings.Join(want, "\n") {
		t.Fatalf("requests:\n%s\nwant:\n%s", strings.Join(storage.urls, "\n"), strings.Join(want, "\n"))
	}
}
