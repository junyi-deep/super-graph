package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

var pngA = []byte("\x89PNG\r\n\x1a\nfirst-complete-image")
var pngB = []byte("\x89PNG\r\n\x1a\nsecond-complete-image")

type testClient struct {
	t      *testing.T
	base   string
	cookie *http.Cookie
	client *http.Client
}

func newTestApp(t *testing.T, dir string) (*App, *httptest.Server) {
	t.Helper()
	a, err := Open(Config{DataDir: dir, AutosaveInterval: 20 * time.Millisecond, MaxUploadSize: 1 << 20}, slog.New(slog.NewTextHandler(io.Discard, nil)))
	if err != nil {
		t.Fatal(err)
	}
	s := httptest.NewServer(a)
	return a, s
}
func tc(t *testing.T, s *httptest.Server) *testClient {
	return &testClient{t: t, base: s.URL, client: s.Client()}
}
func (c *testClient) req(method, path string, body io.Reader, contentType string) *http.Response {
	c.t.Helper()
	r, e := http.NewRequest(method, c.base+path, body)
	if e != nil {
		c.t.Fatal(e)
	}
	if contentType != "" {
		r.Header.Set("Content-Type", contentType)
	}
	if c.cookie != nil {
		r.AddCookie(c.cookie)
	}
	resp, e := c.client.Do(r)
	if e != nil {
		c.t.Fatal(e)
	}
	return resp
}
func (c *testClient) login(name string) User {
	resp := c.req("POST", "/api/login", strings.NewReader(fmt.Sprintf(`{"username":%q}`, name)), "application/json")
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		b, _ := io.ReadAll(resp.Body)
		c.t.Fatalf("login: %d %s", resp.StatusCode, b)
	}
	c.cookie = resp.Cookies()[0]
	var u User
	if json.NewDecoder(resp.Body).Decode(&u) != nil {
		c.t.Fatal("bad login json")
	}
	return u
}
func (c *testClient) create(name string) Drawing {
	resp := c.req("POST", "/api/drawings", strings.NewReader(fmt.Sprintf(`{"name":%q}`, name)), "application/json")
	defer resp.Body.Close()
	if resp.StatusCode != 201 {
		b, _ := io.ReadAll(resp.Body)
		c.t.Fatalf("create: %d %s", resp.StatusCode, b)
	}
	var d Drawing
	if e := json.NewDecoder(resp.Body).Decode(&d); e != nil {
		c.t.Fatal(e)
	}
	return d
}
func (c *testClient) autosave(id string, png []byte) int {
	return c.autosaveContent(id, `{"elements":[{"id":"x"}],"appState":{},"files":{}}`, png)
}
func (c *testClient) autosaveContent(id, scene string, png []byte) int {
	var b bytes.Buffer
	m := multipart.NewWriter(&b)
	_ = m.WriteField("scene", scene)
	h, _ := m.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": {`form-data; name="image"; filename="drawing.png"`},
		"Content-Type":        {"image/png"},
	})
	_, _ = h.Write(png)
	_ = m.Close()
	resp := c.req("PUT", "/api/drawings/"+id+"/autosave", &b, m.FormDataContentType())
	defer resp.Body.Close()
	return resp.StatusCode
}

func TestMermaidDrawingAndFallbackImage(t *testing.T) {
	a, s := newTestApp(t, t.TempDir())
	defer s.Close()
	defer a.Close()
	c := tc(t, s)
	c.login("alice")
	resp := c.req("POST", "/api/drawings", strings.NewReader(`{"name":"flow","type":"mermaid"}`), "application/json")
	var drawing Drawing
	_ = json.NewDecoder(resp.Body).Decode(&drawing)
	resp.Body.Close()
	if resp.StatusCode != 201 || drawing.Type != "mermaid" || !bytes.Contains(drawing.Scene, []byte("flowchart")) {
		t.Fatalf("mermaid create: %d %#v", resp.StatusCode, drawing)
	}
	resp = c.req("GET", "/image/"+drawing.ID+".png", nil, "")
	missing, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Contains(missing, []byte("图片已被删除")) {
		t.Fatalf("missing image fallback: %d %q", resp.StatusCode, missing)
	}
	if status := c.autosaveContent(drawing.ID, `{"code":"flowchart LR\nA-->B","theme":"neutral"}`, pngA); status != 200 {
		t.Fatalf("mermaid autosave: %d", status)
	}
}

func TestAuthLifecycleAndRestart(t *testing.T) {
	dir := t.TempDir()
	a, s := newTestApp(t, dir)
	c := tc(t, s)
	u := c.login("alice")
	firstCookie := c.cookie
	u2 := c.login("alice")
	if u.ID != u2.ID {
		t.Fatal("existing username created a second user")
	}
	c.cookie = firstCookie
	resp := c.req("GET", "/api/me", nil, "")
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("session status %d", resp.StatusCode)
	}
	s.Close()
	_ = a.Close()
	a2, e := Open(Config{DataDir: dir}, nil)
	if e != nil {
		t.Fatal(e)
	}
	s2 := httptest.NewServer(a2)
	defer s2.Close()
	defer a2.Close()
	c.base = s2.URL
	c.client = s2.Client()
	resp = c.req("GET", "/api/me", nil, "")
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("persisted session status %d", resp.StatusCode)
	}
	resp = c.req("POST", "/api/logout", nil, "")
	resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Fatalf("logout status %d", resp.StatusCode)
	}
	resp = c.req("GET", "/api/me", nil, "")
	resp.Body.Close()
	if resp.StatusCode != 401 {
		t.Fatalf("logged-out session status %d", resp.StatusCode)
	}
}

func TestPermissionsCRUDAndImages(t *testing.T) {
	a, s := newTestApp(t, t.TempDir())
	defer s.Close()
	defer a.Close()
	alice := tc(t, s)
	alice.login("alice")
	d := alice.create("architecture")
	if !d.CanDelete {
		t.Fatal("owner cannot delete")
	}
	bob := tc(t, s)
	bob.login("bob")
	resp := bob.req("GET", "/api/drawings/"+d.ID, nil, "")
	var got Drawing
	_ = json.NewDecoder(resp.Body).Decode(&got)
	resp.Body.Close()
	if resp.StatusCode != 200 || got.CanDelete {
		t.Fatalf("read/canDelete: %d %v", resp.StatusCode, got.CanDelete)
	}
	resp = bob.req("PATCH", "/api/drawings/"+d.ID, strings.NewReader(`{"name":"renamed"}`), "application/json")
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatalf("edit status %d", resp.StatusCode)
	}
	resp = bob.req("DELETE", "/api/drawings/"+d.ID, nil, "")
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatalf("non-owner delete status %d", resp.StatusCode)
	}
	if status := bob.autosave(d.ID, pngA); status != 200 {
		t.Fatalf("autosave %d", status)
	}
	resp = bob.req("GET", "/api/drawings/"+d.ID, nil, "")
	_ = json.NewDecoder(resp.Body).Decode(&got)
	resp.Body.Close()
	if got.UpdatedBy == nil || got.UpdatedBy.Username != "bob" {
		t.Fatalf("updatedBy = %#v, want bob", got.UpdatedBy)
	}
	resp = bob.req("GET", "/image/"+d.ID+".png", nil, "")
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Equal(body, pngA) {
		t.Fatalf("first image %d %q", resp.StatusCode, body)
	}
	if cc := resp.Header.Get("Cache-Control"); !strings.Contains(cc, "no-store") {
		t.Fatalf("cache-control %q", cc)
	}
	if status := alice.autosave(d.ID, pngB); status != 200 {
		t.Fatalf("overwrite %d", status)
	}
	resp = alice.req("GET", "/image/"+d.ID+".png", nil, "")
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if !bytes.Equal(body, pngB) {
		t.Fatalf("stale image %q", body)
	}
	resp = alice.req("DELETE", "/api/drawings/"+d.ID, nil, "")
	resp.Body.Close()
	if resp.StatusCode != 204 {
		t.Fatalf("owner delete %d", resp.StatusCode)
	}
	resp = alice.req("GET", "/image/"+d.ID+".png", nil, "")
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Contains(body, []byte("图片已被删除")) || !strings.Contains(resp.Header.Get("Content-Type"), "image/svg+xml") {
		t.Fatalf("deleted image fallback %d %q", resp.StatusCode, body)
	}
}

func TestInvalidUploadAndAtomicConcurrentImageReads(t *testing.T) {
	a, s := newTestApp(t, t.TempDir())
	defer s.Close()
	defer a.Close()
	c := tc(t, s)
	c.login("alice")
	d := c.create("atomic")
	if status := c.autosave(d.ID, []byte("not-png")); status != 400 {
		t.Fatalf("invalid PNG status %d", status)
	}
	if status := c.autosave(d.ID, pngA); status != 200 {
		t.Fatal(status)
	}
	var wg sync.WaitGroup
	errs := make(chan string, 100)
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp, e := c.client.Get(c.base + "/image/" + d.ID + ".png")
			if e != nil {
				errs <- e.Error()
				return
			}
			b, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			if !bytes.Equal(b, pngA) && !bytes.Equal(b, pngB) {
				errs <- fmt.Sprintf("partial: %q", b)
			}
		}()
	}
	if status := c.autosave(d.ID, pngB); status != 200 {
		t.Fatal(status)
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
	matches, _ := filepath.Glob(filepath.Join(a.imagesDir, ".*.tmp"))
	if len(matches) != 0 {
		t.Fatalf("temporary files remain: %v", matches)
	}
}

func TestDrawingAndSceneSurviveRestart(t *testing.T) {
	dir := t.TempDir()
	a, s := newTestApp(t, dir)
	c := tc(t, s)
	c.login("alice")
	d := c.create("persistent")
	if c.autosave(d.ID, pngA) != 200 {
		t.Fatal("autosave")
	}
	cookie := c.cookie
	s.Close()
	_ = a.Close()
	a2, e := Open(Config{DataDir: dir}, nil)
	if e != nil {
		t.Fatal(e)
	}
	s2 := httptest.NewServer(a2)
	defer s2.Close()
	defer a2.Close()
	c.base = s2.URL
	c.client = s2.Client()
	c.cookie = cookie
	resp := c.req("GET", "/api/drawings/"+d.ID, nil, "")
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal(resp.StatusCode)
	}
	b, _ := os.ReadFile(filepath.Join(dir, "images", d.ID+".png"))
	if !bytes.Equal(b, pngA) {
		t.Fatal("image did not persist")
	}
}

func TestUserAndProjectTreesAndStats(t *testing.T) {
	a, s := newTestApp(t, t.TempDir())
	defer s.Close()
	defer a.Close()
	c := tc(t, s)
	u := c.login("alice")

	resp := c.req("POST", "/api/folders", strings.NewReader(fmt.Sprintf(`{"name":"设计","space":"user","userId":%q}`, u.ID)), "application/json")
	var userFolder Folder
	if err := json.NewDecoder(resp.Body).Decode(&userFolder); err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("create user folder: %d", resp.StatusCode)
	}

	resp = c.req("POST", "/api/projects", strings.NewReader(`{"name":"Apollo"}`), "application/json")
	var project Project
	_ = json.NewDecoder(resp.Body).Decode(&project)
	resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("create project: %d", resp.StatusCode)
	}
	resp = c.req("POST", "/api/folders", strings.NewReader(fmt.Sprintf(`{"name":"架构","space":"project","projectId":%q}`, project.ID)), "application/json")
	var projectFolder Folder
	_ = json.NewDecoder(resp.Body).Decode(&projectFolder)
	resp.Body.Close()
	if resp.StatusCode != 201 {
		t.Fatalf("create project folder: %d", resp.StatusCode)
	}

	resp = c.req("POST", "/api/drawings", strings.NewReader(fmt.Sprintf(`{"name":"system","space":"project","projectId":%q,"folderId":%q}`, project.ID, projectFolder.ID)), "application/json")
	var drawing Drawing
	_ = json.NewDecoder(resp.Body).Decode(&drawing)
	resp.Body.Close()
	if resp.StatusCode != 201 || drawing.Space != "project" || drawing.ProjectID == nil {
		t.Fatalf("project drawing: %d %#v", resp.StatusCode, drawing)
	}

	resp = c.req("GET", "/api/tree", nil, "")
	var tree TreeResponse
	_ = json.NewDecoder(resp.Body).Decode(&tree)
	resp.Body.Close()
	if len(tree.Projects) != 1 || len(tree.Folders) != 2 || len(tree.Drawings) != 1 {
		t.Fatalf("tree = %#v", tree)
	}
	resp = c.req("DELETE", "/api/folders/"+projectFolder.ID, nil, "")
	resp.Body.Close()
	if resp.StatusCode != 409 {
		t.Fatalf("non-empty folder delete = %d", resp.StatusCode)
	}

	resp = c.req("GET", "/api/stats", nil, "")
	var stats Stats
	_ = json.NewDecoder(resp.Body).Decode(&stats)
	resp.Body.Close()
	if stats.DailyActive != 1 || stats.MonthlyActive != 1 || len(stats.Activity) == 0 || len(stats.ProjectFiles) != 1 || stats.ProjectFiles[0].Count != 1 {
		t.Fatalf("stats = %#v", stats)
	}
}
