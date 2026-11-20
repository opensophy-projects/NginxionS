 

package sharedfiles

import (
	"context"

	"openappsec.io/smartsync-shared-files/internal/models"
)

// FileSystem exposes an interface for fs service operations
// To create mock for unittest please use this command
// mockgen -destination mocks/mock_FileSystem.go -package mocks openappsec.io/smartsync-shared-files/internal/app/sharedfiles FileSystem
type FileSystem interface {
	GetFilesList(ctx context.Context, pathPrefix string) ([]models.FileMetadata, error)
	GetFile(ctx context.Context, path string) ([]byte, error)
	PutFile(ctx context.Context, path string, content []byte, isTemp bool) error
}

// Service struct
type Service struct {
	fs FileSystem
}

// NewSharedFilesService returns a new instance of a demo service.
func NewSharedFilesService(fs FileSystem) (*Service, error) {
	return &Service{fs: fs}, nil
}
