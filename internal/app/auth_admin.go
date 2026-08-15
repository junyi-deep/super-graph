package app

import (
	"context"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"time"
)

const defaultUserPassword = "123456"

func passwordDigest(password, encodedSalt string) (string, error) {
	salt, err := base64.RawStdEncoding.DecodeString(encodedSalt)
	if err != nil {
		return "", err
	}
	digest, err := pbkdf2.Key(sha256.New, password, salt, 210000, 32)
	if err != nil {
		return "", err
	}
	return base64.RawStdEncoding.EncodeToString(digest), nil
}

func newPassword(password string) (salt, digest string, err error) {
	raw := make([]byte, 16)
	if _, err = rand.Read(raw); err != nil {
		return "", "", err
	}
	salt = base64.RawStdEncoding.EncodeToString(raw)
	digest, err = passwordDigest(password, salt)
	return
}

func passwordMatches(password, salt, expected string) bool {
	actual, err := passwordDigest(password, salt)
	return err == nil && subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}

func subtleConstantCompare(actual, expected string) bool {
	return len(actual) == len(expected) && subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}

func initializeUsers(db *sql.DB) error {
	rows, err := db.Query(`SELECT id FROM users WHERE password_hash='' AND username<>'admin'`)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	for _, id := range ids {
		salt, digest, err := newPassword(defaultUserPassword)
		if err != nil {
			return err
		}
		if _, err = db.Exec(`UPDATE users SET password_salt=?,password_hash=? WHERE id=?`, salt, digest, id); err != nil {
			return err
		}
	}
	now := time.Now().Unix()
	_, err = db.Exec(`INSERT INTO users(id,username,created_at,last_seen_at,is_admin) VALUES('admin','admin',?,?,1)
		ON CONFLICT(username) DO UPDATE SET is_admin=1,blocked=0`, now, now)
	return err
}

func validPassword(password string) bool { return len(password) >= 6 && len(password) <= 128 }

func (a *App) isAdmin(u User) bool { return u.IsAdmin }

func (a *App) changePassword(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Password string `json:"password"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if !validPassword(in.Password) {
		writeError(w, 400, "密码长度必须为 6-128 个字符")
		return
	}
	if u.IsAdmin {
		if err := a.persistRuntimeConfig(map[string]any{"adminPassword": in.Password}); err != nil {
			writeError(w, 500, "配置保存失败")
			return
		}
		a.settingsMu.Lock()
		a.adminPassword = in.Password
		a.settingsMu.Unlock()
	} else {
		newSalt, newDigest, err := newPassword(in.Password)
		if err != nil {
			writeError(w, 500, "密码修改失败")
			return
		}
		if _, err = a.db.ExecContext(r.Context(), `UPDATE users SET password_salt=?,password_hash=? WHERE id=?`, newSalt, newDigest, u.ID); err != nil {
			writeError(w, 500, "密码修改失败")
			return
		}
	}
	if cookie, err := r.Cookie("draw_session"); err == nil {
		_, _ = a.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id=? AND id<>?`, u.ID, cookie.Value)
	}
	w.WriteHeader(204)
}

func (a *App) adminSettings(w http.ResponseWriter, r *http.Request, u User) {
	if !u.IsAdmin {
		writeError(w, 403, "需要管理员权限")
		return
	}
	if r.Method == http.MethodGet {
		a.settingsMu.RLock()
		settings := a.settings
		a.settingsMu.RUnlock()
		writeJSON(w, 200, settings)
		return
	}
	if r.Method != http.MethodPatch {
		writeError(w, 405, "method not allowed")
		return
	}
	var in GlobalSettings
	if !decodeJSON(w, r, &in) {
		return
	}
	if in.MaxDocumentEditors < 1 || in.MaxProjectEditors < 1 || in.MaxGlobalEditors < 1 || in.DefaultDrawingLimit < 1 || in.DefaultDrawingLimit > in.MaxDocumentEditors {
		writeError(w, 400, "协作人数上限必须为正数，默认上限不能超过单文档上限")
		return
	}
	if err := a.persistRuntimeConfig(map[string]any{"maxDocumentEditors": in.MaxDocumentEditors, "maxProjectEditors": in.MaxProjectEditors, "maxGlobalEditors": in.MaxGlobalEditors, "defaultDrawingLimit": in.DefaultDrawingLimit}); err != nil {
		writeError(w, 500, "配置保存失败")
		return
	}
	a.settingsMu.Lock()
	a.settings = in
	a.settingsMu.Unlock()
	_, _ = a.db.ExecContext(r.Context(), `UPDATE drawings SET collaborator_limit=? WHERE collaborator_limit>?`, in.MaxDocumentEditors, in.MaxDocumentEditors)
	writeJSON(w, 200, in)
}

func (a *App) persistRuntimeConfig(changes map[string]any) error {
	if a.cfg.ConfigPath == "" {
		return nil
	}
	data, err := os.ReadFile(a.cfg.ConfigPath)
	if err != nil {
		return err
	}
	values := map[string]any{}
	if err = json.Unmarshal(data, &values); err != nil {
		return err
	}
	for key, value := range changes {
		values[key] = value
	}
	data, err = json.MarshalIndent(values, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')
	return os.WriteFile(a.cfg.ConfigPath, data, 0o640)
}

func (a *App) adminUserRoute(w http.ResponseWriter, r *http.Request, u User, id string) {
	if !u.IsAdmin {
		writeError(w, 403, "需要管理员权限")
		return
	}
	if id == "admin" || id == u.ID {
		writeError(w, 400, "不能管理管理员自身")
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var in struct {
			Blocked  *bool  `json:"blocked"`
			Password string `json:"password"`
		}
		if !decodeJSON(w, r, &in) {
			return
		}
		if in.Blocked != nil {
			_, _ = a.db.ExecContext(r.Context(), `UPDATE users SET blocked=? WHERE id=? AND is_admin=0`, *in.Blocked, id)
			if *in.Blocked {
				_, _ = a.db.ExecContext(r.Context(), `DELETE FROM sessions WHERE user_id=?`, id)
			}
		}
		if in.Password != "" {
			if !validPassword(in.Password) {
				writeError(w, 400, "密码长度必须为 6-128 个字符")
				return
			}
			salt, digest, err := newPassword(in.Password)
			if err != nil {
				writeError(w, 500, "密码重置失败")
				return
			}
			_, _ = a.db.ExecContext(r.Context(), `UPDATE users SET password_salt=?,password_hash=? WHERE id=?`, salt, digest, id)
		}
		w.WriteHeader(204)
	case http.MethodDelete:
		if err := a.deleteUser(r.Context(), id); errors.Is(err, sql.ErrNoRows) {
			writeError(w, 404, "用户不存在")
			return
		} else if err != nil {
			writeError(w, 500, "删除用户失败")
			return
		}
		w.WriteHeader(204)
	default:
		writeError(w, 405, "method not allowed")
	}
}

func (a *App) deleteUser(ctx context.Context, id string) error {
	var count int
	if err := a.db.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE id=? AND is_admin=0`, id).Scan(&count); err != nil || count == 0 {
		return sql.ErrNoRows
	}
	rows, err := a.db.QueryContext(ctx, `SELECT id FROM drawings WHERE owner_id=?`, id)
	if err != nil {
		return err
	}
	var drawingIDs []string
	for rows.Next() {
		var drawingID string
		if rows.Scan(&drawingID) == nil {
			drawingIDs = append(drawingIDs, drawingID)
		}
	}
	rows.Close()
	tx, err := a.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.ExecContext(ctx, `DELETE FROM drawings WHERE owner_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM folders WHERE user_id=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE projects SET created_by='admin' WHERE created_by=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE folders SET created_by='admin' WHERE created_by=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE drawings SET updated_by=NULL WHERE updated_by=?`, id); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `DELETE FROM users WHERE id=?`, id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	for _, drawingID := range drawingIDs {
		_ = os.Remove(a.imagePath(drawingID))
		if a.collab != nil {
			_ = a.collab.Delete(ctx, drawingID)
		}
	}
	return nil
}
