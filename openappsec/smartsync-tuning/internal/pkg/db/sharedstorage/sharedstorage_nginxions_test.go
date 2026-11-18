// NginxionS: the tuning service keeps the attributes of an asset in the shared storage of the agent; a fake storage
// that answers like the real one (smartsync-shared-files: PUT, GET, the XML list, DELETE, 400 without a tenant)
package sharedstorage

import (
	"context"
	"encoding/xml"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"

	"openappsec.io/smartsync-tuning/models"
)

type store struct {
	mu      sync.Mutex
	files   map[string][]byte
	tenants map[string]bool
}

func (s *store) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	tenant := r.Header.Get("X-Tenant-Id")
	if tenant == "" {
		http.Error(w, "Please add header X-Tenant-Id", http.StatusBadRequest)
		return
	}
	s.tenants[tenant] = true
	path := strings.TrimPrefix(r.URL.Path, "/api/")
	switch {
	case r.Method == http.MethodGet && path == "":
		prefix := r.URL.Query().Get("prefix")
		type content struct{ Key string }
		var list struct {
			XMLName  xml.Name `xml:"ListBucketResult"`
			KeyCount int
			Contents []content
		}
		keys := []string{}
		for k := range s.files {
			if strings.HasPrefix(k, prefix) {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		for _, k := range keys {
			list.Contents = append(list.Contents, content{Key: k})
		}
		list.KeyCount = len(keys)
		out, _ := xml.Marshal(list)
		_, _ = w.Write(out)
	case r.Method == http.MethodGet:
		data, ok := s.files[path]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		_, _ = w.Write(data)
	case r.Method == http.MethodPut:
		data, _ := io.ReadAll(r.Body)
		s.files[path] = data
	case r.Method == http.MethodDelete:
		delete(s.files, path)
	}
}

type conf struct {
	host string
	err  error
}

func (c conf) GetString(string) (string, error) { return c.host, c.err }

func newStore(t *testing.T) (*store, *Adapter) {
	t.Helper()
	s := &store{files: map[string][]byte{}, tenants: map[string]bool{}}
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	a, err := NewAdapter(conf{host: strings.TrimPrefix(srv.URL, "http://")})
	if err != nil {
		t.Fatal(err)
	}
	return s, a
}

func TestNewAdapterNeedsTheHost(t *testing.T) {
	if _, err := NewAdapter(conf{err: errors.New("no host")}); err == nil {
		t.Error("an adapter without the host of the storage")
	}
}

func TestAttributesRoundTrip(t *testing.T) {
	s, a := newStore(t)
	ctx := context.Background()

	// nothing stored yet: not found
	var attr models.Attributes
	if err := a.GetAssetData(ctx, models.ReportAll, "", "asset-1", &attr); err == nil {
		t.Fatal("an asset that was never reported")
	}

	stats := models.Statistics{Status: "Learning", TotalRequests: 12000, UniqueSources: 40}
	events := []models.TuneEvent{{ID: "e1", Decision: "benign", EventType: "url", EventTitle: "/login", Severity: "high"}}
	for typ, data := range map[models.ReportedAssetType]interface{}{
		models.ReportStatistics:    stats,
		models.ReportTuning:        events,
		models.ReportTuningDecided: events,
	} {
		// an empty tenant: the storage refuses a request without one, the adapter sends a name of its own
		if err := a.ReportAsset(ctx, typ, "", "asset-1", data); err != nil {
			t.Fatalf("ReportAsset(%s): %v", typ, err)
		}
	}
	if !s.tenants["tenant"] {
		t.Errorf("tenants seen by the storage: %v", s.tenants)
	}

	var gotStats models.Statistics
	if err := a.GetAssetData(ctx, models.ReportStatistics, "local", "asset-1", &gotStats); err != nil ||
		gotStats.TotalRequests != 12000 || gotStats.Status != "Learning" {
		t.Errorf("statistics: %+v %v", gotStats, err)
	}
	for _, typ := range []models.ReportedAssetType{models.ReportTuning, models.ReportTuningDecided} {
		var got []models.TuneEvent
		if err := a.GetAssetData(ctx, typ, "local", "asset-1", &got); err != nil || len(got) != 1 || got[0].ID != "e1" {
			t.Errorf("%s: %+v %v", typ, got, err)
		}
	}
	var any interface{}
	if err := a.GetAssetData(ctx, models.ReportStatistics, "local", "asset-1", &any); err != nil || any == nil {
		t.Errorf("into an interface: %v %v", any, err)
	}
	// a wrong type of the output is an error, not a panic
	var wrong string
	if err := a.GetAssetData(ctx, models.ReportStatistics, "local", "asset-1", &wrong); err == nil {
		t.Error("statistics into a string")
	}
	if err := a.ReportAsset(ctx, models.ReportStatistics, "local", "asset-1", "not statistics"); err == nil {
		t.Error("a report of the wrong type")
	}

	// the whole attributes at once
	all := models.Attributes{MgmtID: "asset-2", Name: "app.example.com", Statistics: stats}
	if err := a.ReportAsset(ctx, models.ReportAll, "local", "asset-2", all); err != nil {
		t.Fatal(err)
	}
	assets, err := a.GetAllAssetsData(ctx, "local")
	if err != nil || len(assets) != 2 {
		t.Fatalf("all assets: %d %v", len(assets), err)
	}

	// prune: the assets the policy no longer has are removed from the storage
	if err := a.PruneAssets(ctx, nil, 0); err == nil {
		t.Error("prune without the assets of the policy")
	}
	if err := a.PruneAssets(ctx, []models.AssetDetails{{AssetID: "asset-2", TenantID: "local"}}, 0); err != nil {
		t.Fatal(err)
	}
	if _, ok := s.files[strings.TrimPrefix(genFilePath("", "asset-2"), "/")]; !ok {
		t.Error("an asset of the policy was pruned")
	}
	if err := a.DeleteAllAssetsOfTenant(ctx, "local"); err == nil {
		t.Error("deleting a whole tenant is not supported, it must say so")
	}
}

func TestExtractFilesList(t *testing.T) {
	files, err := extractFilesList([]byte(`<ListBucketResult><KeyCount>2</KeyCount><Contents><Key>svc/a/attributes.data</Key></Contents><Contents><Key>svc/b/attributes.data</Key></Contents></ListBucketResult>`))
	if err != nil || len(files) != 2 {
		t.Errorf("list: %v %v", files, err)
	}
	if _, err := extractFilesList([]byte("not xml")); err == nil {
		t.Error("a list that is not XML")
	}
}
