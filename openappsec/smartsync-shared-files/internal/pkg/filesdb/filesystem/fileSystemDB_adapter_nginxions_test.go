// NginxionS: the adapter of the shared storage as the agent uses it: configuration, lists, temporary files
package filesystem

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

type conf struct {
	root    string
	ttl     time.Duration
	rootErr error
	ttlErr  error
}

func (c conf) GetString(string) (string, error)          { return c.root, c.rootErr }
func (c conf) GetDuration(string) (time.Duration, error) { return c.ttl, c.ttlErr }

func TestNewAdapter(t *testing.T) {
	root := filepath.Join(t.TempDir(), "storage")
	a, err := NewAdapter(conf{root: root, ttl: time.Hour})
	if err != nil || a.root != root || a.ttl != time.Hour {
		t.Fatalf("NewAdapter: %+v %v", a, err)
	}
	if info, err := os.Stat(root); err != nil || !info.IsDir() {
		t.Fatalf("the root is not created: %v", err)
	}
	if _, err := NewAdapter(conf{rootErr: errors.New("no root")}); err == nil {
		t.Error("a missing root is accepted")
	}
	if _, err := NewAdapter(conf{root: root, ttlErr: errors.New("no ttl")}); err == nil {
		t.Error("a missing ttl is accepted")
	}
	file := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(file, nil, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewAdapter(conf{root: filepath.Join(file, "below"), ttl: time.Hour}); err == nil {
		t.Error("a root below a file is accepted")
	}
}

func TestCleanupRemovesOnlyTemporaryFiles(t *testing.T) {
	root := t.TempDir()
	keep := []string{"t/a/remote/data", "t/a/processed/data", "t/a/tuning/decisions.data", "t/a/attributes.data"}
	temp := []string{"t/a/data.data", "t/b/x.data"}
	for _, p := range append(append([]string{}, keep...), temp...) {
		full := filepath.Join(root, p)
		if err := os.MkdirAll(filepath.Dir(full), 0750); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(full, []byte("x"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	cleanup(root, 10*time.Millisecond)
	deadline := time.Now().Add(2 * time.Second)
	for {
		gone := 0
		for _, p := range temp {
			if _, err := os.Stat(filepath.Join(root, p)); os.IsNotExist(err) {
				gone++
			}
		}
		if gone == len(temp) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("temporary files are still there after the ttl")
		}
		time.Sleep(10 * time.Millisecond)
	}
	for _, p := range keep {
		if _, err := os.Stat(filepath.Join(root, p)); err != nil {
			t.Errorf("%s was removed: %v", p, err)
		}
	}
}

func TestGetFilesList(t *testing.T) {
	root := t.TempDir() + "/"
	a := &Adapter{root: root, ttl: time.Minute}
	ctx := context.Background()
	for _, p := range []string{"tenant/asset/a.data", "tenant/asset/sub/b.data", "tenant/asset2/c.data", "other/d"} {
		if err := a.PutFile(ctx, p, []byte(p), false); err != nil {
			t.Fatal(err)
		}
	}
	paths := func(prefix string) []string {
		files, err := a.GetFilesList(ctx, prefix)
		if err != nil {
			t.Fatalf("GetFilesList(%q): %v", prefix, err)
		}
		out := []string{}
		for _, f := range files {
			if f.LastModified.IsZero() {
				t.Errorf("%s has no modification time", f.Path)
			}
			out = append(out, f.Path)
		}
		sort.Strings(out)
		return out
	}
	// a prefix of a name: asset and asset2
	if got := paths("tenant/asset"); len(got) != 3 {
		t.Errorf("prefix: %v", got)
	}
	// a directory: only what is below it
	got := paths("tenant/asset/")
	if len(got) != 2 || got[0] != "tenant/asset/a.data" || got[1] != "tenant/asset/sub/b.data" {
		t.Errorf("directory: %v", got)
	}
	if got := paths("nothing/"); len(got) != 0 {
		t.Errorf("no match: %v", got)
	}
	if _, err := a.GetFilesList(ctx, "../"); err == nil {
		t.Error("a list outside the root")
	}
}

func TestGetFilesListRejectsIncompleteResults(t *testing.T) {
	root := t.TempDir() + "/"
	denied := filepath.Join(root, "locked")
	if err := os.Mkdir(denied, 0); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := os.Chmod(denied, 0700); err != nil {
			t.Error(err)
		}
	})
	if _, err := os.ReadDir(denied); err == nil {
		t.Skip("permission bits do not restrict this test user")
	}
	if err := os.WriteFile(filepath.Join(root, "available"), []byte("ok"), 0600); err != nil {
		t.Fatal(err)
	}
	a := &Adapter{root: root, ttl: time.Minute}
	files, err := a.GetFilesList(context.Background(), "")
	if err == nil || len(files) != 0 {
		t.Fatalf("listing incomplete files must fail: %v, %v", files, err)
	}
}

func TestGetFileNotFoundAndTemporaryFiles(t *testing.T) {
	root := t.TempDir() + "/"
	a := &Adapter{root: root, ttl: 10 * time.Millisecond}
	ctx := context.Background()
	if _, err := a.GetFile(ctx, "missing"); err == nil {
		t.Error("a missing file is read")
	}
	if err := a.PutFile(ctx, "t/temp.data", []byte("x"), true); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, err := os.Stat(filepath.Join(root, "t/temp.data")); os.IsNotExist(err) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("a temporary file outlives its ttl")
		}
		time.Sleep(10 * time.Millisecond)
	}
	// a directory in the way of the file
	if err := os.MkdirAll(filepath.Join(root, "dir/file"), 0750); err != nil {
		t.Fatal(err)
	}
	if err := a.PutFile(ctx, "dir/file", []byte("x"), false); err == nil {
		t.Error("a file is written over a directory")
	}
	if _, err := a.GetFile(ctx, "dir/file"); err == nil {
		t.Error("a directory is read as a file")
	}
}
