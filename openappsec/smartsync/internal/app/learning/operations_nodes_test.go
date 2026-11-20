package learning

import "testing"

// NginxionS: the node of the data of an agent is the segment after its window
func TestNodeOfFile(t *testing.T) {
	cases := map[string]string{
		"/shop/Indicators/Confidence/window_0_1/n-0123456789abcdef/agent-a/data.data0": "n-0123456789abcdef",
		"shop/Type/window_3/agent-uuid/data.data":                                      "agent-uuid",
		"/shop/Indicators/Confidence/remote/confidence.data":                           "",
	}
	for file, want := range cases {
		if got := nodeOfFile(file); got != want {
			t.Errorf("nodeOfFile(%q) = %q, want %q", file, got, want)
		}
	}
}
