 

package models

import (
	"strings"
	"time"
)

// FileMetadata contains the path and last modified timestamp
type FileMetadata struct {
	Path         string
	LastModified time.Time
}

// IsTempFile return true if a file is safe to delete
func IsTempFile(path string) bool {
	return !(strings.Contains(path, "/remote/") ||
		strings.Contains(path, "/processed/") ||
		strings.Contains(path, "/tuning") ||
		strings.Contains(path, "attributes.data"))
}
