package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"
)

type Folder struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Space     string  `json:"space"`
	UserID    *string `json:"userId"`
	ProjectID *string `json:"projectId"`
	ParentID  *string `json:"parentId"`
	CreatedBy User    `json:"createdBy"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt int64   `json:"updatedAt"`
	CanDelete bool    `json:"canDelete"`
	SortOrder float64 `json:"sortOrder"`
}

type Project struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	CreatedBy User    `json:"createdBy"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt int64   `json:"updatedAt"`
	CanDelete bool    `json:"canDelete"`
	SortOrder float64 `json:"sortOrder"`
}

type TreeResponse struct {
	Users    []User    `json:"users"`
	Projects []Project `json:"projects"`
	Folders  []Folder  `json:"folders"`
	Drawings []Drawing `json:"drawings"`
}

func (a *App) tree(w http.ResponseWriter, r *http.Request, u User) {
	out := TreeResponse{Users: []User{}, Projects: []Project{}, Folders: []Folder{}, Drawings: []Drawing{}}
	mode, rootID, parentID, search := r.URL.Query().Get("mode"), r.URL.Query().Get("rootId"), r.URL.Query().Get("parentId"), strings.TrimSpace(r.URL.Query().Get("q"))
	legacy := mode == ""
	userQuery := "SELECT id,username,is_admin,blocked FROM users"
	userArgs := []any{}
	if mode == "project" && !legacy {
		userQuery += " WHERE 0"
	}
	userQuery += " ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END,username"
	userArgs = append(userArgs, u.ID)
	rows, err := a.db.QueryContext(r.Context(), userQuery, userArgs...)
	if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	for rows.Next() {
		var item User
		if err = rows.Scan(&item.ID, &item.Username, &item.IsAdmin, &item.Blocked); err != nil {
			rows.Close()
			writeError(w, 500, "query failed")
			return
		}
		out.Users = append(out.Users, item)
	}
	rows.Close()
	projectQuery := `SELECT p.id,p.name,p.created_at,p.updated_at,p.sort_order,u.id,u.username,u.is_admin,u.blocked FROM projects p JOIN users u ON u.id=p.created_by`
	projectArgs := []any{}
	if mode == "user" && !legacy {
		projectQuery += " WHERE 0"
	}
	projectQuery += " ORDER BY p.sort_order,p.name"
	rows, err = a.db.QueryContext(r.Context(), projectQuery, projectArgs...)
	if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	for rows.Next() {
		var item Project
		if err = rows.Scan(&item.ID, &item.Name, &item.CreatedAt, &item.UpdatedAt, &item.SortOrder, &item.CreatedBy.ID, &item.CreatedBy.Username, &item.CreatedBy.IsAdmin, &item.CreatedBy.Blocked); err != nil {
			rows.Close()
			writeError(w, 500, "query failed")
			return
		}
		item.CanDelete = item.CreatedBy.ID == u.ID || u.IsAdmin
		out.Projects = append(out.Projects, item)
	}
	rows.Close()
	folderQuery := `SELECT f.id,f.name,f.space_type,f.user_id,f.project_id,f.parent_id,f.created_at,f.updated_at,f.sort_order,u.id,u.username,u.is_admin,u.blocked FROM folders f JOIN users u ON u.id=f.created_by`
	folderWhere := []string{}
	folderArgs := []any{}
	if !legacy {
		folderWhere = append(folderWhere, "f.space_type=?")
		folderArgs = append(folderArgs, mode)
		if search == "" && parentID != "" {
			folderWhere = append(folderWhere, "f.parent_id=?")
			folderArgs = append(folderArgs, parentID)
		} else if rootID != "" {
			folderWhere = append(folderWhere, "f.parent_id IS NULL")
			if mode == "user" {
				folderWhere = append(folderWhere, "f.user_id=?")
			} else {
				folderWhere = append(folderWhere, "f.project_id=?")
			}
			folderArgs = append(folderArgs, rootID)
		} else {
			folderWhere = append(folderWhere, "0")
		}
	}
	if len(folderWhere) > 0 {
		folderQuery += " WHERE " + strings.Join(folderWhere, " AND ")
	}
	folderQuery += " ORDER BY f.sort_order,f.name"
	rows, err = a.db.QueryContext(r.Context(), folderQuery, folderArgs...)
	if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	for rows.Next() {
		var item Folder
		var userID, projectID, parentID sql.NullString
		if err = rows.Scan(&item.ID, &item.Name, &item.Space, &userID, &projectID, &parentID, &item.CreatedAt, &item.UpdatedAt, &item.SortOrder, &item.CreatedBy.ID, &item.CreatedBy.Username, &item.CreatedBy.IsAdmin, &item.CreatedBy.Blocked); err != nil {
			rows.Close()
			writeError(w, 500, "query failed")
			return
		}
		if userID.Valid {
			item.UserID = &userID.String
		}
		if projectID.Valid {
			item.ProjectID = &projectID.String
		}
		if parentID.Valid {
			item.ParentID = &parentID.String
		}
		item.CanDelete = item.CreatedBy.ID == u.ID || u.IsAdmin
		out.Folders = append(out.Folders, item)
	}
	rows.Close()
	drawingQuery := drawingSelect
	drawingArgs := []any{u.ID}
	drawingWhere := []string{}
	if !legacy {
		drawingWhere = append(drawingWhere, "d.space_type=?")
		drawingArgs = append(drawingArgs, mode)
		if search == "" && parentID != "" {
			drawingWhere = append(drawingWhere, "d.folder_id=?")
			drawingArgs = append(drawingArgs, parentID)
		} else if rootID != "" {
			drawingWhere = append(drawingWhere, "d.folder_id IS NULL")
			if mode == "user" {
				drawingWhere = append(drawingWhere, "d.owner_id=?")
			} else {
				drawingWhere = append(drawingWhere, "d.project_id=?")
			}
			drawingArgs = append(drawingArgs, rootID)
		} else {
			drawingWhere = append(drawingWhere, "0")
		}
	}
	if len(drawingWhere) > 0 {
		drawingQuery += " WHERE " + strings.Join(drawingWhere, " AND ")
	}
	drawingQuery += " ORDER BY d.sort_order,d.name"
	rows, err = a.db.QueryContext(r.Context(), drawingQuery, drawingArgs...)
	if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	for rows.Next() {
		item, scanErr := scanDrawing(rows, u)
		if scanErr != nil {
			rows.Close()
			writeError(w, 500, "query failed")
			return
		}
		item.Scene = nil
		out.Drawings = append(out.Drawings, item)
	}
	rows.Close()
	writeJSON(w, 200, out)
}

func (a *App) createFolder(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Name      string  `json:"name"`
		Space     string  `json:"space"`
		UserID    *string `json:"userId"`
		ProjectID *string `json:"projectId"`
		ParentID  *string `json:"parentId"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(in.Name) < 1 || len(in.Name) > 120 {
		writeError(w, 400, "目录名必须为 1-120 个字符")
		return
	}
	if in.Space != "user" && in.Space != "project" {
		writeError(w, 400, "invalid space")
		return
	}
	if in.ParentID != nil {
		var parentSpace string
		var parentUser, parentProject sql.NullString
		if err := a.db.QueryRowContext(r.Context(), "SELECT space_type,user_id,project_id FROM folders WHERE id=?", *in.ParentID).Scan(&parentSpace, &parentUser, &parentProject); err != nil || parentSpace != in.Space {
			writeError(w, 400, "父目录不存在或空间不匹配")
			return
		}
		if parentUser.Valid {
			in.UserID = &parentUser.String
		} else {
			in.UserID = nil
		}
		if parentProject.Valid {
			in.ProjectID = &parentProject.String
		} else {
			in.ProjectID = nil
		}
	}
	if err := a.validateFolderLocation(r.Context(), u, in.Space, in.UserID, in.ProjectID, in.ParentID); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	var duplicate int
	_ = a.db.QueryRowContext(r.Context(), `SELECT count(*) FROM folders WHERE name=? AND space_type=? AND user_id IS ? AND project_id IS ? AND parent_id IS ?`, in.Name, in.Space, in.UserID, in.ProjectID, in.ParentID).Scan(&duplicate)
	if duplicate > 0 {
		writeError(w, 409, "同级目录已存在同名目录")
		return
	}
	id, now := newID(), time.Now().UnixMilli()
	var order float64
	_ = a.db.QueryRowContext(r.Context(), `SELECT COALESCE(max(sort_order),0)+1 FROM folders WHERE space_type=? AND user_id IS ? AND project_id IS ? AND parent_id IS ?`, in.Space, in.UserID, in.ProjectID, in.ParentID).Scan(&order)
	_, err := a.db.ExecContext(r.Context(), `INSERT INTO folders(id,name,space_type,user_id,project_id,parent_id,created_by,created_at,updated_at,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)`, id, in.Name, in.Space, in.UserID, in.ProjectID, in.ParentID, u.ID, now, now, order)
	if err != nil {
		writeError(w, 409, "同级目录创建失败")
		return
	}
	writeJSON(w, 201, Folder{ID: id, Name: in.Name, Space: in.Space, UserID: in.UserID, ProjectID: in.ProjectID, ParentID: in.ParentID, CreatedBy: u, CreatedAt: now, UpdatedAt: now, CanDelete: true, SortOrder: order})
}

func (a *App) folderRoute(w http.ResponseWriter, r *http.Request) {
	u, err := a.currentUser(r)
	if err != nil {
		writeError(w, 401, "login required")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/folders/")
	if !drawingIDPattern.MatchString(id) {
		writeError(w, 404, "目录不存在")
		return
	}
	var creator string
	if err = a.db.QueryRowContext(r.Context(), "SELECT created_by FROM folders WHERE id=?", id).Scan(&creator); errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "目录不存在")
		return
	} else if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	if creator != u.ID && !u.IsAdmin {
		writeError(w, 403, "只能管理自己创建的目录")
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var in struct {
			Name string `json:"name"`
		}
		if !decodeJSON(w, r, &in) {
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if len(in.Name) < 1 || len(in.Name) > 120 {
			writeError(w, 400, "目录名必须为 1-120 个字符")
			return
		}
		_, err = a.db.ExecContext(r.Context(), "UPDATE folders SET name=?,updated_at=? WHERE id=?", in.Name, time.Now().UnixMilli(), id)
		if err != nil {
			writeError(w, 500, "rename failed")
			return
		}
		w.WriteHeader(204)
	case http.MethodDelete:
		var count int
		_ = a.db.QueryRowContext(r.Context(), `SELECT (SELECT count(*) FROM folders WHERE parent_id=?)+(SELECT count(*) FROM drawings WHERE folder_id=?)`, id, id).Scan(&count)
		if count > 0 {
			writeError(w, 409, "目录非空，请先移动或删除其中内容")
			return
		}
		if _, err = a.db.ExecContext(r.Context(), "DELETE FROM folders WHERE id=?", id); err != nil {
			writeError(w, 500, "delete failed")
			return
		}
		w.WriteHeader(204)
	default:
		writeError(w, 405, "method not allowed")
	}
}

func (a *App) createProject(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Name string `json:"name"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(in.Name) < 1 || len(in.Name) > 120 {
		writeError(w, 400, "项目名必须为 1-120 个字符")
		return
	}
	id, now := newID(), time.Now().UnixMilli()
	var order float64
	_ = a.db.QueryRowContext(r.Context(), `SELECT COALESCE(max(sort_order),0)+1 FROM projects`).Scan(&order)
	if _, err := a.db.ExecContext(r.Context(), "INSERT INTO projects(id,name,created_by,created_at,updated_at,sort_order) VALUES(?,?,?,?,?,?)", id, in.Name, u.ID, now, now, order); err != nil {
		writeError(w, 500, "create failed")
		return
	}
	writeJSON(w, 201, Project{ID: id, Name: in.Name, CreatedBy: u, CreatedAt: now, UpdatedAt: now, CanDelete: true, SortOrder: order})
}
func (a *App) projectRoute(w http.ResponseWriter, r *http.Request) {
	u, err := a.currentUser(r)
	if err != nil {
		writeError(w, 401, "login required")
		return
	}
	id := strings.TrimPrefix(r.URL.Path, "/api/projects/")
	if !drawingIDPattern.MatchString(id) {
		writeError(w, 404, "项目不存在")
		return
	}
	var creator string
	if err = a.db.QueryRowContext(r.Context(), "SELECT created_by FROM projects WHERE id=?", id).Scan(&creator); errors.Is(err, sql.ErrNoRows) {
		writeError(w, 404, "项目不存在")
		return
	} else if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	if creator != u.ID && !u.IsAdmin {
		writeError(w, 403, "只能管理自己创建的项目")
		return
	}
	switch r.Method {
	case http.MethodPatch:
		var in struct {
			Name string `json:"name"`
		}
		if !decodeJSON(w, r, &in) {
			return
		}
		in.Name = strings.TrimSpace(in.Name)
		if len(in.Name) < 1 || len(in.Name) > 120 {
			writeError(w, 400, "项目名必须为 1-120 个字符")
			return
		}
		_, err = a.db.ExecContext(r.Context(), "UPDATE projects SET name=?,updated_at=? WHERE id=?", in.Name, time.Now().UnixMilli(), id)
		if err != nil {
			writeError(w, 500, "rename failed")
			return
		}
		w.WriteHeader(204)
	case http.MethodDelete:
		var count int
		_ = a.db.QueryRowContext(r.Context(), `SELECT (SELECT count(*) FROM folders WHERE project_id=?)+(SELECT count(*) FROM drawings WHERE project_id=?)`, id, id).Scan(&count)
		if count > 0 && !u.IsAdmin {
			writeError(w, 409, "项目非空，请先删除其中内容")
			return
		}
		if u.IsAdmin {
			rows, _ := a.db.QueryContext(r.Context(), `SELECT id FROM drawings WHERE project_id=?`, id)
			var ids []string
			if rows != nil {
				for rows.Next() {
					var drawingID string
					if rows.Scan(&drawingID) == nil {
						ids = append(ids, drawingID)
					}
				}
				rows.Close()
			}
			if _, err = a.db.ExecContext(r.Context(), `UPDATE folders SET parent_id=NULL WHERE project_id=?`, id); err == nil {
				_, err = a.db.ExecContext(r.Context(), `DELETE FROM drawings WHERE project_id=?`, id)
			}
			if err == nil {
				_, err = a.db.ExecContext(r.Context(), `DELETE FROM folders WHERE project_id=?`, id)
			}
			for _, drawingID := range ids {
				_ = os.Remove(a.imagePath(drawingID))
				if a.collab != nil {
					_ = a.collab.Delete(r.Context(), drawingID)
				}
			}
		}
		if err == nil {
			_, err = a.db.ExecContext(r.Context(), "DELETE FROM projects WHERE id=?", id)
		}
		if err != nil {
			writeError(w, 500, "delete failed")
			return
		}
		w.WriteHeader(204)
	default:
		writeError(w, 405, "method not allowed")
	}
}

func (a *App) reorderTree(w http.ResponseWriter, r *http.Request, u User) {
	var in struct {
		Items []struct {
			Kind  string  `json:"kind"`
			ID    string  `json:"id"`
			Order float64 `json:"order"`
		} `json:"items"`
	}
	if !decodeJSON(w, r, &in) {
		return
	}
	if len(in.Items) == 0 || len(in.Items) > 500 {
		writeError(w, 400, "排序内容无效")
		return
	}
	tx, err := a.db.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "排序失败")
		return
	}
	defer tx.Rollback()
	for _, item := range in.Items {
		if !drawingIDPattern.MatchString(item.ID) {
			writeError(w, 400, "排序节点无效")
			return
		}
		switch item.Kind {
		case "folder":
			_, err = tx.ExecContext(r.Context(), `UPDATE folders SET sort_order=?,updated_at=? WHERE id=? AND (created_by=? OR ?=1)`, item.Order, time.Now().UnixMilli(), item.ID, u.ID, u.IsAdmin)
		case "drawing":
			_, err = tx.ExecContext(r.Context(), `UPDATE drawings SET sort_order=? WHERE id=? AND (owner_id=? OR space_type='project' OR ?=1)`, item.Order, item.ID, u.ID, u.IsAdmin)
		case "project":
			_, err = tx.ExecContext(r.Context(), `UPDATE projects SET sort_order=? WHERE id=?`, item.Order, item.ID)
		default:
			err = errors.New("invalid kind")
		}
		if err != nil {
			writeError(w, 500, "排序失败")
			return
		}
	}
	if err = tx.Commit(); err != nil {
		writeError(w, 500, "排序失败")
		return
	}
	w.WriteHeader(204)
}

func (a *App) validateFolderLocation(ctx context.Context, u User, space string, userID, projectID, parentID *string) error {
	if space == "user" {
		if userID == nil || *userID != u.ID {
			return errors.New("只能在自己的用户空间创建目录")
		}
		if projectID != nil {
			return errors.New("用户空间不能指定项目")
		}
	} else {
		if projectID == nil {
			return errors.New("项目空间必须指定项目")
		}
		var n int
		if a.db.QueryRowContext(ctx, "SELECT count(*) FROM projects WHERE id=?", *projectID).Scan(&n) != nil || n == 0 {
			return errors.New("项目不存在")
		}
		if userID != nil {
			return errors.New("项目空间不能指定用户")
		}
	}
	if parentID != nil {
		var n int
		if a.db.QueryRowContext(ctx, "SELECT count(*) FROM folders WHERE id=?", *parentID).Scan(&n) != nil || n == 0 {
			return errors.New("父目录不存在")
		}
	}
	return nil
}

func (a *App) validateDrawingLocation(ctx context.Context, u User, space string, folderID, projectID *string) error {
	if space == "user" {
		if projectID != nil {
			return errors.New("用户空间不能指定项目")
		}
		if folderID == nil {
			return nil
		}
		var folderUser string
		var folderSpace string
		if err := a.db.QueryRowContext(ctx, "SELECT space_type,user_id FROM folders WHERE id=?", *folderID).Scan(&folderSpace, &folderUser); err != nil || folderSpace != "user" || folderUser != u.ID {
			return errors.New("用户目录不存在或不属于当前用户")
		}
		return nil
	}
	if space != "project" || projectID == nil {
		return errors.New("项目空间必须指定项目")
	}
	var n int
	if a.db.QueryRowContext(ctx, "SELECT count(*) FROM projects WHERE id=?", *projectID).Scan(&n) != nil || n == 0 {
		return errors.New("项目不存在")
	}
	if folderID != nil {
		var pid string
		var s string
		if err := a.db.QueryRowContext(ctx, "SELECT space_type,project_id FROM folders WHERE id=?", *folderID).Scan(&s, &pid); err != nil || s != "project" || pid != *projectID {
			return errors.New("项目目录不存在")
		}
	}
	return nil
}

func (a *App) touchActivity(ctx context.Context, userID string) {
	day := time.Now().Format("2006-01-02")
	now := time.Now().Unix()
	_, _ = a.db.ExecContext(ctx, `INSERT INTO activity_daily(user_id,day,last_seen_at) VALUES(?,?,?) ON CONFLICT(user_id,day) DO UPDATE SET last_seen_at=excluded.last_seen_at`, userID, day, now)
}

type Rank struct {
	Name  string `json:"name"`
	Count int    `json:"count"`
}
type Stats struct {
	DailyActive   int    `json:"dailyActive"`
	MonthlyActive int    `json:"monthlyActive"`
	Activity      []Day  `json:"activity"`
	PersonalFiles []Rank `json:"personalFiles"`
	ProjectFiles  []Rank `json:"projectFiles"`
}

type Day struct {
	Date    string `json:"date"`
	Count   int    `json:"count"`
	Created int    `json:"created"`
	Updated int    `json:"updated"`
}

func (a *App) stats(w http.ResponseWriter, r *http.Request, u User) {
	out := Stats{Activity: []Day{}, PersonalFiles: []Rank{}, ProjectFiles: []Rank{}}
	today := time.Now().Format("2006-01-02")
	month := time.Now().AddDate(0, 0, -29).Format("2006-01-02")
	_ = a.db.QueryRowContext(r.Context(), "SELECT count(DISTINCT user_id) FROM activity_daily WHERE day=?", today).Scan(&out.DailyActive)
	_ = a.db.QueryRowContext(r.Context(), "SELECT count(DISTINCT user_id) FROM activity_daily WHERE day>=?", month).Scan(&out.MonthlyActive)
	heatmapStart := time.Now().AddDate(-1, 0, -7)
	days := map[string]*Day{}
	rows, err := a.db.QueryContext(r.Context(), `SELECT created_at,updated_at FROM drawings WHERE created_at>=? OR updated_at>=?`, heatmapStart.UnixMilli(), heatmapStart.UnixMilli())
	if err == nil {
		for rows.Next() {
			var createdAt, updatedAt int64
			if rows.Scan(&createdAt, &updatedAt) != nil {
				continue
			}
			createdDay := time.UnixMilli(createdAt).In(time.Local).Format("2006-01-02")
			if days[createdDay] == nil {
				days[createdDay] = &Day{Date: createdDay}
			}
			days[createdDay].Created++
			if updatedAt > createdAt {
				updatedDay := time.UnixMilli(updatedAt).In(time.Local).Format("2006-01-02")
				if days[updatedDay] == nil {
					days[updatedDay] = &Day{Date: updatedDay}
				}
				days[updatedDay].Updated++
			}
		}
		rows.Close()
	}
	for date := heatmapStart; !date.After(time.Now()); date = date.AddDate(0, 0, 1) {
		key := date.Format("2006-01-02")
		if item := days[key]; item != nil {
			item.Count = item.Created + item.Updated
			out.Activity = append(out.Activity, *item)
		}
	}
	rows, err = a.db.QueryContext(r.Context(), `SELECT u.username,count(d.id) FROM users u LEFT JOIN drawings d ON d.owner_id=u.id GROUP BY u.id ORDER BY count(d.id) DESC,u.username LIMIT 10`)
	if err == nil {
		for rows.Next() {
			var x Rank
			_ = rows.Scan(&x.Name, &x.Count)
			out.PersonalFiles = append(out.PersonalFiles, x)
		}
		rows.Close()
	}
	rows, err = a.db.QueryContext(r.Context(), `SELECT p.name,count(d.id) FROM projects p LEFT JOIN drawings d ON d.project_id=p.id GROUP BY p.id ORDER BY count(d.id) DESC,p.name LIMIT 10`)
	if err == nil {
		for rows.Next() {
			var x Rank
			_ = rows.Scan(&x.Name, &x.Count)
			out.ProjectFiles = append(out.ProjectFiles, x)
		}
		rows.Close()
	}
	writeJSON(w, 200, out)
}
