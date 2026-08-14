package app

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
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
}

type Project struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedBy User   `json:"createdBy"`
	CreatedAt int64  `json:"createdAt"`
	UpdatedAt int64  `json:"updatedAt"`
	CanDelete bool   `json:"canDelete"`
}

type TreeResponse struct {
	Users    []User    `json:"users"`
	Projects []Project `json:"projects"`
	Folders  []Folder  `json:"folders"`
	Drawings []Drawing `json:"drawings"`
}

func (a *App) tree(w http.ResponseWriter, r *http.Request, u User) {
	out := TreeResponse{Users: []User{}, Projects: []Project{}, Folders: []Folder{}, Drawings: []Drawing{}}
	rows, err := a.db.QueryContext(r.Context(), "SELECT id,username FROM users ORDER BY username")
	if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	for rows.Next() {
		var item User
		if err = rows.Scan(&item.ID, &item.Username); err != nil {
			rows.Close()
			writeError(w, 500, "query failed")
			return
		}
		out.Users = append(out.Users, item)
	}
	rows.Close()
	rows, err = a.db.QueryContext(r.Context(), `SELECT p.id,p.name,p.created_at,p.updated_at,u.id,u.username FROM projects p JOIN users u ON u.id=p.created_by ORDER BY p.name`)
	if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	for rows.Next() {
		var item Project
		if err = rows.Scan(&item.ID, &item.Name, &item.CreatedAt, &item.UpdatedAt, &item.CreatedBy.ID, &item.CreatedBy.Username); err != nil {
			rows.Close()
			writeError(w, 500, "query failed")
			return
		}
		item.CanDelete = item.CreatedBy.ID == u.ID
		out.Projects = append(out.Projects, item)
	}
	rows.Close()
	rows, err = a.db.QueryContext(r.Context(), `SELECT f.id,f.name,f.space_type,f.user_id,f.project_id,f.parent_id,f.created_at,f.updated_at,u.id,u.username FROM folders f JOIN users u ON u.id=f.created_by ORDER BY f.name`)
	if err != nil {
		writeError(w, 500, "query failed")
		return
	}
	for rows.Next() {
		var item Folder
		var userID, projectID, parentID sql.NullString
		if err = rows.Scan(&item.ID, &item.Name, &item.Space, &userID, &projectID, &parentID, &item.CreatedAt, &item.UpdatedAt, &item.CreatedBy.ID, &item.CreatedBy.Username); err != nil {
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
		item.CanDelete = item.CreatedBy.ID == u.ID
		out.Folders = append(out.Folders, item)
	}
	rows.Close()
	rows, err = a.db.QueryContext(r.Context(), drawingSelect+" ORDER BY d.name")
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
	id, now := newID(), time.Now().UnixMilli()
	_, err := a.db.ExecContext(r.Context(), `INSERT INTO folders(id,name,space_type,user_id,project_id,parent_id,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`, id, in.Name, in.Space, in.UserID, in.ProjectID, in.ParentID, u.ID, now, now)
	if err != nil {
		writeError(w, 409, "同级目录创建失败")
		return
	}
	writeJSON(w, 201, Folder{ID: id, Name: in.Name, Space: in.Space, UserID: in.UserID, ProjectID: in.ProjectID, ParentID: in.ParentID, CreatedBy: u, CreatedAt: now, UpdatedAt: now, CanDelete: true})
}

func (a *App) folderRoute(w http.ResponseWriter, r *http.Request) {
	u, err := a.currentUser(r)
	if err != nil {
		writeError(w, 401, "login required")
		return
	}
	if !safeRequest(r) {
		writeError(w, 403, "cross-site request rejected")
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
	if creator != u.ID {
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
	if _, err := a.db.ExecContext(r.Context(), "INSERT INTO projects(id,name,created_by,created_at,updated_at) VALUES(?,?,?,?,?)", id, in.Name, u.ID, now, now); err != nil {
		writeError(w, 500, "create failed")
		return
	}
	writeJSON(w, 201, Project{ID: id, Name: in.Name, CreatedBy: u, CreatedAt: now, UpdatedAt: now, CanDelete: true})
}
func (a *App) projectRoute(w http.ResponseWriter, r *http.Request) {
	u, err := a.currentUser(r)
	if err != nil {
		writeError(w, 401, "login required")
		return
	}
	if !safeRequest(r) {
		writeError(w, 403, "cross-site request rejected")
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
	if creator != u.ID {
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
		if count > 0 {
			writeError(w, 409, "项目非空，请先删除其中内容")
			return
		}
		if _, err = a.db.ExecContext(r.Context(), "DELETE FROM projects WHERE id=?", id); err != nil {
			writeError(w, 500, "delete failed")
			return
		}
		w.WriteHeader(204)
	default:
		writeError(w, 405, "method not allowed")
	}
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
	Date  string `json:"date"`
	Count int    `json:"count"`
}

func (a *App) stats(w http.ResponseWriter, r *http.Request, u User) {
	out := Stats{Activity: []Day{}, PersonalFiles: []Rank{}, ProjectFiles: []Rank{}}
	today := time.Now().Format("2006-01-02")
	month := time.Now().AddDate(0, 0, -29).Format("2006-01-02")
	_ = a.db.QueryRowContext(r.Context(), "SELECT count(DISTINCT user_id) FROM activity_daily WHERE day=?", today).Scan(&out.DailyActive)
	_ = a.db.QueryRowContext(r.Context(), "SELECT count(DISTINCT user_id) FROM activity_daily WHERE day>=?", month).Scan(&out.MonthlyActive)
	heatmapStart := time.Now().AddDate(-1, 0, 1).Format("2006-01-02")
	rows, err := a.db.QueryContext(r.Context(), `SELECT day,count(DISTINCT user_id) FROM activity_daily WHERE day>=? GROUP BY day ORDER BY day`, heatmapStart)
	if err == nil {
		for rows.Next() {
			var x Day
			_ = rows.Scan(&x.Date, &x.Count)
			out.Activity = append(out.Activity, x)
		}
		rows.Close()
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
