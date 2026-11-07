// Package web embeds the built React app (web/dist, produced by `npm run
// build`). In a Go-only checkout dist holds just .gitkeep, and the server
// shows a short hint instead of the app.
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist returns the built app's files, and whether a build is present.
func Dist() (fs.FS, bool) {
	sub, err := fs.Sub(dist, "dist")
	if err != nil {
		return nil, false
	}
	_, err = fs.Stat(sub, "index.html")
	return sub, err == nil
}
