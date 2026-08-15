package app

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log/slog"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/junyi-deep/super-graph/internal/collaboration"
	"github.com/junyi-deep/super-graph/internal/frontend"
	"github.com/oklog/ulid/v2"
	_ "modernc.org/sqlite"
)

const (
	emptyScene   = `{"elements":[],"appState":{},"files":{}}`
	emptyMermaid = `{"code":"flowchart TD\n  A[开始] --> B[完成]","theme":"default"}`
)

var (
	drawingIDPattern = regexp.MustCompile(`^[0-9A-HJKMNP-TV-Z]{26}$`)
	usernamePattern  = regexp.MustCompile(`^[\pL\pN_.-]{1,64}$`)
)

type Config struct {
	DataDir             string
	SessionDays         int
	AutosaveInterval    time.Duration
	MaxUploadSize       int64
	ConfigPath          string
	AdminPassword       string
	MaxDocumentEditors  int
	MaxProjectEditors   int
	MaxGlobalEditors    int
	DefaultDrawingLimit int
}

type GlobalSettings struct {
	MaxDocumentEditors  int `json:"maxDocumentEditors"`
	MaxProjectEditors   int `json:"maxProjectEditors"`
	MaxGlobalEditors    int `json:"maxGlobalEditors"`
	DefaultDrawingLimit int `json:"defaultDrawingLimit"`
}

type App struct {
	db            *sql.DB
	cfg           Config
	imagesDir     string
	log           *slog.Logger
	collab        collaboration.Server
	static        http.Handler
	settingsMu    sync.RWMutex
	settings      GlobalSettings
	adminPassword string
}

type User struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	IsAdmin  bool   `json:"isAdmin"`
	Blocked  bool   `json:"blocked"`
}
type Drawing struct {
	ID                   string          `json:"id"`
	Name                 string          `json:"name"`
	Owner                User            `json:"owner"`
	UpdatedBy            *User           `json:"updatedBy"`
	Scene                json.RawMessage `json:"scene,omitempty"`
	CreatedAt            int64           `json:"createdAt"`
	UpdatedAt            int64           `json:"updatedAt"`
	CanDelete            bool            `json:"canDelete"`
	ImageURL             string          `json:"imageUrl"`
	Space                string          `json:"space"`
	FolderID             *string         `json:"folderId"`
	ProjectID            *string         `json:"projectId"`
	Type                 string          `json:"type"`
	Favorite             bool            `json:"favorite"`
	CollaborationEnabled bool            `json:"collaborationEnabled"`
	CollaboratorLimit    int             `json:"collaboratorLimit"`
	CanEdit              bool            `json:"canEdit"`
	SortOrder            float64         `json:"sortOrder"`
}

func Open(cfg Config, logger *slog.Logger) (*App, error) {
	if cfg.DataDir == "" {
		cfg.DataDir = "./data"
	}
	if cfg.SessionDays <= 0 {
		cfg.SessionDays = 30
	}
	if cfg.AutosaveInterval <= 0 {
		cfg.AutosaveInterval = 3 * time.Second
	}
	if cfg.MaxUploadSize <= 0 {
		cfg.MaxUploadSize = 32 << 20
	}
	if cfg.AdminPassword == "" {
		cfg.AdminPassword = "admin123456"
	}
	if cfg.MaxDocumentEditors <= 0 {
		cfg.MaxDocumentEditors = 32
	}
	if cfg.MaxProjectEditors <= 0 {
		cfg.MaxProjectEditors = 128
	}
	if cfg.MaxGlobalEditors <= 0 {
		cfg.MaxGlobalEditors = 512
	}
	if cfg.DefaultDrawingLimit <= 0 || cfg.DefaultDrawingLimit > cfg.MaxDocumentEditors {
		cfg.DefaultDrawingLimit = min(16, cfg.MaxDocumentEditors)
	}
	if logger == nil {
		logger = slog.Default()
	}
	images := filepath.Join(cfg.DataDir, "images")
	if err := os.MkdirAll(images, 0o750); err != nil {
		return nil, fmt.Errorf("create data directory: %w", err)
	}
	db, err := sql.Open("sqlite", filepath.Join(cfg.DataDir, "app.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err = migrate(db); err != nil {
		db.Close()
		return nil, err
	}
	if err = initializeUsers(db); err != nil {
		db.Close()
		return nil, err
	}
	dist, err := fs.Sub(frontend.Dist, "dist")
	if err != nil {
		db.Close()
		return nil, err
	}
	return &App{db: db, cfg: cfg, imagesDir: images, log: logger, static: http.FileServer(http.FS(dist)), adminPassword: cfg.AdminPassword, settings: GlobalSettings{MaxDocumentEditors: cfg.MaxDocumentEditors, MaxProjectEditors: cfg.MaxProjectEditors, MaxGlobalEditors: cfg.MaxGlobalEditors, DefaultDrawingLimit: cfg.DefaultDrawingLimit}}, nil
}

func (a *App) SetCollaboration(s collaboration.Server) { a.collab = s }
func (a *App) DB() *sql.DB                             { return a.db }
func (a *App) Close() error                            { return a.db.Close() }

func migrate(db *sql.DB) error {
	const schema = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;
PRAGMA busy_timeout=5000;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE IF NOT EXISTS drawings (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, scene_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT, FOREIGN KEY(owner_id) REFERENCES users(id), FOREIGN KEY(updated_by) REFERENCES users(id));
CREATE INDEX IF NOT EXISTS idx_drawings_owner ON drawings(owner_id);
CREATE INDEX IF NOT EXISTS idx_drawings_updated ON drawings(updated_at DESC);
INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (1, unixepoch());`
	if _, err := db.Exec(schema); err != nil {
		return err
	}
	const v2 = `
CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE folders (id TEXT PRIMARY KEY, name TEXT NOT NULL, space_type TEXT NOT NULL CHECK(space_type IN ('user','project')), user_id TEXT, project_id TEXT, parent_id TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE RESTRICT, FOREIGN KEY(created_by) REFERENCES users(id));
CREATE TABLE activity_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, last_seen_at INTEGER NOT NULL, PRIMARY KEY(user_id,day), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
ALTER TABLE drawings ADD COLUMN space_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE drawings ADD COLUMN folder_id TEXT REFERENCES folders(id);
ALTER TABLE drawings ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX idx_folders_parent ON folders(parent_id);
CREATE INDEX idx_folders_user ON folders(user_id);
CREATE INDEX idx_folders_project ON folders(project_id);
CREATE INDEX idx_drawings_folder ON drawings(folder_id);
CREATE INDEX idx_drawings_project ON drawings(project_id);
INSERT INTO schema_migrations(version, applied_at) VALUES (2, unixepoch());`
	if err := applyMigration(db, 2, v2); err != nil {
		return err
	}
	const v3 = `
ALTER TABLE drawings ADD COLUMN drawing_type TEXT NOT NULL DEFAULT 'excalidraw' CHECK(drawing_type IN ('excalidraw','mermaid'));
CREATE INDEX idx_drawings_type ON drawings(drawing_type);
INSERT INTO schema_migrations(version, applied_at) VALUES (3, unixepoch());`
	if err := applyMigration(db, 3, v3); err != nil {
		return err
	}
	const v4 = `
ALTER TABLE users ADD COLUMN password_salt TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
ALTER TABLE folders ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
ALTER TABLE drawings ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
ALTER TABLE drawings ADD COLUMN collaboration_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE drawings ADD COLUMN collaborator_limit INTEGER NOT NULL DEFAULT 16;
CREATE TABLE favorites (user_id TEXT NOT NULL, drawing_id TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,drawing_id), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE, FOREIGN KEY(drawing_id) REFERENCES drawings(id) ON DELETE CASCADE);
CREATE TABLE drawing_permissions (drawing_id TEXT NOT NULL, user_id TEXT NOT NULL, can_edit INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(drawing_id,user_id), FOREIGN KEY(drawing_id) REFERENCES drawings(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE drawing_activity (id INTEGER PRIMARY KEY AUTOINCREMENT, drawing_id TEXT NOT NULL, user_id TEXT NOT NULL, changed_at INTEGER NOT NULL, FOREIGN KEY(drawing_id) REFERENCES drawings(id) ON DELETE CASCADE, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE INDEX idx_drawing_activity_recent ON drawing_activity(drawing_id,changed_at DESC);
INSERT INTO schema_migrations(version, applied_at) VALUES (4, unixepoch());`
	return applyMigration(db, 4, v4)
}

func applyMigration(db *sql.DB, version int, statements string) error {
	var applied int
	if err := db.QueryRow(`SELECT count(*) FROM schema_migrations WHERE version=?`, version).Scan(&applied); err != nil || applied > 0 {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if _, err = tx.Exec(statements); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (a *App) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if v := recover(); v != nil {
			a.log.Error("http panic", "error", v)
			writeError(w, 500, "internal server error")
		}
	}()
	p := r.URL.Path
	switch {
	case p == "/api/login" && r.Method == http.MethodPost:
		a.login(w, r)
	case p == "/api/logout" && r.Method == http.MethodPost:
		a.withUser(w, r, a.logout)
	case p == "/api/me" && r.Method == http.MethodGet:
		a.withUser(w, r, a.me)
	case p == "/api/password" && r.Method == http.MethodPatch:
		a.withUser(w, r, a.changePassword)
	case p == "/api/config" && r.Method == http.MethodGet:
		a.config(w, r)
	case p == "/api/admin/settings":
		a.withUser(w, r, a.adminSettings)
	case strings.HasPrefix(p, "/api/admin/users/"):
		a.withUser(w, r, func(w http.ResponseWriter, r *http.Request, u User) {
			a.adminUserRoute(w, r, u, strings.TrimPrefix(p, "/api/admin/users/"))
		})
	case p == "/api/users" && r.Method == http.MethodGet:
		a.withUser(w, r, a.users)
	case p == "/api/tree" && r.Method == http.MethodGet:
		a.withUser(w, r, a.tree)
	case p == "/api/tree/reorder" && r.Method == http.MethodPatch:
		a.withUser(w, r, a.reorderTree)
	case p == "/api/stats" && r.Method == http.MethodGet:
		a.withUser(w, r, a.stats)
	case p == "/api/folders" && r.Method == http.MethodPost:
		a.withUser(w, r, a.createFolder)
	case strings.HasPrefix(p, "/api/folders/"):
		a.folderRoute(w, r)
	case p == "/api/projects" && r.Method == http.MethodPost:
		a.withUser(w, r, a.createProject)
	case strings.HasPrefix(p, "/api/projects/"):
		a.projectRoute(w, r)
	case p == "/api/drawings" && r.Method == http.MethodGet:
		a.withUser(w, r, a.listDrawings)
	case p == "/api/drawings" && r.Method == http.MethodPost:
		a.withUser(w, r, a.createDrawing)
	case strings.HasPrefix(p, "/api/drawings/"):
		a.drawingRoute(w, r)
	case strings.HasPrefix(p, "/api/collaboration/") && a.collab != nil:
		a.collab.Handler().ServeHTTP(w, r)
	case strings.HasPrefix(p, "/image/") && (r.Method == http.MethodGet || r.Method == http.MethodHead):
		a.image(w, r)
	case r.Method == http.MethodGet || r.Method == http.MethodHead:
		a.serveSPA(w, r)
	default:
		writeError(w, http.StatusNotFound, "not found")
	}
}

type userHandler func(http.ResponseWriter, *http.Request, User)

func (a *App) withUser(w http.ResponseWriter, r *http.Request, next userHandler) {
	u, err := a.currentUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "login required")
		return
	}
	a.touchActivity(r.Context(), u.ID)
	next(w, r, u)
}
func requestScheme(r *http.Request) string {
	if r.TLS != nil || strings.EqualFold(firstForwardedValue(r.Header.Get("X-Forwarded-Proto")), "https") {
		return "https"
	}
	return "http"
}

func firstForwardedValue(value string) string {
	value, _, _ = strings.Cut(value, ",")
	return strings.Trim(strings.TrimSpace(value), `"`)
}

func (a *App) AuthenticateRequest(r *http.Request) (string, error) {
	u, e := a.currentUser(r)
	return u.ID, e
}
func (a *App) DrawingExists(ctx context.Context, id string) (bool, error) {
	if !drawingIDPattern.MatchString(id) {
		return false, nil
	}
	var n int
	e := a.db.QueryRowContext(ctx, "SELECT count(*) FROM drawings WHERE id=?", id).Scan(&n)
	return n == 1, e
}

func (a *App) currentUser(r *http.Request) (User, error) {
	c, err := r.Cookie("draw_session")
	if err != nil {
		return User{}, err
	}
	var u User
	err = a.db.QueryRowContext(r.Context(), `SELECT u.id,u.username,u.is_admin,u.blocked FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.blocked=0`, c.Value, time.Now().Unix()).Scan(&u.ID, &u.Username, &u.IsAdmin, &u.Blocked)
	return u, err
}

func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if !usernamePattern.MatchString(in.Username) {
		writeError(w, 400, "username must be 1-64 letters, numbers, _, . or -")
		return
	}
	now := time.Now().Unix()
	var u User
	var salt, digest string
	err := a.db.QueryRowContext(r.Context(), "SELECT id,username,is_admin,blocked,password_salt,password_hash FROM users WHERE username=?", in.Username).Scan(&u.ID, &u.Username, &u.IsAdmin, &u.Blocked, &salt, &digest)
	if errors.Is(err, sql.ErrNoRows) {
		if in.Username == "admin" || in.Password != defaultUserPassword {
			writeError(w, http.StatusUnauthorized, "首次登录请使用默认密码 123456")
			return
		}
		u = User{ID: newID(), Username: in.Username}
		salt, digest, err = newPassword(defaultUserPassword)
		if err == nil {
			_, err = a.db.ExecContext(r.Context(), "INSERT INTO users(id,username,created_at,last_seen_at,password_salt,password_hash) VALUES(?,?,?,?,?,?)", u.ID, u.Username, now, now, salt, digest)
		}
	}
	if err != nil {
		writeError(w, 500, "login failed")
		return
	}
	if u.Blocked {
		writeError(w, http.StatusForbidden, "账号已被管理员拉黑")
		return
	}
	if u.IsAdmin {
		a.settingsMu.RLock()
		expected := a.adminPassword
		a.settingsMu.RUnlock()
		if subtleConstantCompare(in.Password, expected) == false {
			writeError(w, http.StatusUnauthorized, "用户名或密码错误")
			return
		}
	} else if !passwordMatches(in.Password, salt, digest) {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	_, _ = a.db.ExecContext(r.Context(), "UPDATE users SET last_seen_at=? WHERE id=?", now, u.ID)
	token, err := randomToken()
	if err != nil {
		writeError(w, 500, "login failed")
		return
	}
	expires := time.Now().Add(time.Duration(a.cfg.SessionDays) * 24 * time.Hour)
	if _, err = a.db.ExecContext(r.Context(), "INSERT INTO sessions(id,user_id,expires_at,created_at) VALUES(?,?,?,?)", token, u.ID, expires.Unix(), now); err != nil {
		writeError(w, 500, "login failed")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: "draw_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: requestScheme(r) == "https", Expires: expires})
	a.log.Info("login", "username", u.Username)
	a.touchActivity(r.Context(), u.ID)
	writeJSON(w, 200, u)
}
func (a *App) logout(w http.ResponseWriter, r *http.Request, u User) {
	if c, e := r.Cookie("draw_session"); e == nil {
		_, _ = a.db.ExecContext(r.Context(), "DELETE FROM sessions WHERE id=?", c.Value)
	}
	http.SetCookie(w, &http.Cookie{Name: "draw_session", Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	w.WriteHeader(204)
}
func (a *App) me(w http.ResponseWriter, r *http.Request, u User) { writeJSON(w, 200, u) }
func (a *App) config(w http.ResponseWriter, r *http.Request) {
	a.settingsMu.RLock()
	maxEditors := a.settings.MaxDocumentEditors
	a.settingsMu.RUnlock()
	writeJSON(w, 200, map[string]any{"autosaveIntervalMs": a.cfg.AutosaveInterval.Milliseconds(), "maxUploadSize": a.cfg.MaxUploadSize, "maxDocumentEditors": maxEditors})
}
func (a *App) users(w http.ResponseWriter, r *http.Request, u User) {
	rows, e := a.db.QueryContext(r.Context(), "SELECT id,username,is_admin,blocked FROM users ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,username", u.ID)
	if e != nil {
		writeError(w, 500, "query failed")
		return
	}
	defer rows.Close()
	out := []User{}
	for rows.Next() {
		var x User
		if rows.Scan(&x.ID, &x.Username, &x.IsAdmin, &x.Blocked) == nil {
			out = append(out, x)
		}
	}
	writeJSON(w, 200, out)
}

func (a *App) createDrawing(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Name        string  `json:"name"`
		Space       string  `json:"space"`
		FolderID    *string `json:"folderId"`
		ProjectID   *string `json:"projectId"`
		Type        string  `json:"type"`
		MermaidCode string  `json:"mermaidCode"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(in.Name) < 1 || len(in.Name) > 200 {
		writeError(w, 400, "name must be 1-200 characters")
		return
	}
	if in.Space == "" {
		in.Space = "user"
	}
	if in.Type == "" {
		in.Type = "excalidraw"
	}
	if in.Type != "excalidraw" && in.Type != "mermaid" {
		writeError(w, 400, "不支持的图表类型")
		return
	}
	if err := a.validateDrawingLocation(r.Context(), u, in.Space, in.FolderID, in.ProjectID); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	id := newID()
	now := time.Now().UnixMilli()
	content := emptyScene
	if in.Type == "mermaid" {
		content = emptyMermaid
		if code := strings.TrimSpace(in.MermaidCode); code != "" {
			if len(code) > 1<<20 {
				writeError(w, 400, "Mermaid 源码过长")
				return
			}
			document, err := json.Marshal(map[string]string{"code": code, "theme": "default"})
			if err != nil {
				writeError(w, 500, "create failed")
				return
			}
			content = string(document)
		}
	}
	a.settingsMu.RLock()
	defaultLimit := a.settings.DefaultDrawingLimit
	a.settingsMu.RUnlock()
	if exists, _ := a.drawingNameExists(r.Context(), in.Name, in.Space, u.ID, in.ProjectID, in.FolderID, ""); exists {
		writeError(w, 409, "目标位置已存在同名文件，请修改名称")
		return
	}
	order := a.nextDrawingOrder(r.Context(), in.Space, u.ID, in.ProjectID, in.FolderID)
	_, e := a.db.ExecContext(r.Context(), "INSERT INTO drawings(id,owner_id,name,scene_json,created_at,updated_at,updated_by,space_type,folder_id,project_id,drawing_type,collaborator_limit,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", id, u.ID, in.Name, content, now, now, u.ID, in.Space, in.FolderID, in.ProjectID, in.Type, defaultLimit, order)
	if e != nil {
		writeError(w, 500, "create failed")
		return
	}
	a.log.Info("drawing created", "drawing", id, "owner", u.Username)
	writeJSON(w, 201, Drawing{ID: id, Name: in.Name, Owner: u, UpdatedBy: &u, Scene: json.RawMessage(content), CreatedAt: now, UpdatedAt: now, CanDelete: true, CanEdit: true, ImageURL: "/image/" + id + ".png", Space: in.Space, FolderID: in.FolderID, ProjectID: in.ProjectID, Type: in.Type, CollaborationEnabled: true, CollaboratorLimit: defaultLimit, SortOrder: order})
}

const drawingSelect = `SELECT d.id,d.name,d.scene_json,d.created_at,d.updated_at,o.id,o.username,o.is_admin,o.blocked,ub.id,ub.username,ub.is_admin,ub.blocked,d.space_type,d.folder_id,d.project_id,d.drawing_type,d.collaboration_enabled,d.collaborator_limit,EXISTS(SELECT 1 FROM favorites fav WHERE fav.drawing_id=d.id AND fav.user_id=?),d.sort_order FROM drawings d JOIN users o ON o.id=d.owner_id LEFT JOIN users ub ON ub.id=d.updated_by`

func scanDrawing(s interface{ Scan(...any) error }, current User) (Drawing, error) {
	var d Drawing
	var raw string
	var uid, uname sql.NullString
	var folderID, projectID sql.NullString
	var updatedAdmin, updatedBlocked sql.NullBool
	e := s.Scan(&d.ID, &d.Name, &raw, &d.CreatedAt, &d.UpdatedAt, &d.Owner.ID, &d.Owner.Username, &d.Owner.IsAdmin, &d.Owner.Blocked, &uid, &uname, &updatedAdmin, &updatedBlocked, &d.Space, &folderID, &projectID, &d.Type, &d.CollaborationEnabled, &d.CollaboratorLimit, &d.Favorite, &d.SortOrder)
	if e != nil {
		return d, e
	}
	d.Scene = json.RawMessage(raw)
	if uid.Valid {
		d.UpdatedBy = &User{ID: uid.String, Username: uname.String, IsAdmin: updatedAdmin.Bool, Blocked: updatedBlocked.Bool}
	}
	if folderID.Valid {
		d.FolderID = &folderID.String
	}
	if projectID.Valid {
		d.ProjectID = &projectID.String
	}
	d.CanDelete = d.Owner.ID == current.ID || current.IsAdmin
	d.CanEdit = true
	d.ImageURL = "/image/" + d.ID + ".png"
	return d, nil
}
func (a *App) listDrawings(w http.ResponseWriter, r *http.Request, u User) {
	query := drawingSelect
	args := []any{u.ID}
	if r.URL.Query().Get("mine") == "1" {
		query += ` WHERE d.updated_by=? OR EXISTS(SELECT 1 FROM favorites mine WHERE mine.drawing_id=d.id AND mine.user_id=?)`
		args = append(args, u.ID, u.ID)
	}
	query += " ORDER BY d.updated_at DESC"
	if r.URL.Query().Get("mine") == "1" {
		query += " LIMIT 100"
	}
	rows, e := a.db.QueryContext(r.Context(), query, args...)
	if e != nil {
		writeError(w, 500, "query failed")
		return
	}
	defer rows.Close()
	out := []Drawing{}
	for rows.Next() {
		d, e := scanDrawing(rows, u)
		if e != nil {
			writeError(w, 500, "query failed")
			return
		}
		d.Scene = nil
		out = append(out, d)
	}
	writeJSON(w, 200, out)
}
func (a *App) getDrawing(ctx context.Context, id string, u User) (Drawing, error) {
	return scanDrawing(a.db.QueryRowContext(ctx, drawingSelect+" WHERE d.id=?", u.ID, id), u)
}

func (a *App) drawingRoute(w http.ResponseWriter, r *http.Request) {
	u, e := a.currentUser(r)
	if e != nil {
		writeError(w, 401, "login required")
		return
	}
	rest := strings.TrimPrefix(r.URL.Path, "/api/drawings/")
	parts := strings.Split(rest, "/")
	id := parts[0]
	if !drawingIDPattern.MatchString(id) {
		writeError(w, 404, "drawing not found")
		return
	}
	if len(parts) == 2 && parts[1] == "autosave" && r.Method == http.MethodPut {
		a.autosave(w, r, u, id)
		return
	}
	if len(parts) == 2 && a.drawingOperationRoute(w, r, u, id, parts[1]) {
		return
	}
	if len(parts) != 1 {
		writeError(w, 404, "not found")
		return
	}
	switch r.Method {
	case http.MethodGet:
		d, e := a.getDrawing(r.Context(), id, u)
		if errors.Is(e, sql.ErrNoRows) {
			writeError(w, 404, "drawing not found")
			return
		}
		if e != nil {
			writeError(w, 500, "query failed")
			return
		}
		if readOnly, _, accessErr := a.CollaborationAccess(r.Context(), id, u.ID); accessErr == nil {
			d.CanEdit = !readOnly
		}
		writeJSON(w, 200, d)
	case http.MethodPatch:
		a.renameDrawing(w, r, u, id)
	case http.MethodDelete:
		a.deleteDrawing(w, r, u, id)
	default:
		w.Header().Set("Allow", "GET, PATCH, DELETE")
		writeError(w, 405, "method not allowed")
	}
}
func (a *App) renameDrawing(w http.ResponseWriter, r *http.Request, u User, id string) {
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(in.Name) < 1 || len(in.Name) > 200 {
		writeError(w, 400, "name must be 1-200 characters")
		return
	}
	drawing, err := a.getDrawing(r.Context(), id, u)
	if err != nil {
		writeError(w, 404, "drawing not found")
		return
	}
	if readOnly, _, accessErr := a.CollaborationAccess(r.Context(), id, u.ID); accessErr != nil || readOnly {
		writeError(w, http.StatusForbidden, "当前为只读状态，无法修改文件名")
		return
	}
	if exists, _ := a.drawingNameExists(r.Context(), in.Name, drawing.Space, drawing.Owner.ID, drawing.ProjectID, drawing.FolderID, id); exists {
		writeError(w, 409, "当前位置已存在同名文件")
		return
	}
	res, e := a.db.ExecContext(r.Context(), "UPDATE drawings SET name=?,updated_at=?,updated_by=? WHERE id=?", in.Name, time.Now().UnixMilli(), u.ID, id)
	if e != nil {
		writeError(w, 500, "rename failed")
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(w, 404, "drawing not found")
		return
	}
	d, _ := a.getDrawing(r.Context(), id, u)
	writeJSON(w, 200, d)
}
func (a *App) deleteDrawing(w http.ResponseWriter, r *http.Request, u User, id string) {
	d, e := a.getDrawing(r.Context(), id, u)
	if errors.Is(e, sql.ErrNoRows) {
		writeError(w, 404, "drawing not found")
		return
	}
	if e != nil {
		writeError(w, 500, "query failed")
		return
	}
	if !CanDelete(u, d) {
		writeError(w, 403, "only the owner can delete this drawing")
		return
	}
	if _, e = a.db.ExecContext(r.Context(), "DELETE FROM drawings WHERE id=?", id); e != nil {
		writeError(w, 500, "delete failed")
		return
	}
	if e = os.Remove(a.imagePath(id)); e != nil && !errors.Is(e, os.ErrNotExist) {
		a.log.Error("orphan image cleanup failed", "drawing", id, "error", e)
	}
	if a.collab != nil {
		if e = a.collab.Delete(r.Context(), id); e != nil {
			a.log.Error("collaboration cleanup failed", "drawing", id, "error", e)
		}
	}
	a.log.Info("drawing deleted", "drawing", id, "owner", u.Username)
	w.WriteHeader(204)
}

func CanView(_ User, _ Drawing) bool   { return true }
func CanEdit(_ User, _ Drawing) bool   { return true }
func CanDelete(u User, d Drawing) bool { return u.ID == d.Owner.ID || u.IsAdmin }

func (a *App) autosave(w http.ResponseWriter, r *http.Request, u User, id string) {
	drawing, e := a.getDrawing(r.Context(), id, u)
	if errors.Is(e, sql.ErrNoRows) {
		writeError(w, 404, "drawing not found")
		return
	} else if e != nil {
		writeError(w, 500, "query failed")
		return
	}
	readOnly, _, accessErr := a.CollaborationAccess(r.Context(), id, u.ID)
	if accessErr != nil || readOnly {
		writeError(w, http.StatusForbidden, "当前为只读状态，无法保存修改")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, a.cfg.MaxUploadSize)
	if e := r.ParseMultipartForm(a.cfg.MaxUploadSize); e != nil {
		writeError(w, 413, "upload too large or malformed")
		return
	}
	scene := r.FormValue("scene")
	if len(scene) == 0 || len(scene) > int(a.cfg.MaxUploadSize/2) || !validContent([]byte(scene), drawing.Type) {
		writeError(w, 400, "invalid scene")
		return
	}
	file, h, e := r.FormFile("image")
	if e != nil {
		writeError(w, 400, "PNG image is required")
		return
	}
	defer file.Close()
	if h.Header.Get("Content-Type") != "image/png" {
		writeError(w, 400, "image must be image/png")
		return
	}
	tmp, e := a.writePNGTemp(id, file)
	if e != nil {
		a.log.Error("autosave image failed", "drawing", id, "error", e)
		writeError(w, 400, "invalid PNG image")
		return
	}
	defer os.Remove(tmp)
	if e = os.Rename(tmp, a.imagePath(id)); e != nil {
		writeError(w, 500, "save image failed")
		return
	}
	now := time.Now().UnixMilli()
	tx, e := a.db.BeginTx(r.Context(), nil)
	if e == nil {
		var n int64
		var res sql.Result
		res, e = tx.ExecContext(r.Context(), "UPDATE drawings SET scene_json=?,updated_at=?,updated_by=? WHERE id=?", scene, now, u.ID, id)
		if e == nil {
			n, _ = res.RowsAffected()
			if n == 0 {
				e = sql.ErrNoRows
			}
		}
		if e == nil {
			e = tx.Commit()
		} else {
			_ = tx.Rollback()
		}
	}
	if e != nil {
		a.log.Error("autosave database failed", "drawing", id, "error", e)
		writeError(w, 500, "save scene failed")
		return
	}
	a.recordDrawingActivity(r.Context(), id, u.ID, now)
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, map[string]any{"savedAt": now})
}
func validScene(b []byte) bool {
	var s struct {
		Elements json.RawMessage `json:"elements"`
		AppState json.RawMessage `json:"appState"`
		Files    json.RawMessage `json:"files"`
	}
	if json.Unmarshal(b, &s) != nil {
		return false
	}
	return len(s.Elements) > 0 && len(s.AppState) > 0 && len(s.Files) > 0
}
func validContent(b []byte, drawingType string) bool {
	if drawingType == "excalidraw" {
		return validScene(b)
	}
	if drawingType != "mermaid" {
		return false
	}
	var document struct {
		Code  string `json:"code"`
		Theme string `json:"theme"`
	}
	return json.Unmarshal(b, &document) == nil && len(strings.TrimSpace(document.Code)) > 0 && len(document.Code) <= 1<<20
}
func (a *App) writePNGTemp(id string, src multipart.File) (string, error) {
	f, e := os.CreateTemp(a.imagesDir, "."+id+".*.tmp")
	if e != nil {
		return "", e
	}
	name := f.Name()
	ok := false
	defer func() {
		if !ok {
			f.Close()
			os.Remove(name)
		}
	}()
	header := make([]byte, 8)
	if _, e = io.ReadFull(src, header); e != nil || string(header) != "\x89PNG\r\n\x1a\n" {
		return "", errors.New("bad png signature")
	}
	if _, e = f.Write(header); e == nil {
		_, e = io.Copy(f, src)
	}
	if e == nil {
		e = f.Sync()
	}
	if ce := f.Close(); e == nil {
		e = ce
	}
	if e != nil {
		return "", e
	}
	ok = true
	return name, nil
}
func (a *App) imagePath(id string) string { return filepath.Join(a.imagesDir, id+".png") }
func (a *App) image(w http.ResponseWriter, r *http.Request) {
	name := strings.TrimPrefix(r.URL.Path, "/image/")
	if !strings.HasSuffix(name, ".png") {
		http.NotFound(w, r)
		return
	}
	id := strings.TrimSuffix(name, ".png")
	if !drawingIDPattern.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")
	if ok, _ := a.DrawingExists(r.Context(), id); !ok {
		writeMissingImage(w, r)
		return
	}
	if _, err := os.Stat(a.imagePath(id)); errors.Is(err, os.ErrNotExist) {
		writeMissingImage(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	http.ServeFile(w, r, a.imagePath(id))
}

func writeMissingImage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	_, _ = io.WriteString(w, `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" rx="24" fill="#f8fafc"/><path d="M396 190h168a24 24 0 0 1 24 24v112a24 24 0 0 1-24 24H396a24 24 0 0 1-24-24V214a24 24 0 0 1 24-24Z" fill="#fff" stroke="#cbd5e1" stroke-width="3"/><path d="m392 322 50-54 38 38 30-30 58 46" fill="none" stroke="#94a3b8" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="526" cy="238" r="15" fill="#cbd5e1"/><text x="480" y="405" text-anchor="middle" font-family="system-ui,-apple-system,sans-serif" font-size="30" font-weight="600" fill="#64748b">图片已被删除</text></svg>`)
}

func (a *App) serveSPA(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" && !strings.HasPrefix(r.URL.Path, "/d/") {
		a.static.ServeHTTP(w, r)
		return
	}
	rr := r.Clone(r.Context())
	rr.URL.Path = "/"
	a.static.ServeHTTP(w, rr)
}
func decodeJSON(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if d.Decode(v) != nil {
		writeError(w, 400, "invalid JSON")
		return false
	}
	return true
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
func newID() string { return ulid.Make().String() }
func randomToken() (string, error) {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		return "", e
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}
