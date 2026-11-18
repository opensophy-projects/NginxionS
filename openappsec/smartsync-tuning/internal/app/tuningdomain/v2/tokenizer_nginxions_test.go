// NginxionS: the URLs and parameters of the tuning suggestions are grouped into patterns
package tuning

import (
	"reflect"
	"sort"
	"strings"
	"testing"
)

func TestSplitURI(t *testing.T) {
	for in, want := range map[string][]string{
		"/api/users/123/":       {"api", "users", "_num"},
		"/api/users/deadbeef/x": {"api", "users", "_num", "x"},
		"/static/app.v2.js":     {"static", "app", "v2", "js"},
		"q":                     {"q"},
		"":                      {},
		"/":                     {},
		"/a/B0B0B0B0/c":         {"a", "_num", "c"},
	} {
		got := splitURI(in)
		if len(got) == 0 && len(want) == 0 {
			continue
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("splitURI(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestMinMaxDepth(t *testing.T) {
	depths := map[int]bool{3: true, 1: true, 7: true}
	if min(depths) != 1 || maxDepth(depths) != 7 {
		t.Errorf("min %d max %d", min(depths), maxDepth(depths))
	}
	if maxDepth(map[int]bool{}) != 0 {
		t.Error("max of nothing")
	}
}

func TestCollapseUrls(t *testing.T) {
	urls := []string{}
	for _, id := range []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"} {
		urls = append(urls, "/api/users/"+id+"/profile")
	}
	urls = append(urls, "/about", "/contact")
	patterns, rest := collapseUrls(urls)
	if len(patterns) == 0 {
		t.Fatalf("no pattern for the users: rest %v", rest)
	}
	found := false
	for _, p := range patterns {
		sort.Strings(p)
		if strings.Contains(strings.Join(p, " "), "profile") && strings.Contains(strings.Join(p, " "), "users") {
			found = true
		}
	}
	if !found {
		t.Errorf("patterns %v miss /api/users/_num/profile", patterns)
	}
	for _, u := range rest {
		if strings.HasPrefix(u, "/api/users/") {
			t.Errorf("%s is left out of its pattern", u)
		}
	}
}

func TestCollapseParamsAndEdgeCases(t *testing.T) {
	params := []string{}
	for _, p := range []string{"a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"} {
		params = append(params, "filter."+p+".value")
	}
	if patterns, _ := collapseParams(params); len(patterns) == 0 {
		t.Error("no pattern for the parameters")
	}
	// only numbers, an empty value, one URL: no pattern and no panic
	for _, origins := range [][]string{{"/1", "/2"}, {""}, {"/only"}, {}} {
		patterns, rest := collapseUrls(origins)
		if len(patterns) != 0 {
			t.Errorf("%v: patterns %v", origins, patterns)
		}
		_ = rest
	}
}

func TestNodeString(t *testing.T) {
	n := newURINode("api")
	n.count = 2
	if s := n.String(); !strings.Contains(s, "token: api") || !strings.Contains(s, "count: 2") {
		t.Errorf("String() = %s", s)
	}
}
