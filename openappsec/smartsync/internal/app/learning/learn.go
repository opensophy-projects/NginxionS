 

package learning

import (
	"context"

	"openappsec.io/smartsync-service/models"
)

// LearnCore struct
type LearnCore struct {
	repo Repository
	lock MultiplePodsLock
}

// mockgen -destination mocks/mock_repository.go -package mocks openappsec.io/smartsync-service/internal/app/learning Repository

// Repository defines interface to a repository
type Repository interface {
	GetFile(ctx context.Context, tenantID string, path string, out interface{}) (bool, error)
	GetFileRaw(ctx context.Context, tenantID string, path string) ([]byte, bool, error)
	PostFile(ctx context.Context, tenantID string, path string, compress bool, data interface{}) error
	GetFilesList(ctx context.Context, id models.SyncID) ([]string, error)
}

// MultiplePodsLock defines a distributed lock
type MultiplePodsLock interface {
	Lock(ctx context.Context, key string) bool
	Unlock(ctx context.Context, key string) error
}

// NewLearnService returns a new instance of a demo service.
func NewLearnService(repository Repository, lock MultiplePodsLock) (*LearnCore, error) {
	return &LearnCore{repo: repository, lock: lock}, nil
}
