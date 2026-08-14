package runtimecfg

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"time"
)

type Config struct {
	Port                int    `json:"port"`
	DataDir             string `json:"dataDir"`
	LogDir              string `json:"logDir"`
	LogRetentionDays    int    `json:"logRetentionDays"`
	SessionDays         int    `json:"sessionDays"`
	AutosaveInterval    string `json:"autosaveInterval"`
	MaxUploadSize       int64  `json:"maxUploadSize"`
	configPath          string
	executableDirectory string
}

func Defaults() Config {
	return Config{
		Port:             7988,
		DataDir:          ".s-graph/data",
		LogDir:           ".s-graph/logs",
		LogRetentionDays: 30,
		SessionDays:      30,
		AutosaveInterval: "3s",
		MaxUploadSize:    32 << 20,
	}
}

func DefaultPath() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	executable, err = filepath.EvalSymlinks(executable)
	if err != nil {
		return "", err
	}
	return filepath.Join(filepath.Dir(executable), ".s-graph", "config.json"), nil
}

func Load(path string) (Config, error) {
	if path == "" {
		var err error
		path, err = DefaultPath()
		if err != nil {
			return Config{}, fmt.Errorf("locate executable: %w", err)
		}
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return Config{}, err
	}
	cfg := Defaults()
	if err = os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return Config{}, fmt.Errorf("create config directory: %w", err)
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		data, err = json.MarshalIndent(cfg, "", "  ")
		if err == nil {
			data = append(data, '\n')
			err = os.WriteFile(path, data, 0o640)
		}
	} else if err == nil {
		err = json.Unmarshal(data, &cfg)
	}
	if err != nil {
		return Config{}, fmt.Errorf("load config %s: %w", path, err)
	}
	if cfg.Port < 1 || cfg.Port > 65535 {
		return Config{}, fmt.Errorf("port must be between 1 and 65535")
	}
	if cfg.DataDir == "" || cfg.LogDir == "" {
		return Config{}, fmt.Errorf("dataDir and logDir are required")
	}
	if cfg.LogRetentionDays <= 0 {
		cfg.LogRetentionDays = 30
	}
	if cfg.SessionDays <= 0 {
		cfg.SessionDays = 30
	}
	if cfg.MaxUploadSize <= 0 {
		cfg.MaxUploadSize = 32 << 20
	}
	if _, err = time.ParseDuration(cfg.AutosaveInterval); err != nil {
		return Config{}, fmt.Errorf("invalid autosaveInterval: %w", err)
	}
	cfg.configPath = path
	cfg.executableDirectory = filepath.Dir(filepath.Dir(path))
	return cfg, nil
}

func (c Config) ConfigPath() string { return c.configPath }
func (c Config) Resolve(path string) string {
	if filepath.IsAbs(path) {
		return filepath.Clean(path)
	}
	return filepath.Join(c.executableDirectory, path)
}

func (c Config) OpenLogger() (*slog.Logger, io.Closer, error) {
	directory := c.Resolve(c.LogDir)
	if err := os.MkdirAll(directory, 0o750); err != nil {
		return nil, nil, err
	}
	cutoff := time.Now().AddDate(0, 0, -c.LogRetentionDays)
	entries, _ := os.ReadDir(directory)
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err == nil && info.ModTime().Before(cutoff) {
			_ = os.Remove(filepath.Join(directory, entry.Name()))
		}
	}
	path := filepath.Join(directory, "super-graph-"+time.Now().Format("2006-01-02")+".log")
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
	if err != nil {
		return nil, nil, err
	}
	writer := io.MultiWriter(os.Stdout, file)
	return slog.New(slog.NewJSONHandler(writer, nil)), file, nil
}
