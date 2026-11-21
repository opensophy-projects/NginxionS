package learning

import (
	"os"
	"path/filepath"
	"testing"

	"openappsec.io/smartsync-service/models"
)

// NginxionS: the thresholds of the GUI over the ones of upstream, out of range values ignored
func TestSettingsOfNginxions(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "s.json")
	t.Setenv(settingsEnv, file)
	base := models.ConfidenceParams{MinSources: 3, MinIntervals: 5, RatioThreshold: 0.8}

	if got := withSettings(base, false, readNginxionsSettings()); got != base {
		t.Fatalf("no file: %+v", got)
	}
	_ = os.WriteFile(file, []byte(`{"minSources": 5, "minSourcesTypes": 20, "minIntervals": 3, "ratioThreshold": 0.6}`), 0o600)
	s := readNginxionsSettings()
	if got := withSettings(base, false, s); got.MinSources != 5 || got.MinIntervals != 3 || got.RatioThreshold != 0.6 {
		t.Fatalf("indicators: %+v", got)
	}
	if got := withSettings(base, true, s); got.MinSources != 20 {
		t.Fatalf("types: %+v", got)
	}
	_ = os.WriteFile(file, []byte(`{"minSources": 1, "minIntervals": 0, "ratioThreshold": 7}`), 0o600)
	if got := withSettings(base, false, readNginxionsSettings()); got != base {
		t.Fatalf("out of range kept: %+v", got)
	}
	_ = os.WriteFile(file, []byte(`not json`), 0o600)
	if got := withSettings(base, false, readNginxionsSettings()); got != base {
		t.Fatalf("broken file: %+v", got)
	}
}
