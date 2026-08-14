CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    space_type TEXT NOT NULL CHECK(space_type IN ('user','project')),
    user_id TEXT,
    project_id TEXT,
    parent_id TEXT,
    created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY(parent_id) REFERENCES folders(id) ON DELETE RESTRICT,
    FOREIGN KEY(created_by) REFERENCES users(id)
);
CREATE TABLE activity_daily (
    user_id TEXT NOT NULL,
    day TEXT NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY(user_id, day),
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
ALTER TABLE drawings ADD COLUMN space_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE drawings ADD COLUMN folder_id TEXT REFERENCES folders(id);
ALTER TABLE drawings ADD COLUMN project_id TEXT REFERENCES projects(id);
CREATE INDEX idx_folders_parent ON folders(parent_id);
CREATE INDEX idx_folders_user ON folders(user_id);
CREATE INDEX idx_folders_project ON folders(project_id);
CREATE INDEX idx_drawings_folder ON drawings(folder_id);
CREATE INDEX idx_drawings_project ON drawings(project_id);
