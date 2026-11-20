 

package models

import (
	"context"
	"time"
)

// mockgen -destination mocks/mock_syncHandler.go -package mocks openappsec.io/smartsync-service/models SyncHandler

// State defines the operations on a learning state
type State interface {
	ShouldRebase() bool
	GetFilePath(id SyncID) string
	GetOriginalPath(ids SyncID) string
}

// DataCollector defines the interface for data collection per type
type DataCollector interface {
	NewDataStruct() interface{}
	MergeData(data interface{})
	ClearMergedData()
}

// NodeAwareCollector is a collector told which node (server of NginxionS) the next data comes from (NginxionS: the
// manager puts the id of a node into the path of its data, so one node can be kept from making the norm alone)
type NodeAwareCollector interface {
	SetDataNode(node string)
}

// SyncHandler defines a handler for sync per type
type SyncHandler interface {
	DataCollector

	NewState() State
	ProcessData(ctx context.Context, state State) State
	ProcessDataFromCentralData(ctx context.Context, state State, mergedData *CentralData) State
	GetDependencies() map[SyncID]SyncHandler
	SetCompressionEnabled()
}

//EventTypeEnum enum for event types
type EventTypeEnum string

//events type enums
const (
	EventTypeParam  = "parameterName"
	EventTypeSource = "source"
)

//TuneEvent defines a tuning decision
type TuneEvent struct {
	Decision   string        `json:"decision"`
	EventType  EventTypeEnum `json:"eventType"`
	EventTitle string        `json:"eventTitle"`
}

//TuningEvents defines multiple decisions
type TuningEvents struct {
	Decisions []TuneEvent `json:"decisions"`
}

//ConfidenceParams defines the parameters for the confidence calculator
type ConfidenceParams struct {
	MinSources     int
	MinIntervals   int
	RatioThreshold float64
	NullObject     string
	Interval       time.Duration
}
