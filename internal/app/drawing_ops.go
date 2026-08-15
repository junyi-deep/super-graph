package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/junyi-deep/super-graph/internal/collaboration"
)

type CollaborationStatus struct {
	Enabled      bool                       `json:"enabled"`
	Limit        int                        `json:"limit"`
	MaxLimit     int                        `json:"maxLimit"`
	CanManage    bool                       `json:"canManage"`
	CanEdit      bool                       `json:"canEdit"`
	Participants []CollaborationParticipant `json:"participants"`
}
type CollaborationParticipant struct {
	User    User `json:"user"`
	CanEdit bool `json:"canEdit"`
	Online  bool `json:"online"`
}
type DrawingActivity struct {
	User      User  `json:"user"`
	ChangedAt int64 `json:"changedAt"`
}

func (a *App) drawingNameExists(ctx context.Context, name, space, ownerID string, projectID, folderID *string, excludeID string) (bool, error) {
	var n int
	if space == "user" {
		err := a.db.QueryRowContext(ctx, `SELECT count(*) FROM drawings WHERE space_type='user' AND owner_id=? AND name=? AND folder_id IS ? AND id<>?`, ownerID, name, folderID, excludeID).Scan(&n)
		return n > 0, err
	}
	err := a.db.QueryRowContext(ctx, `SELECT count(*) FROM drawings WHERE space_type='project' AND project_id=? AND name=? AND folder_id IS ? AND id<>?`, projectID, name, folderID, excludeID).Scan(&n)
	return n > 0, err
}

func (a *App) nextDrawingOrder(ctx context.Context, space, ownerID string, projectID, folderID *string) float64 {
	var order float64
	if space == "user" {
		_ = a.db.QueryRowContext(ctx, `SELECT COALESCE(max(sort_order),0)+1 FROM drawings WHERE space_type='user' AND owner_id=? AND folder_id IS ?`, ownerID, folderID).Scan(&order)
	} else {
		_ = a.db.QueryRowContext(ctx, `SELECT COALESCE(max(sort_order),0)+1 FROM drawings WHERE space_type='project' AND project_id=? AND folder_id IS ?`, projectID, folderID).Scan(&order)
	}
	return order
}

func (a *App) drawingOperationRoute(w http.ResponseWriter, r *http.Request, u User, id, operation string) bool {
	switch operation {
	case "favorite":
		if r.Method == http.MethodPut {
			_, err := a.db.ExecContext(r.Context(), `INSERT OR IGNORE INTO favorites(user_id,drawing_id,created_at) VALUES(?,?,?)`, u.ID, id, time.Now().UnixMilli())
			if err != nil {
				writeError(w, 404, "文件不存在")
				return true
			}
			w.WriteHeader(204)
			return true
		}
		if r.Method == http.MethodDelete {
			_, _ = a.db.ExecContext(r.Context(), `DELETE FROM favorites WHERE user_id=? AND drawing_id=?`, u.ID, id)
			w.WriteHeader(204)
			return true
		}
	case "relocate":
		if r.Method == http.MethodPost {
			a.relocateDrawing(w, r, u, id)
			return true
		}
	case "collaboration":
		if r.Method == http.MethodGet {
			a.collaborationStatus(w, r, u, id)
			return true
		}
		if r.Method == http.MethodPatch {
			a.updateCollaboration(w, r, u, id)
			return true
		}
	case "activity":
		if r.Method == http.MethodGet {
			a.drawingActivity(w, r, u, id)
			return true
		}
	}
	return false
}

func (a *App) relocateDrawing(w http.ResponseWriter, r *http.Request, u User, id string) {
	var in struct {
		Operation string  `json:"operation"`
		Name      string  `json:"name"`
		Space     string  `json:"space"`
		FolderID  *string `json:"folderId"`
		ProjectID *string `json:"projectId"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if in.Operation != "copy" && in.Operation != "move" {
		writeError(w, 400, "操作必须为 copy 或 move")
		return
	}
	if len(in.Name) < 1 || len(in.Name) > 200 {
		writeError(w, 400, "文件名必须为 1-200 个字符")
		return
	}
	d, err := a.getDrawing(r.Context(), id, u)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "文件不存在")
		return
	} else if err != nil {
		writeError(w, 500, "查询失败")
		return
	}
	if in.Operation == "move" && d.Owner.ID != u.ID && !u.IsAdmin {
		writeError(w, 403, "只有创建人或管理员可以移动文件")
		return
	}
	if err = a.validateDrawingLocation(r.Context(), u, in.Space, in.FolderID, in.ProjectID); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if exists, _ := a.drawingNameExists(r.Context(), in.Name, in.Space, u.ID, in.ProjectID, in.FolderID, func() string {
		if in.Operation == "move" {
			return id
		}
		return ""
	}()); exists {
		writeError(w, 409, "目标位置已存在同名文件，请修改名称")
		return
	}
	if in.Operation == "move" {
		newOwner := d.Owner.ID
		if in.Space == "user" {
			newOwner = u.ID
		}
		order := a.nextDrawingOrder(r.Context(), in.Space, newOwner, in.ProjectID, in.FolderID)
		_, err = a.db.ExecContext(r.Context(), `UPDATE drawings SET owner_id=?,name=?,space_type=?,folder_id=?,project_id=?,updated_at=?,updated_by=?,sort_order=? WHERE id=?`, newOwner, in.Name, in.Space, in.FolderID, in.ProjectID, time.Now().UnixMilli(), u.ID, order, id)
		if err != nil {
			writeError(w, 500, "移动失败")
			return
		}
		item, _ := a.getDrawing(r.Context(), id, u)
		writeJSON(w, 200, item)
		return
	}
	newID, now := newID(), time.Now().UnixMilli()
	order := a.nextDrawingOrder(r.Context(), in.Space, u.ID, in.ProjectID, in.FolderID)
	_, err = a.db.ExecContext(r.Context(), `INSERT INTO drawings(id,owner_id,name,scene_json,created_at,updated_at,updated_by,space_type,folder_id,project_id,drawing_type,collaboration_enabled,collaborator_limit,sort_order) SELECT ?,?,?,?,?,?,?,?,?,?,drawing_type,collaboration_enabled,collaborator_limit,? FROM drawings WHERE id=?`, newID, u.ID, in.Name, string(d.Scene), now, now, u.ID, in.Space, in.FolderID, in.ProjectID, order, id)
	if err != nil {
		writeError(w, 500, "复制失败")
		return
	}
	if image, readErr := os.ReadFile(a.imagePath(id)); readErr == nil {
		_ = os.WriteFile(a.imagePath(newID), image, 0o640)
	}
	item, _ := a.getDrawing(r.Context(), newID, u)
	writeJSON(w, 201, item)
}

func (a *App) CollaborationAccess(ctx context.Context, drawingID, userID string) (bool, string, error) {
	var ownerID, projectID sql.NullString
	var enabled bool
	var limit int
	var blocked, isAdmin bool
	err := a.db.QueryRowContext(ctx, `SELECT d.owner_id,d.project_id,d.collaboration_enabled,d.collaborator_limit,u.blocked,u.is_admin FROM drawings d JOIN users u ON u.id=? WHERE d.id=?`, userID, drawingID).Scan(&ownerID, &projectID, &enabled, &limit, &blocked, &isAdmin)
	if err != nil {
		return true, "", err
	}
	if blocked {
		return true, "", errors.New("user blocked")
	}
	project := projectID.String
	if ownerID.String == userID || isAdmin {
		return false, project, nil
	}
	if !enabled {
		return true, project, nil
	}
	var canEdit bool
	err = a.db.QueryRowContext(ctx, `SELECT can_edit FROM drawing_permissions WHERE drawing_id=? AND user_id=?`, drawingID, userID).Scan(&canEdit)
	if err == nil {
		if !canEdit {
			return true, project, nil
		}
		if a.collab != nil {
			for _, participant := range a.collab.Participants(drawingID) {
				if participant.UserID == userID && !participant.ReadOnly {
					return false, project, nil
				}
			}
		}
		return !a.editorCapacityAvailable(drawingID, project, limit), project, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return true, project, err
	}
	canEdit = a.editorCapacityAvailable(drawingID, project, limit)
	_, err = a.db.ExecContext(ctx, `INSERT OR IGNORE INTO drawing_permissions(drawing_id,user_id,can_edit,updated_at) VALUES(?,?,?,?)`, drawingID, userID, canEdit, time.Now().UnixMilli())
	return !canEdit, project, err
}

func (a *App) editorCapacityAvailable(drawingID, project string, limit int) bool {
	a.settingsMu.RLock()
	settings := a.settings
	a.settingsMu.RUnlock()
	docCount, projectCount, globalCount := 0, 0, 0
	if a.collab != nil {
		docCount, projectCount, globalCount = a.collab.EditorCounts(drawingID, project)
	}
	return docCount < min(limit, settings.MaxDocumentEditors) && globalCount < settings.MaxGlobalEditors && (project == "" || projectCount < settings.MaxProjectEditors)
}

func (a *App) collaborationStatus(w http.ResponseWriter, r *http.Request, u User, id string) {
	d, err := a.getDrawing(r.Context(), id, u)
	if err != nil {
		writeError(w, 404, "文件不存在")
		return
	}
	readOnly, _, err := a.CollaborationAccess(r.Context(), id, u.ID)
	if err != nil {
		writeError(w, 500, "协作状态读取失败")
		return
	}
	a.settingsMu.RLock()
	maxLimit := a.settings.MaxDocumentEditors
	a.settingsMu.RUnlock()
	status := CollaborationStatus{Enabled: d.CollaborationEnabled, Limit: d.CollaboratorLimit, MaxLimit: maxLimit, CanManage: d.Owner.ID == u.ID || u.IsAdmin, CanEdit: !readOnly, Participants: []CollaborationParticipant{}}
	online := map[string]collaboration.Participant{}
	if a.collab != nil {
		for _, p := range a.collab.Participants(id) {
			online[p.UserID] = p
		}
	}
	rows, err := a.db.QueryContext(r.Context(), `SELECT u.id,u.username,u.is_admin,u.blocked,CASE WHEN u.id=d.owner_id THEN 1 ELSE COALESCE(dp.can_edit,0) END FROM users u JOIN drawings d ON d.id=? LEFT JOIN drawing_permissions dp ON dp.drawing_id=d.id AND dp.user_id=u.id WHERE u.id=d.owner_id OR dp.user_id IS NOT NULL ORDER BY CASE WHEN u.id=d.owner_id THEN 0 ELSE 1 END,u.username`, id)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var p CollaborationParticipant
			if rows.Scan(&p.User.ID, &p.User.Username, &p.User.IsAdmin, &p.User.Blocked, &p.CanEdit) == nil {
				if active, ok := online[p.User.ID]; ok {
					p.Online = true
					p.CanEdit = !active.ReadOnly
				}
				status.Participants = append(status.Participants, p)
			}
		}
	}
	writeJSON(w, 200, status)
}

func (a *App) updateCollaboration(w http.ResponseWriter, r *http.Request, u User, id string) {
	d, err := a.getDrawing(r.Context(), id, u)
	if err != nil {
		writeError(w, 404, "文件不存在")
		return
	}
	if d.Owner.ID != u.ID && !u.IsAdmin {
		writeError(w, 403, "只有创建人或管理员可以管理协作")
		return
	}
	var in struct {
		Enabled *bool  `json:"enabled"`
		Limit   *int   `json:"limit"`
		UserID  string `json:"userId"`
		CanEdit *bool  `json:"canEdit"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	a.settingsMu.RLock()
	maxLimit := a.settings.MaxDocumentEditors
	a.settingsMu.RUnlock()
	if in.Limit != nil {
		if *in.Limit < 1 || *in.Limit > maxLimit {
			writeError(w, 400, "文档协作上限超出管理员配置")
			return
		}
		_, _ = a.db.ExecContext(r.Context(), `UPDATE drawings SET collaborator_limit=? WHERE id=?`, *in.Limit, id)
	}
	if in.Enabled != nil {
		_, _ = a.db.ExecContext(r.Context(), `UPDATE drawings SET collaboration_enabled=? WHERE id=?`, *in.Enabled, id)
	}
	if in.UserID != "" && in.CanEdit != nil {
		if in.UserID == d.Owner.ID {
			writeError(w, 400, "不能修改创建人的编辑权限")
			return
		}
		if *in.CanEdit {
			a.settingsMu.RLock()
			settings := a.settings
			a.settingsMu.RUnlock()
			docCount, projectCount, globalCount := 0, 0, 0
			project := ""
			if d.ProjectID != nil {
				project = *d.ProjectID
			}
			if a.collab != nil {
				docCount, projectCount, globalCount = a.collab.EditorCounts(id, project)
			}
			if docCount >= min(d.CollaboratorLimit, settings.MaxDocumentEditors) || globalCount >= settings.MaxGlobalEditors || (project != "" && projectCount >= settings.MaxProjectEditors) {
				writeError(w, http.StatusConflict, "协作编辑人数已满，请先将其他用户设为只读")
				return
			}
		}
		_, err = a.db.ExecContext(r.Context(), `INSERT INTO drawing_permissions(drawing_id,user_id,can_edit,updated_at) VALUES(?,?,?,?) ON CONFLICT(drawing_id,user_id) DO UPDATE SET can_edit=excluded.can_edit,updated_at=excluded.updated_at`, id, in.UserID, *in.CanEdit, time.Now().UnixMilli())
		if err != nil {
			writeError(w, 400, "用户不存在")
			return
		}
	}
	a.collaborationStatus(w, r, u, id)
}

func (a *App) recordDrawingActivity(ctx context.Context, drawingID, userID string, changedAt int64) {
	var lastID, lastAt int64
	var lastUser string
	err := a.db.QueryRowContext(ctx, `SELECT id,user_id,changed_at FROM drawing_activity WHERE drawing_id=? ORDER BY changed_at DESC LIMIT 1`, drawingID).Scan(&lastID, &lastUser, &lastAt)
	if err == nil && lastUser == userID && changedAt-lastAt < 60000 {
		_, _ = a.db.ExecContext(ctx, `UPDATE drawing_activity SET changed_at=? WHERE id=?`, changedAt, lastID)
	} else {
		_, _ = a.db.ExecContext(ctx, `INSERT INTO drawing_activity(drawing_id,user_id,changed_at) VALUES(?,?,?)`, drawingID, userID, changedAt)
	}
	_, _ = a.db.ExecContext(ctx, `DELETE FROM drawing_activity WHERE drawing_id=? AND id NOT IN (SELECT id FROM drawing_activity WHERE drawing_id=? ORDER BY changed_at DESC LIMIT 50)`, drawingID, drawingID)
}

func (a *App) drawingActivity(w http.ResponseWriter, r *http.Request, u User, id string) {
	rows, err := a.db.QueryContext(r.Context(), `SELECT u.id,u.username,u.is_admin,u.blocked,a.changed_at FROM drawing_activity a JOIN users u ON u.id=a.user_id WHERE a.drawing_id=? ORDER BY a.changed_at DESC LIMIT 50`, id)
	if err != nil {
		writeError(w, 500, "读取修改记录失败")
		return
	}
	defer rows.Close()
	out := []DrawingActivity{}
	for rows.Next() {
		var item DrawingActivity
		if rows.Scan(&item.User.ID, &item.User.Username, &item.User.IsAdmin, &item.User.Blocked, &item.ChangedAt) == nil {
			out = append(out, item)
		}
	}
	writeJSON(w, 200, out)
}

func jsonCopy(value any) json.RawMessage { data, _ := json.Marshal(value); return data }
