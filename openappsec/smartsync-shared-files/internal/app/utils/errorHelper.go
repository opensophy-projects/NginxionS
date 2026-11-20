 

package utils

import (
	"context"
	"net/http"

	"openappsec.io/ctxutils"
	"openappsec.io/errors/errorloader"
	"openappsec.io/log"
)

// CreateErrorBody loads the error body from the location of err-responses.json file
func CreateErrorBody(ctx context.Context, errorName string) string {
	errorResponse, err := errorloader.GetError(ctx, errorName)
	if err != nil {
		log.WithContext(ctx).Errorf("Failed to create error body, using default. Error: %s", err.Error())
		traceID := ctxutils.ExtractString(ctx, ctxutils.ContextKeyEventTraceID)
		errorBody := errorloader.NewErrorResponse(traceID, http.StatusText(http.StatusInternalServerError))
		return (&errorBody).Error()
	}

	return errorResponse.Error()
}
