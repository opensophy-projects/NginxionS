package handlers

// NginxionS: with the data of several nodes, one node never makes a value confident alone

import (
	"context"
	"fmt"
	"testing"

	"openappsec.io/smartsync-service/models"
)

const testParameter = "url#/login"

func windowOf(sources ...string) *logger {
	return parameterWindow(testParameter, sources...)
}

func parameterWindow(parameter string, sources ...string) *logger {
	return &logger{WindowLogger: []mapToMapToSet{{
		Key:   parameter,
		Value: []mapToSet{{Key: "value-a", Value: sources}},
	}}}
}

func sources(prefix string, n int) []string {
	out := []string{}
	for i := 0; i < n; i++ {
		out = append(out, fmt.Sprintf("%s-%d", prefix, i))
	}
	return out
}

func newCalculator() *ConfidenceCalculator {
	c := &ConfidenceCalculator{params: models.ConfidenceParams{MinSources: 3}}
	c.ClearMergedData()
	return c
}

func TestOneNodeAloneIsCappedBelowMinSources(t *testing.T) {
	ctx := context.Background()
	c := newCalculator()
	c.SetDataNode("n-1111111111111111")
	c.MergeData(windowOf(sources("evil", 50)...))
	c.SetDataNode("n-2222222222222222")
	c.MergeData(windowOf())
	got := c.countSources(ctx, testParameter, c.md.log[testParameter]["value-a"])
	if got != 2 {
		t.Fatalf("one node with 50 sources counts %d, want MinSources-1 = 2", got)
	}

	// a second node seeing the value too: its sources count as well
	c.SetDataNode("n-2222222222222222")
	c.MergeData(windowOf(sources("good", 2)...))
	if got := c.countSources(ctx, testParameter, c.md.log[testParameter]["value-a"]); got != 4 {
		t.Fatalf("two nodes count %d, want 4", got)
	}
}

func TestOneNodeOnlyCountsAsBefore(t *testing.T) {
	c := newCalculator()
	c.SetDataNode("n-1111111111111111")
	c.MergeData(windowOf(sources("src", 5)...))
	if got := c.countSources(context.Background(), testParameter, c.md.log[testParameter]["value-a"]); got != 5 {
		t.Fatalf("a server alone counts %d, want 5 (no cap)", got)
	}
}

func TestSourceSeenThroughTwoNodesCountsOnce(t *testing.T) {
	c := newCalculator()
	c.SetDataNode("n-1")
	c.MergeData(windowOf("shared", "a"))
	c.SetDataNode("n-2")
	c.MergeData(windowOf("shared", "b"))
	if got := c.countSources(context.Background(), testParameter, c.md.log[testParameter]["value-a"]); got != 3 {
		t.Fatalf("count %d, want 3 (shared once)", got)
	}
}

func TestNodeAttributionIsScopedToTheParameter(t *testing.T) {
	ctx := context.Background()
	c := newCalculator()
	const sharedParameter = "url_param#shared"
	c.SetDataNode("n-1")
	c.MergeData(windowOf("a", "b", "c"))
	c.MergeData(parameterWindow(sharedParameter, "a"))
	c.SetDataNode("n-2")
	c.MergeData(parameterWindow(sharedParameter, "b"))
	c.SetDataNode("")
	c.MergeData(parameterWindow(sharedParameter, "c"))

	if got := c.countSources(ctx, sharedParameter, c.md.log[sharedParameter]["value-a"]); got != 3 {
		t.Fatalf("sources distributed for one parameter count %d, want 3", got)
	}
	if got := c.countSources(ctx, testParameter, c.md.log[testParameter]["value-a"]); got != 2 {
		t.Fatalf("sources on one node for the other parameter count %d, want 2", got)
	}
}

func TestBenignSourceIsNotCapped(t *testing.T) {
	c := newCalculator()
	c.decisions = models.TuningEvents{Decisions: []models.TuneEvent{
		{EventType: models.EventTypeSource, EventTitle: "office", Decision: "benign"},
	}}
	c.SetDataNode("n-1")
	c.MergeData(windowOf("office"))
	c.SetDataNode("n-2")
	c.MergeData(windowOf())
	if got := c.countSources(context.Background(), testParameter, c.md.log[testParameter]["value-a"]); got != 3 {
		t.Fatalf("a benign source counts %d, want MinSources = 3", got)
	}
}
