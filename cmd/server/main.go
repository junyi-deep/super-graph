package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/Deln0r/ygo/persist/sqlite"
	"github.com/junyi-deep/super-graph/internal/app"
	"github.com/junyi-deep/super-graph/internal/collaboration"
	"github.com/junyi-deep/super-graph/internal/runtimecfg"
)

func main() {
	cfg, err := runtimecfg.Load(os.Getenv("SUPER_GRAPH_CONFIG"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "startup failed:", err)
		os.Exit(1)
	}
	logger, logFile, err := cfg.OpenLogger()
	if err != nil {
		fmt.Fprintln(os.Stderr, "open log failed:", err)
		os.Exit(1)
	}
	defer logFile.Close()
	duration, err := time.ParseDuration(cfg.AutosaveInterval)
	if err != nil {
		logger.Error("invalid autosave interval", "error", err)
		os.Exit(2)
	}
	dataDir := cfg.Resolve(cfg.DataDir)
	a, err := app.Open(app.Config{DataDir: dataDir, SessionDays: cfg.SessionDays, AutosaveInterval: duration, MaxUploadSize: cfg.MaxUploadSize}, logger)
	if err != nil {
		logger.Error("startup failed", "error", err)
		os.Exit(1)
	}
	defer a.Close()
	yStore, err := sqlite.Open(filepath.Join(dataDir, "collaboration.db"))
	if err != nil {
		logger.Error("collaboration store failed", "error", err)
		os.Exit(1)
	}
	defer yStore.Close()
	collab := collaboration.New(yStore, a, logger)
	a.SetCollaboration(collab)
	listen := fmt.Sprintf(":%d", cfg.Port)
	srv := &http.Server{Addr: listen, Handler: a, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}
	go func() {
		logger.Info("server startup", "listen", listen, "database", filepath.Join(dataDir, "app.db"), "config", cfg.ConfigPath())
		if e := srv.ListenAndServe(); e != nil && e != http.ErrServerClosed {
			logger.Error("server failed", "error", e)
			os.Exit(1)
		}
	}()
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	<-ctx.Done()
	shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	_ = srv.Shutdown(shutdown)
	_ = collab.Close(shutdown)
}
