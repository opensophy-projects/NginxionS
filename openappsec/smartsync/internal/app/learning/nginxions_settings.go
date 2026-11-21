package learning

// NginxionS: the thresholds of the learning put together are settings of the GUI of NginxionS ("Agents -> Nodes ->
// Learning of the nodes"): NginxionS writes them to a JSON file of the volume of the agent settings, read before each
// sync (no restart). A missing, unreadable or out of range value keeps the value of upstream.

import (
	"encoding/json"
	"os"

	"openappsec.io/smartsync-service/models"
)

const settingsEnv = "NGINXIONS_SMARTSYNC_SETTINGS"
const defaultSettingsFile = "/ext/appsec/nginxions-smartsync.json"

type nginxionsSettings struct {
	MinSources      *int     `json:"minSources"`
	MinSourcesTypes *int     `json:"minSourcesTypes"`
	MinIntervals    *int     `json:"minIntervals"`
	RatioThreshold  *float64 `json:"ratioThreshold"`
}

func readNginxionsSettings() nginxionsSettings {
	file := os.Getenv(settingsEnv)
	if file == "" {
		file = defaultSettingsFile
	}
	var s nginxionsSettings
	data, err := os.ReadFile(file)
	if err != nil {
		return nginxionsSettings{}
	}
	if json.Unmarshal(data, &s) != nil {
		return nginxionsSettings{}
	}
	return s
}

func inRange(v *int, min, max int) bool { return v != nil && *v >= min && *v <= max }

// withSettings the parameters of a confidence calculator with the settings of NginxionS over them
func withSettings(params models.ConfidenceParams, types bool, s nginxionsSettings) models.ConfidenceParams {
	sources := s.MinSources
	if types {
		sources = s.MinSourcesTypes
	}
	if inRange(sources, 2, 1000) {
		params.MinSources = *sources
	}
	if inRange(s.MinIntervals, 1, 100) {
		params.MinIntervals = *s.MinIntervals
	}
	if s.RatioThreshold != nil && *s.RatioThreshold >= 0.1 && *s.RatioThreshold <= 1 {
		params.RatioThreshold = *s.RatioThreshold
	}
	return params
}
