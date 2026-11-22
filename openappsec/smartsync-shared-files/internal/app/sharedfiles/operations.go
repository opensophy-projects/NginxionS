package sharedfiles

import (
	"context"

	"openappsec.io/log"
	"openappsec.io/smartsync-shared-files/internal/models"
)

// GetFilesList list files in repo
func (svc *Service) GetFilesList(ctx context.Context, pathPrefix string) ([]models.FileMetadata, error) {
	return svc.fs.GetFilesList(ctx, pathPrefix)
}

// GetFile get file content from repo
func (svc *Service) GetFile(ctx context.Context, path string) ([]byte, error) {
	return svc.fs.GetFile(ctx, path)
}

// PutFile stores file in repo
func (svc *Service) PutFile(ctx context.Context, path string, content []byte) error {
	isTemp := models.IsTempFile(path)
	log.WithContext(ctx).Debugf("put file %v in storage, is temp: %v", path, isTemp)
	return svc.fs.PutFile(ctx, path, content, isTemp)
}

// DeleteClusterFile removes a merged learning file during snapshot restore.
func (svc *Service) DeleteClusterFile(ctx context.Context, path string) error {
	log.WithContext(ctx).Debugf("delete merged learning file: %v", path)
	return svc.fs.DeleteClusterFile(path)
}
