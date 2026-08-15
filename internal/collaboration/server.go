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
	CollaborationAccess(context.Context, string, string) (bool, string, error)
}

type Participant struct {
	UserID   string `json:"userId"`
	ReadOnly bool   `json:"readOnly"`
}

type Server interface {
	Handler() http.Handler
	Flush(context.Context, string) error
	Delete(context.Context, string) error
	OnlineUsers() int
	EditorCounts(string, string) (int, int, int)
	Participants(string) []Participant
	Close(context.Context) error
}

type server struct {
	inner  *ygoserver.Server
	store  persist.Store
	online *onlineTracker
}
type onlineTracker struct {
	sync.Mutex
	connections map[string]connection
}
type connection struct {
	userID, docName, projectID string
	readOnly                   bool
}

func New(store persist.Store, auth Authenticator, logger *slog.Logger) Server {
	if logger == nil {
		logger = slog.Default()
	}
	online := &onlineTracker{connections: map[string]connection{}}
	var access sync.Map
	var admission sync.Mutex
	s := ygoserver.New(ygoserver.Options{
		Store:          store,
		DocNameFn:      func(r *http.Request) string { return strings.TrimPrefix(r.URL.Path, "/api/collaboration/") },
		OriginPatterns: []string{"*"},
		ReadLimit:      32 << 20,
		MaxConnsPerDoc: 10000,
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
			admission.Lock()
			defer admission.Unlock()
			readOnly, projectID, err := auth.CollaborationAccess(r.Context(), docName, userID)
			if err != nil {
				return err
			}
			access.Store(r, readOnly)
			logger.Info("collaboration connected", "drawing", docName, "connection", connID, "readOnly", readOnly)
			// The server value is assigned just below before any connection can
			// reach this callback.
			online.Lock()
			online.connections[connID] = connection{userID: userID, docName: docName, projectID: projectID, readOnly: readOnly}
			online.Unlock()
			return nil
		},
		ReadOnly: func(_ string, r *http.Request) bool { value, ok := access.LoadAndDelete(r); return !ok || value.(bool) },
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
	for _, connection := range s.online.connections {
		users[connection.userID] = struct{}{}
	}
	return len(users)
}
func (s *server) EditorCounts(docName, projectID string) (int, int, int) {
	s.online.Lock()
	defer s.online.Unlock()
	docUsers, projectUsers, globalUsers := map[string]struct{}{}, map[string]struct{}{}, map[string]struct{}{}
	for _, item := range s.online.connections {
		if item.readOnly {
			continue
		}
		globalUsers[item.userID] = struct{}{}
		if item.docName == docName {
			docUsers[item.userID] = struct{}{}
		}
		if projectID != "" && item.projectID == projectID {
			projectUsers[item.userID] = struct{}{}
		}
	}
	return len(docUsers), len(projectUsers), len(globalUsers)
}
func (s *server) Participants(docName string) []Participant {
	s.online.Lock()
	defer s.online.Unlock()
	unique := map[string]Participant{}
	for _, item := range s.online.connections {
		if item.docName == docName {
			current, ok := unique[item.userID]
			if !ok || current.ReadOnly {
				unique[item.userID] = Participant{UserID: item.userID, ReadOnly: item.readOnly}
			}
		}
	}
	out := make([]Participant, 0, len(unique))
	for _, item := range unique {
		out = append(out, item)
	}
	return out
}
func (s *server) Close(ctx context.Context) error { return s.inner.Close(ctx) }
