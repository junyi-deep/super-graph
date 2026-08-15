package collaboration

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"github.com/Deln0r/ygo/persist"
	ygoserver "github.com/Deln0r/ygo/server"
)

type Authenticator interface {
	AuthenticateRequest(*http.Request) (string, error)
	DrawingExists(context.Context, string) (bool, error)
}

type Server interface {
	Handler() http.Handler
	Flush(context.Context, string) error
	Delete(context.Context, string) error
	OnlineUsers() int
	Close(context.Context) error
}

type server struct {
	inner  *ygoserver.Server
	store  persist.Store
	online *onlineTracker
}
type onlineTracker struct {
	sync.Mutex
	connections map[string]string
}

func New(store persist.Store, auth Authenticator, logger *slog.Logger) Server {
	if logger == nil {
		logger = slog.Default()
	}
	online := &onlineTracker{connections: map[string]string{}}
	s := ygoserver.New(ygoserver.Options{
		Store:          store,
		DocNameFn:      func(r *http.Request) string { return strings.TrimPrefix(r.URL.Path, "/api/collaboration/") },
		OriginPatterns: []string{"*"},
		ReadLimit:      32 << 20,
		MaxConnsPerDoc: 128,
		MaxDocs:        10000,
		OnConnect: func(connID string, docName string, r *http.Request) error {
			userID, err := auth.AuthenticateRequest(r)
			if err != nil {
				return err
			}
			ok, err := auth.DrawingExists(r.Context(), docName)
			if err != nil {
				return err
			}
			if !ok {
				return errors.New("drawing not found")
			}
			logger.Info("collaboration connected", "drawing", docName, "connection", connID)
			// The server value is assigned just below before any connection can
			// reach this callback.
			online.Lock()
			online.connections[connID] = userID
			online.Unlock()
			return nil
		},
		OnDisconnect: func(connID, docName string) {
			online.Lock()
			delete(online.connections, connID)
			online.Unlock()
			logger.Info("collaboration disconnected", "drawing", docName, "connection", connID)
		},
	})
	return &server{inner: s, store: store, online: online}
}

func (s *server) Handler() http.Handler                        { return s.inner.Handler() }
func (s *server) Flush(ctx context.Context, name string) error { return s.inner.Flush(ctx, name) }
func (s *server) Delete(ctx context.Context, name string) error {
	if s.store == nil {
		return nil
	}
	return s.store.ClearDocument(ctx, name)
}
func (s *server) OnlineUsers() int {
	s.online.Lock()
	defer s.online.Unlock()
	users := map[string]struct{}{}
	for _, userID := range s.online.connections {
		users[userID] = struct{}{}
	}
	return len(users)
}
func (s *server) Close(ctx context.Context) error { return s.inner.Close(ctx) }
