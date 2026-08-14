.PHONY: dev-backend dev-frontend build-frontend build test clean

dev-backend:
	SUPER_GRAPH_CONFIG=$(CURDIR)/.s-graph/config.json go run ./cmd/server

dev-frontend:
	cd web && npm run dev

build-frontend:
	cd web && npm ci && npm run build

build: build-frontend
	mkdir -p dist
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o dist/super-graph ./cmd/server

test:
	go test -race ./...
	cd web && npm test

clean:
	go clean
