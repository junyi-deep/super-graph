ALTER TABLE drawings ADD COLUMN drawing_type TEXT NOT NULL DEFAULT 'excalidraw'
  CHECK(drawing_type IN ('excalidraw','mermaid'));
CREATE INDEX idx_drawings_type ON drawings(drawing_type);
INSERT INTO schema_migrations(version, applied_at) VALUES (3, unixepoch());
