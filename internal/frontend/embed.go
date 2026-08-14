package frontend

import "embed"

// Dist contains the production Vite bundle. The checked-in index is a
// developer-friendly placeholder and is replaced by `npm run build`.
//
//go:embed dist/*
var Dist embed.FS
