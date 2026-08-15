package runtimecfg

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestLoadCreatesDefaultsAndResolvesPaths(t *testing.T) {
	base := t.TempDir()
	path := filepath.Join(base, ".s-graph", "config.json")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Port != 7988 || cfg.LogRetentionDays != 30 || cfg.AdminPassword == "" || cfg.DefaultDrawingLimit != 16 {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
	if cfg.Resolve(cfg.DataDir) != filepath.Join(base, ".s-graph", "data") {
		t.Fatalf("unexpected data path: %s", cfg.Resolve(cfg.DataDir))
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var persisted Config
	if err = json.Unmarshal(data, &persisted); err != nil || persisted.Port != 7988 {
		t.Fatalf("invalid generated config: %v, %+v", err, persisted)
	}
}
