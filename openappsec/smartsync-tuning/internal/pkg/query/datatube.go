package query

import (
	"context"
	"database/sql/driver"
	stderrors "errors"
	"fmt"
	"hash/fnv"
	"io"
	"net"
	"net/url"
	"runtime"
	"strings"
	"sync"
	"time"

	"openappsec.io/smartsync-tuning/models"

	"golang.org/x/sync/errgroup"
	"google.golang.org/api/iterator"
	"openappsec.io/errors"
	"openappsec.io/log"
)

const (
	confKeyQuery                         = "query"
	confKeyQueryDurationWarningThreshold = confKeyQuery + ".warningThreshold"
	confKeyQueryDB                       = confKeyQuery + ".db"
	confKeyQueryDBHost                   = confKeyQueryDB + ".host"
	confKeyQueryDBPort                   = confKeyQueryDB + ".port"
	confKeyQueryDBUser                   = confKeyQueryDB + ".user"
	confKeyQueryDBSSLMode                = confKeyQueryDB + ".sslmode"
	confKeyQueryDBPass                   = confKeyQueryDB + ".password"

	maxRetries = 3
)

// Field names for smartview queries
const (
	fieldNameSeverity   = "eventseverity"
	fieldNameSource     = "httpsourceid"
	fieldNameURL        = "httpuripath"
	fieldNameParamName  = "matchedparameter"
	fieldNameParamValue = "matchedsample"
	fieldNameAssetName  = "assetname"
)

const defaultQueryDurationWarningThreshold = 5 * time.Minute
const (
	attackTypeUnknown = "General"
	attackTypeDefault = "uncategorized indication"
)

// GenQueries gen queries per sql server
type GenQueries interface {
	GetTotalRequests(tenantID string) string
	GetGeneralStatsQuery(tenantID string) string
	GetElapsedTime(tenantID string) string
	GetSeverityStatsQuery(tenantID string) string
	GetTuneParameterQuery(parameter string, minCount int, tenantID string) string
	GetTuneURLQueryFormat(minCount int, tenantID string) string
	GetExceptionsQuery(tenantID string) string
	GetParamsForCollapsingFormat(tenantID string) string
	GetUrlsForCollapsingFormat(tenantID string) string
	GetNumOfRequests(tenantID string) string
	GenerateLogQuery(data models.TuneEvent, assetName string) string
	Insert(message *models.AgentMessage) (string, []driver.Value, error)
	CreateTable(id string) (string, error)
	CreateDatabase() string
	CreateTablePartition(id string, eventTime string) (string, error)
	CreateIndexes(id string) []string // NginxionS
	ParseError(err error) errors.Class
	ScanArray(value driver.Value, arr any) error
}

// Adapter for querying datatube in bigquery
type Adapter struct {
	config      Configuration
	driver      driver.Driver
	genQuery    GenQueries
	dbName      string
	rootConn    string
	projectID   string
	datasetID   string
	elpisTenant string
	tenantsList []string
	tenantsLock sync.Locker
	// NginxionS: the UTC day whose next partition was created ahead (ensureNextPartition)
	nextPartitionDay  string
	nextPartitionLock sync.Mutex
	indexesCreated    bool
	// NginxionS: the idle connections, reused (see getConn)
	idle     []driver.Conn
	idleLock sync.Mutex
	closed   bool
}

type converter func(columns []string, data []driver.Value) interface{}

// Configuration used to get the configuration of the datatube dataset
type Configuration interface {
	GetString(key string) (string, error)
	IsSet(key string) bool
	GetDuration(key string) (time.Duration, error)
}

// NewAdapter creates an empty new adapter
func NewAdapter(ctx context.Context, c Configuration, g GenQueries, driver driver.Driver) (*Adapter, error) {
	dbHost, err := c.GetString(confKeyQueryDBHost)
	if err != nil {
		return nil, err
	}

	dbPort, err := c.GetString(confKeyQueryDBPort)
	if err != nil {
		return nil, err
	}

	dbUser, err := c.GetString(confKeyQueryDBUser)
	if err != nil {
		return nil, err
	}

	pass, err := c.GetString(confKeyQueryDBPass)
	if err != nil {
		return nil, err
	}

	sslMode, err := c.GetString(confKeyQueryDBSSLMode)
	if err != nil {
		return nil, err
	}

	// NginxionS: escaped (a password with "@", "/", "#" or "%" broke the URL, and an error of its parsing quotes it)
	dbName := postgresURL(dbUser, pass, dbHost, dbPort, "i2datatubeschemasecurityeventlogsv03", sslMode)

	// NginxionS: the connection string holds the password of the database user: never log it
	log.WithContext(ctx).Infof("db name: postgres://%s:***@%s:%v/i2datatubeschemasecurityeventlogsv03?sslmode=%s",
		dbUser, dbHost, dbPort, sslMode)

	a := &Adapter{config: c, tenantsLock: &sync.Mutex{}, genQuery: g, driver: driver, dbName: dbName}
	return a, nil
}

// SetTenantsList set tenants list to query - if first entry is All queries all tenants in dataset
func (qa *Adapter) setTenantsList(tenants []string) {
	qa.tenantsLock.Lock()
	qa.tenantsList = tenants
}

// GenerateLogQuery created a log query for smartview
func (qa *Adapter) GenerateLogQuery(data models.TuneEvent, assetName string) string {
	return qa.genQuery.GenerateLogQuery(data, assetName)
}

func convertGroupedDataToGeneralStatsData(columns []string, rawData []driver.Value) interface{} {
	data := models.GeneralStatsData{}
	for i, columnName := range columns {
		switch columnName {
		case models.FieldNameTenantID:
			break
		case models.FieldNameAssetID:
			break
		case models.FieldNameStartTime:
			data.StartupTime = rawData[i].(int64)
		case models.FieldNameElapsedTime:
			data.ElapsedTime = rawData[i].(int64)
		case models.FieldNameCountAll:
			data.Count = rawData[i].(int64)
		case models.FieldNameCountURLs:
			data.URLsCount = rawData[i].(int64)
		case models.FieldNameCountSources:
			data.SourcesCount = rawData[i].(int64)
		}
	}
	return data
}

type elapsedTimeStatsData struct {
	ElapsedTime  int64
	RequestCount int64
}

func convertGroupedDataToElapsedTimeStatsData(columns []string, rawData []driver.Value) interface{} {
	data := elapsedTimeStatsData{}
	for i, columnName := range columns {
		switch columnName {
		case models.FieldNameTenantID:
			break
		case models.FieldNameAssetID:
			break
		case models.FieldNameCountAll:
			data.RequestCount = rawData[i].(int64)
		case models.FieldNameStartTime:
			data.ElapsedTime = rawData[i].(int64)
		}
	}
	return data
}

// GeneralLogQuery sends a query on all tables in a dataset looking for general data
func (qa *Adapter) GeneralLogQuery(ctx context.Context, tenantID string) (models.QueryResponse, error) {
	errChan := make(chan error)
	genStatsCh := make(chan models.QueryResponse, 1)
	elapsedTimesCh := make(chan models.QueryResponse, 1)
	totalRequestsCh := make(chan models.QueryResponse, 1)
	go func() {
		resp, err := qa.queryLogs(ctx, qa.genQuery.GetGeneralStatsQuery(tenantID),
			[]string{models.FieldNameTenantID, models.FieldNameAssetID}, convertGroupedDataToGeneralStatsData)
		if err != nil {
			errChan <- err
		}
		genStatsCh <- resp
	}()
	go func() {

		elapsedTimes, err := qa.queryLogs(ctx, qa.genQuery.GetElapsedTime(tenantID),
			[]string{models.FieldNameTenantID, models.FieldNameAssetID}, convertGroupedDataToElapsedTimeStatsData)
		if err != nil {
			errChan <- err
		}
		elapsedTimesCh <- elapsedTimes
	}()
	go func() {
		totalRequests, err := qa.queryLogs(ctx, qa.genQuery.GetTotalRequests(tenantID),
			[]string{models.FieldNameTenantID, models.FieldNameAssetID}, convertGroupedDataToElapsedTimeStatsData)
		if err != nil {
			errChan <- err
		}
		totalRequestsCh <- totalRequests
	}()

	var resp, elapsedTimes, totalRequests models.QueryResponse
	for i := 0; i < 3; i++ {
		select {
		case err := <-errChan:
			return models.QueryResponse{}, err
		case resp = <-genStatsCh:
		case elapsedTimes = <-elapsedTimesCh:
		case totalRequests = <-totalRequestsCh:
		}
	}

	runtime.Gosched()

	for tenant, tenantData := range resp {
		for asset, assetData := range tenantData {
			for i, data := range assetData {
				stats := data.(models.GeneralStatsData)
				if _, ok := elapsedTimes[tenant][asset]; ok {
					stats.StartupTime = elapsedTimes[tenant][asset][i].(elapsedTimeStatsData).ElapsedTime
					stats.TotalRequests = totalRequests[tenant][asset][i].(elapsedTimeStatsData).RequestCount
				} else {
					stats.StartupTime = time.Now().Add(time.Duration(-stats.ElapsedTime) * time.Hour).Unix()
					stats.TotalRequests = stats.Count
				}
				resp[tenant][asset][i] = stats
				runtime.Gosched()
			}
		}
	}
	for tenant, tenantData := range elapsedTimes {
		for asset, assetData := range tenantData {
			for _, data := range assetData {
				if _, ok := resp[tenant][asset]; !ok {
					elapsedData := data.(elapsedTimeStatsData)
					if _, exists := resp[tenant]; !exists {
						resp[tenant] = models.TenantResponse{}
					}
					if _, exists := resp[tenant][asset]; !exists {
						resp[tenant][asset] = models.GroupedResponse{}
					}
					resp[tenant][asset] = append(resp[tenant][asset],
						models.GeneralStatsData{StartupTime: elapsedData.ElapsedTime,
							TotalRequests: totalRequests[tenant][asset][0].(elapsedTimeStatsData).RequestCount})
					runtime.Gosched()
				}
			}
		}
	}
	return resp, nil
}

func convertGroupedDataToSeverityStatsData(columns []string, rawData []driver.Value) interface{} {
	data := models.SeverityStatsData{}
	for i, columnName := range columns {
		switch columnName {
		case models.FieldNameTenantID:
			break
		case models.FieldNameAssetID:
			break
		case models.FieldNameCountAll:
			data.TotalRequests = rawData[i].(int64)
		case models.FieldNameCountCritical:
			data.CriticalSeverityRequests = rawData[i].(int64)
		case models.FieldNameCountHigh:
			data.HighSeverityRequests = rawData[i].(int64)
		}
	}
	return data
}

// SeverityLogQuery sends a query on all tables in a dataset looking for data grouped by severity
func (qa *Adapter) SeverityLogQuery(ctx context.Context, tableName string) (models.QueryResponse, error) {
	return qa.queryLogs(ctx, qa.genQuery.GetSeverityStatsQuery(tableName),
		[]string{models.FieldNameTenantID, models.FieldNameAssetID}, convertGroupedDataToSeverityStatsData)
}

func mergeResponse(orig, new models.QueryResponse) models.QueryResponse {
	for tenantID, assetCtx := range new {
		_, exists := orig[tenantID]
		if !exists {
			orig[tenantID] = models.TenantResponse{}
		}
		for assetID, assetData := range assetCtx {
			_, exists = orig[tenantID][assetID]
			if !exists {
				orig[tenantID][assetID] = models.GroupedResponse{}
			}

			orig[tenantID][assetID] = append(orig[tenantID][assetID], assetData...)
		}
	}
	return orig
}

// GetNumOfRequests gets the number of requests for a specific dataset
func (qa *Adapter) GetNumOfRequests(ctx context.Context, tenantID string) (int64, error) {
	queryStr := qa.genQuery.GetNumOfRequests(tenantID)

	// NginxionS: through runQuery, on a pooled connection whose statement and rows are closed (a connection was
	// opened per call and never closed); a result without rows is io.EOF for database/sql drivers
	r, err := qa.runQuery(ctx, queryStr)
	if err != nil {
		return 0, err
	}
	defer r.Close()
	row := make([]driver.Value, 1)
	err = r.Next(row)
	if err == iterator.Done || err == io.EOF {
		return 0, errors.Errorf("no data found for dataset %v", tenantID).SetClass(errors.ClassNotFound)
	} else if err != nil {
		return 0, errors.Wrap(err, "failed to read query response")
	}

	if row[0] == nil {
		return 0, errors.Errorf("no data found for dataset %v", tenantID).SetClass(errors.ClassNotFound)
	}

	return row[0].(int64), nil
}

// TuneLogQuery sends a query on all tables in a dataset looking for tuning data
func (qa *Adapter) TuneLogQuery(ctx context.Context, tenantID string) (models.QueryResponse, error) {
	log.WithContext(ctx).Info("run tuning queries")
	fields := []string{fieldNameURL, fieldNameSource, fieldNameParamName, fieldNameParamValue}
	response := models.QueryResponse{}
	numOfQueries := len(fields) + 1
	qResponseChan := make(chan models.QueryResponse, numOfQueries)
	errG, ctx := errgroup.WithContext(ctx)
	for _, fieldName := range fields {
		// avoids race
		fieldNameCopy := fieldName
		errG.Go(func() error {
			qResponse, err := qa.queryLogs(
				ctx, qa.genQuery.GetTuneParameterQuery(fieldNameCopy, 3, tenantID),
				[]string{models.FieldNameTenantID, models.FieldNameAssetID}, qa.convertGroupedDataToTuningData)

			if err != nil {
				return errors.Wrapf(err, "failed to query tuning info for field: %v", fieldName)
			}
			qResponseChan <- qResponse
			return nil
		})
	}
	errG.Go(func() error {
		qResponse, err := qa.queryLogs(
			ctx, qa.genQuery.GetTuneURLQueryFormat(3, tenantID),
			[]string{models.FieldNameTenantID, models.FieldNameAssetID}, qa.convertGroupedDataToTuningData)

		if err != nil {
			return errors.Wrapf(err, "failed to query url tuning info")
		}
		qResponseChan <- qResponse
		return nil
	})

	if err := errG.Wait(); err != nil {
		return models.QueryResponse{}, err
	}

	close(qResponseChan)
	for qResponse := range qResponseChan {
		response = mergeResponse(response, qResponse)
	}

	return response, nil
}

func (qa *Adapter) convertGroupedDataToTuningData(columns []string, rawData []driver.Value) interface{} {
	data := models.TuningQueryData{AttackTypes: []string{}, LogIDs: []int64{}}
	for i, name := range columns {
		switch name {
		case models.FieldNameTenantID:
			break
		case models.FieldNameAssetID:
			break
		case models.FieldNameAssetName:
			data.AssetName = fmt.Sprint(rawData[i])
		case models.FieldNameSeverity:
			data.Severity = fmt.Sprint(rawData[i])
		case models.FieldNameCountAll:
			data.Count = rawData[i].(int64)
		case models.FieldNameCountURLs:
			data.URLsCount = rawData[i].(int64)
		case models.FieldNameCountSources:
			data.SourcesCount = rawData[i].(int64)
		case models.FieldNameCountParameters:
			data.ParametersCount = rawData[i].(int64)
		case models.FieldNameAttackTypes:
			var types []string
			if err := qa.genQuery.ScanArray(rawData[i], &types); err != nil {
				log.Error(err)
				continue
			}
			attackTypes := unionAttackTypes(types)
			if len(attackTypes) == 0 {
				data.AttackTypes = []string{attackTypeDefault}
			} else {
				data.AttackTypes = attackTypes
			}
		case models.FieldNameLogIDs:
			err := qa.genQuery.ScanArray(rawData[i], &data.LogIDs)
			if err != nil {
				log.Errorf("failed to scan array: %s, err: %v", rawData[i], err)
			}
		default:
			data.ExtraFieldName = name
			data.ExtraFieldValue = fmt.Sprint(rawData[i])
		}
	}
	return data
}

func unionAttackTypes(types []string) []string {
	attackTypesSet := make(map[string]struct{})
	for _, attackTypesStr := range types {
		splitAttackTypes := strings.Split(attackTypesStr, ", ")
		for _, attackType := range splitAttackTypes {
			if attackType == attackTypeUnknown {
				continue
			}
			attackTypesSet[attackType] = struct{}{}
		}
	}
	attackTypes := make([]string, 0)
	for t := range attackTypesSet {
		attackTypes = append(attackTypes, t)
	}
	return attackTypes
}

// NginxionS: the rows are read on a pooled connection and returned in memory: the statement, the rows and the
// connection are released before return (a connection was opened per query and never closed: under load the
// connections piled up to max_connections of Postgres). The callers read every row anyway.
func (qa *Adapter) runQuery(
	ctx context.Context, q string) (driver.Rows, error) {
	log.WithContext(ctx).Infof("run query: %v", q)

	var result *memRows
	err := qa.withConn(ctx, false, func(conn driver.Conn) error {
		query, err := conn.Prepare(q)
		if err != nil {
			return errors.Wrap(err, "failed to prepare a SQL statement")
		}
		defer query.Close()
		start := time.Now()

		warningThreshold, err := qa.config.GetDuration(confKeyQueryDurationWarningThreshold)
		if err != nil {
			warningThreshold = defaultQueryDurationWarningThreshold
			log.WithContext(ctx).Warnf(
				"failed to get query warning duration threshold, err: %v. using default %v", err,
				defaultQueryDurationWarningThreshold,
			)
		}

		qctx, ok := query.(driver.StmtQueryContext)
		if !ok {
			return errors.New("driver not implementing driver.QueryerContext interface")
		}

		rows, err := qctx.QueryContext(ctx, nil)

		if err != nil {
			log.WithContext(ctx).Warnf("got error reading query: %v", err)
			if qa.genQuery.ParseError(err) == errors.ClassForbidden {
				for i := 0; i < maxRetries; i++ {
					time.Sleep(time.Second * time.Duration(i+1))
					log.WithContext(ctx).Infof("retry query")
					rows, err = qctx.QueryContext(ctx, nil)
					if err == nil {
						break
					}
				}
			}
			if err != nil {
				if qa.genQuery.ParseError(err) == errors.ClassNotFound {
					return errors.Wrapf(err, "not found").SetClass(errors.ClassNotFound)
				}
				return errors.Wrapf(err, "failed to read query job: %v", q)
			}
		}
		defer rows.Close()
		result, err = readRows(rows)
		if err != nil {
			return errors.Wrapf(err, "failed while reading the rows of: %v", q)
		}

		end := time.Now()
		elapsed := end.Sub(start)

		if elapsed > warningThreshold {
			log.WithContext(ctx).Warnf("query %v took %v (over the %v threshold)", q, elapsed, warningThreshold)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return result, nil
}

// GetTuningLogs return the logs based on the tuning event
func (qa *Adapter) GetTuningLogs(ctx context.Context, asset string, event models.TuneEvent) (models.Logs, error) {
	log.WithContext(ctx).Debugf("get logs for asset: %v, event: %v", asset, event)
	query := qa.genQuery.GenerateLogQuery(event, asset)
	return qa.queryLogsRaw(ctx, query)
}

func (qa *Adapter) queryLogsRaw(ctx context.Context, q string) (models.Logs, error) {
	result := models.Logs{}
	rowIt, err := qa.runQuery(ctx, q)
	if err != nil {
		return result, err
	}

	columns := rowIt.Columns()
	row := make([]driver.Value, len(columns))
	err = rowIt.Next(row)
	if err == io.EOF {
		log.WithContext(ctx).Infof("got empty response for query: %v", q)
		return result, nil
	}

	result.ColumnNames = columns
	result.Rows = [][]string{}
	for err == nil {
		rowStr := make([]string, len(columns))
		for i := range row {
			rowStr[i] = fmt.Sprint(row[i])
		}
		result.Rows = append(result.Rows, rowStr)
		err = rowIt.Next(row)
	}
	if err != io.EOF {
		return models.Logs{}, errors.Wrapf(err, "failed while handling response on row: %v", row)
	}
	return result, nil
}

func (qa *Adapter) queryLogs(
	ctx context.Context, q string, orderedColumns []string, conv converter) (models.QueryResponse, error) {

	result := models.QueryResponse{}
	rowIt, err := qa.runQuery(ctx, q)
	if err != nil {
		return result, err
	}

	columns := rowIt.Columns()
	row := make([]driver.Value, len(columns))
	err = rowIt.Next(row)
	if err == io.EOF {
		log.WithContext(ctx).Infof("got empty response for query: %v", q)
		return result, nil
	}
	indices := make([]int, len(orderedColumns), len(orderedColumns))
	for i := range indices {
		indices[i] = -1
	}

	for i, columnName := range orderedColumns {
		for schemaColumnIdx, name := range columns {
			if name == columnName {
				indices[i] = schemaColumnIdx
			}
		}
	}

	for i, schemaColumnIdx := range indices {
		if schemaColumnIdx == -1 {
			return result, errors.Errorf("missing %s in query", orderedColumns[i])
		}
	}

	for {
		tenant := fmt.Sprint(row[indices[0]])
		if len(tenant) == 0 {
			tenant = "local"
		}
		var groupedByColumn string
		if len(indices) > 2 {
			exceptionAssetHashCombine := fnv.New32a()
			for _, schemaColumnIdx := range indices[1:] {
				_, err := exceptionAssetHashCombine.Write([]byte(fmt.Sprint(row[schemaColumnIdx])))
				if err != nil {
					log.WithContext(ctx).Warnf(
						"Failed to write hash combination. Got error: %v", err)
				}
			}
			groupedByColumn = fmt.Sprint(exceptionAssetHashCombine.Sum32())
		} else {
			groupedByColumn = fmt.Sprint(row[indices[1]])
		}
		groupedData := conv(columns, row)

		log.WithContext(ctx).Debugf("insert response: %+v", groupedData)

		_, exists := result[tenant]
		if !exists {
			result[tenant] = models.TenantResponse{}
		}
		_, exists = result[tenant][groupedByColumn]
		if !exists {
			result[tenant][groupedByColumn] = models.GroupedResponse{}
		}
		result[tenant][groupedByColumn] = append(result[tenant][groupedByColumn], groupedData)
		err = rowIt.Next(row)
		if err == io.EOF {
			break
		} else if err != nil {
			return models.QueryResponse{}, errors.Wrapf(err, "failed to fetch row in query response")
		}
	}
	return result, nil
}

// queryAllLogs sends a query on all tables in a dataset
func (qa *Adapter) queryAllLogs(ctx context.Context, queryFormat func(string) string,
	conv converter) (models.QueryResponse, error) {
	tenantsList := qa.tenantsList
	qa.tenantsLock.Unlock()
	if len(tenantsList) == 0 {
		return models.QueryResponse{}, errors.New("tenants list is not set")
	}
	if tenantsList[0] == "All" {
		q := queryFormat(tenantsList[0])
		return qa.queryLogs(ctx, q, []string{models.FieldNameTenantID, models.FieldNameAssetID}, conv)
	}

	result := models.QueryResponse{}
	for _, tenant := range tenantsList {
		q := queryFormat(tenant)
		res, err := qa.queryLogs(ctx, q, []string{models.FieldNameTenantID, models.FieldNameAssetID}, conv)
		if err != nil {
			return models.QueryResponse{}, errors.Wrapf(err, "failed to query dataset %v", tenant)
		}
		result[tenant] = res[tenant]
	}
	return result, nil
}

func (qa *Adapter) convertGroupedDataToUrls(columns []string, rawData []driver.Value) interface{} {
	data := models.UrlsToCollapse{}
	for i, name := range columns {
		switch name {
		case models.FieldNameTenantID:
			break
		case models.FieldNameAssetID:
			break
		case models.FieldNameURIs:
			err := qa.genQuery.ScanArray(rawData[i], &data.Urls)
			if err != nil {
				log.Errorf("failed to scan array %v, err: %v", rawData[i], err)
			}
		}
	}
	return data
}

func (qa *Adapter) convertGroupedDataToParams(columns []string, rawData []driver.Value) interface{} {
	data := models.ParamsToCollapse{}
	for i, name := range columns {
		switch name {
		case models.FieldNameTenantID:
			break
		case models.FieldNameAssetID:
			break
		case models.FieldNameParams:
			err := qa.genQuery.ScanArray(rawData[i], &data.Params)
			if err != nil {
				log.Errorf("failed to scan array %v, err: %v", rawData[i], err)
			}
		}
	}
	return data
}

// GetUrlsToCollapse return a list of urls to collapse for each dataset and asset
func (qa *Adapter) GetUrlsToCollapse(ctx context.Context, tenants []string) (models.QueryResponse, error) {
	qa.setTenantsList(tenants)
	return qa.queryAllLogs(ctx, qa.genQuery.GetUrlsForCollapsingFormat, qa.convertGroupedDataToUrls)
}

// GetParamsToCollapse return a list of urls to collapse for each dataset and asset
func (qa *Adapter) GetParamsToCollapse(ctx context.Context, tenants []string) (models.QueryResponse, error) {
	qa.setTenantsList(tenants)
	return qa.queryAllLogs(ctx, qa.genQuery.GetParamsForCollapsingFormat, qa.convertGroupedDataToParams)
}

func convertGroupedDataToExceptionData(columns []string, rawData []driver.Value) interface{} {
	data := models.ExceptionsData{}
	for i, name := range columns {
		switch name {
		case models.FieldNameTenantID:
			break
		case models.FieldNameAssetID:
			data.AssetID = fmt.Sprint(rawData[i])
		case models.FieldNameExceptionID:
			data.ExceptionID = fmt.Sprint(rawData[i])
		case models.FieldNameLastHitEvent:
			data.LastHitEvent = fmt.Sprint(rawData[i])
		case models.FieldNameHitCountPerAsset:
			data.HitCountPerAsset = rawData[i].(int64)
		case models.FieldNameHitCountPerException:
			data.HitCountPerException = rawData[i].(int64)
		}
	}
	return data
}

// ExceptionsLogQuery returns query response model of exceptions data
func (qa *Adapter) ExceptionsLogQuery(ctx context.Context, tenantID string) (models.QueryResponse, error) {
	return qa.queryLogs(ctx, qa.genQuery.GetExceptionsQuery(tenantID),
		[]string{models.FieldNameTenantID, models.FieldNameAssetID, models.FieldNameExceptionID},
		convertGroupedDataToExceptionData)
}

// InsertLog insert log to log repository
func (qa *Adapter) InsertLog(ctx context.Context, message *models.AgentMessage) error {
	stmtStr, args, err := qa.genQuery.Insert(message)
	if err != nil {
		return errors.Wrap(err, "failed to generate insert statement")
	}
	// NginxionS: no connection string (password) in the log
	log.WithContext(ctx).Infof("insert statement: %v", stmtStr)
	// NginxionS: on a pooled connection (one was opened per log and never closed, see runQuery)
	return qa.withConn(ctx, true, func(conn driver.Conn) error {
		return qa.insertLog(ctx, conn, message, stmtStr, args)
	})
}

func (qa *Adapter) insertLog(
	ctx context.Context, conn driver.Conn, message *models.AgentMessage, stmtStr string, args []driver.Value) error {
	qa.ensureNextPartition(ctx, conn, message)
	affected, err := executeStmt(ctx, conn, stmtStr, args)
	if err != nil {
		log.WithContext(ctx).Infof("encounter error: %v on first insertion attempt", err)
		// NginxionS: a parallel writer creating the same table or partition makes this one fail ("already exists");
		// the insert is tried again all the same, its failure is the error
		if errCreate := qa.createTablePartition(ctx, conn, message); errCreate != nil {
			log.WithContext(ctx).Warnf("failed to create the table or its partition (another writer may have), err: %v",
				errCreate)
		}
		affected, err = executeStmt(ctx, conn, stmtStr, args)
		if err != nil {
			return errors.Wrap(err, "failed to insert log after table creation")
		}
		if affected == 0 {
			return errors.Errorf("failed to insert log: %v", message)
		}
	}
	return nil
}

func executeStmt(ctx context.Context, conn driver.Conn, stmtStr string, args []driver.Value) (int64, error) {
	stmt, err := conn.Prepare(stmtStr)
	if err != nil {
		return 0, errors.Wrapf(err, "failed to prepare stmt: %v", stmtStr)
	}
	// NginxionS: a prepared statement lives on its connection until closed, and connections are reused now
	defer stmt.Close()
	var res driver.Result
	if stmtCtx, ok := stmt.(driver.StmtExecContext); ok {
		namedArgs := make([]driver.NamedValue, len(args))
		for i, arg := range args {
			namedArgs[i] = driver.NamedValue{Value: arg}
		}
		res, err = stmtCtx.ExecContext(ctx, namedArgs)
	} else {
		res, err = stmt.Exec(args)
	}
	log.WithContext(ctx).Infof("execute: %v, result: %+v, err: %+v", stmtStr, res, err)
	if err != nil {
		return 0, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, err
	}
	return affected, nil
}

// NginxionS: a partition is created with a lock timeout. CREATE TABLE ... PARTITION OF waits for an exclusive lock of
// the table, behind the long queries of the statistics: every insert of the new day failed meanwhile and the writers
// piled up (openappsec/openappsec, "High resource consumption caused by openappsec-db").
const partitionLockTimeout = "SET lock_timeout = '10s'"

func (qa *Adapter) createTablePartition(ctx context.Context, conn driver.Conn, message *models.AgentMessage) error {
	createStmt, err := qa.genQuery.CreateTablePartition(message.TenantID, message.Log.EventTime)
	if err != nil {
		return errors.Wrap(err, "failed to generate statement")
	}
	if _, err := executeStmt(ctx, conn, partitionLockTimeout, nil); err != nil {
		log.WithContext(ctx).Infof("failed to set the lock timeout, err: %v", err)
	}
	_, err = executeStmt(ctx, conn, createStmt, nil)
	if err != nil {
		log.WithContext(ctx).Infof("failed to create table partition, err: %v", err)
		if qa.genQuery.ParseError(err) == errors.ClassNotFound {
			err = qa.createTable(ctx, conn, message)
			if err != nil {
				return errors.Wrap(err, "failed to create table")
			}
			_, err = executeStmt(ctx, conn, createStmt, nil)
		} else {
			err = errors.Wrapf(err, "failed to create table partition")
		}
	}
	return err
}

// NginxionS: once a day, the partition of the next day is created ahead, so that the first inserts after midnight
// (UTC) find it and no insert waits for the DDL. A failure is only logged: the insert creates it as before.
func (qa *Adapter) ensureNextPartition(ctx context.Context, conn driver.Conn, message *models.AgentMessage) {
	now := time.Now().UTC()
	today := now.Format("2006-01-02")
	qa.nextPartitionLock.Lock()
	defer qa.nextPartitionLock.Unlock()
	if qa.nextPartitionDay == today {
		return
	}
	// NginxionS: the indexes of the statistics queries (see CreateIndexes), once per start of the service
	if !qa.indexesCreated {
		qa.indexesCreated = true
		for _, stmt := range qa.genQuery.CreateIndexes(message.TenantID) {
			if _, err := executeStmt(ctx, conn, stmt, nil); err != nil {
				log.WithContext(ctx).Warnf("failed to create an index, err: %v", err)
			}
		}
	}
	if message.Log == nil {
		return
	}
	next := *message
	nextLog := *message.Log
	nextLog.EventTime = now.AddDate(0, 0, 1).Format("2006-01-02T15:04:05.000")
	next.Log = &nextLog
	if err := qa.createTablePartition(ctx, conn, &next); err != nil {
		log.WithContext(ctx).Warnf("failed to create the partition of the next day ahead, err: %v", err)
		return
	}
	qa.nextPartitionDay = today
}

func (qa *Adapter) createTable(ctx context.Context, conn driver.Conn, message *models.AgentMessage) error {
	createStmt, err := qa.genQuery.CreateTable(message.TenantID)
	if err != nil {
		return err
	}
	_, err = executeStmt(ctx, conn, createStmt, nil)
	if err != nil {
		log.WithContext(ctx).Infof("failed to create table, err: %v", err)
		if qa.genQuery.ParseError(err) == errors.ClassNotFound {
			err = qa.createDB(ctx)
			if err != nil {
				return errors.Wrap(err, "failed to create database")
			}
			_, err = executeStmt(ctx, conn, createStmt, nil)
		} else {
			err = errors.Wrapf(err, "failed to create table")
		}
	}
	return err
}

func (qa *Adapter) createDB(ctx context.Context) error {
	stmt := qa.genQuery.CreateDatabase()

	dbHost, err := qa.config.GetString(confKeyQueryDBHost)
	if err != nil {
		return err
	}

	dbPort, err := qa.config.GetString(confKeyQueryDBPort)
	if err != nil {
		return err
	}

	dbUser, err := qa.config.GetString(confKeyQueryDBUser)
	if err != nil {
		return err
	}

	pass, err := qa.config.GetString(confKeyQueryDBPass)
	if err != nil {
		return err
	}

	sslMode, err := qa.config.GetString(confKeyQueryDBSSLMode)
	if err != nil {
		return err
	}

	rootConn := postgresURL(dbUser, pass, dbHost, dbPort, "", sslMode) // NginxionS: escaped, see NewAdapter

	conn, err := qa.driver.Open(rootConn)
	if err != nil {
		return errors.Wrap(err, "failed to open connection as root user")
	}
	// NginxionS: closed (it was left to the GC)
	defer conn.Close()
	log.WithContext(ctx).Infof("run stmt: %v", stmt)
	_, err = executeStmt(ctx, conn, stmt, nil)
	return err
}

// NginxionS: the connections of the adapter. Every operation opened a connection with driver.Open and closed
// neither it nor its statements and rows (openappsec/smartsync-tuning, "Connection leak in query Adapter"): only the
// GC closed them, and under load the open connections reached max_connections of Postgres ("too many clients
// already"), every write and query failing meanwhile. A connection is now taken from a small pool of idle ones and
// given back after use, at most maxIdleConns stay open while idle.

const maxIdleConns = 8

// getConn: an idle connection (pooled) or a new one. With createDB, a failed open creates the database and opens
// again: the first logs come in parallel; when another writer created the database first, this one gets
// "duplicate key ... pg_database_datname_index". The database exists then: it is opened.
func (qa *Adapter) getConn(ctx context.Context, createDB bool) (driver.Conn, bool, error) {
	qa.idleLock.Lock()
	for n := len(qa.idle); n > 0; n = len(qa.idle) {
		conn := qa.idle[n-1]
		qa.idle = qa.idle[:n-1]
		if v, ok := conn.(driver.Validator); ok && !v.IsValid() {
			_ = conn.Close()
			continue
		}
		qa.idleLock.Unlock()
		return conn, true, nil
	}
	qa.idleLock.Unlock()
	conn, err := qa.driver.Open(qa.dbName)
	if err != nil && createDB {
		if errCreateDB := qa.createDB(ctx); errCreateDB != nil {
			log.WithContext(ctx).Warnf("failed to create db (another writer may have), err: %v", errCreateDB)
		}
		conn, err = qa.driver.Open(qa.dbName)
	}
	if err != nil {
		return nil, false, errors.Wrap(err, "failed to open connection to SQL server")
	}
	return conn, false, nil
}

// putConn gives a connection back to the idle ones, or closes it when broken or when enough are idle
func (qa *Adapter) putConn(conn driver.Conn, err error) {
	broken := stderrors.Is(err, driver.ErrBadConn)
	if v, ok := conn.(driver.Validator); ok && !v.IsValid() {
		broken = true
	}
	if !broken {
		qa.idleLock.Lock()
		if !qa.closed && len(qa.idle) < maxIdleConns {
			qa.idle = append(qa.idle, conn)
			qa.idleLock.Unlock()
			return
		}
		qa.idleLock.Unlock()
	}
	_ = conn.Close()
}

// withConn runs fn on a connection and gives it back. A pooled connection found broken (driver.ErrBadConn, nothing
// was sent: the server restarted, it closed an idle session) is dropped and fn runs again on another.
func (qa *Adapter) withConn(ctx context.Context, createDB bool, fn func(conn driver.Conn) error) error {
	for attempt := 0; ; attempt++ {
		conn, pooled, err := qa.getConn(ctx, createDB)
		if err != nil {
			return err
		}
		err = fn(conn)
		qa.putConn(conn, err)
		if pooled && attempt <= maxIdleConns && stderrors.Is(err, driver.ErrBadConn) {
			continue
		}
		return err
	}
}

// idleConns: the idle connections (tests)
func (qa *Adapter) idleConns() []driver.Conn {
	qa.idleLock.Lock()
	defer qa.idleLock.Unlock()
	return append([]driver.Conn(nil), qa.idle...)
}

// Close closes the idle connections; the connections in use are closed when given back
func (qa *Adapter) Close() {
	qa.idleLock.Lock()
	idle := qa.idle
	qa.idle = nil
	qa.closed = true
	qa.idleLock.Unlock()
	for _, conn := range idle {
		_ = conn.Close()
	}
}

// postgresURL: the connection URL of lib/pq, user and password escaped
func postgresURL(user, pass, host, port, database, sslMode string) string {
	u := url.URL{Scheme: "postgres", User: url.UserPassword(user, pass), Host: net.JoinHostPort(host, port),
		Path: "/" + database, RawQuery: url.Values{"sslmode": {sslMode}}.Encode()}
	return u.String()
}

// memRows: rows read in memory (runQuery)
type memRows struct {
	columns []string
	rows    [][]driver.Value
}

func readRows(rows driver.Rows) (*memRows, error) {
	m := &memRows{columns: rows.Columns()}
	for {
		row := make([]driver.Value, len(m.columns))
		err := rows.Next(row)
		if err == io.EOF {
			return m, nil
		}
		if err != nil {
			return nil, err
		}
		// a driver may reuse the memory of []byte values on the next row
		for i, v := range row {
			if b, ok := v.([]byte); ok {
				row[i] = append([]byte(nil), b...)
			}
		}
		m.rows = append(m.rows, row)
	}
}

func (m *memRows) Columns() []string { return m.columns }
func (m *memRows) Close() error      { m.rows = nil; return nil }
func (m *memRows) Next(dest []driver.Value) error {
	if len(m.rows) == 0 {
		return io.EOF
	}
	copy(dest, m.rows[0])
	m.rows = m.rows[1:]
	return nil
}
