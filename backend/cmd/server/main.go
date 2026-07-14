package main

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/esp32-c3/controller/internal/db"
	"github.com/esp32-c3/controller/internal/handlers"
	"github.com/esp32-c3/controller/internal/ws"
	"github.com/gorilla/mux"
	"github.com/rs/cors"
)

func main() {
	port := env("PORT", "8080")
	dataDir := env("DATA_DIR", "./data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		log.Fatal(err)
	}
	dbPath := filepath.Join(dataDir, "esp32c3.db")

	store, err := db.New(dbPath)
	if err != nil {
		log.Fatalf("db: %v", err)
	}
	defer store.Close()

	hub := ws.NewHub(store)
	api := &handlers.API{Store: store, Hub: hub}

	r := mux.NewRouter()
	api.Register(r)
	r.HandleFunc("/ws/frontend", hub.HandleFrontend)
	r.HandleFunc("/ws/device", hub.HandleDevice)

	// Serve frontend build if present
	staticDir := env("STATIC_DIR", "../frontend/dist")
	if abs, err := filepath.Abs(staticDir); err == nil {
		staticDir = abs
	}
	if info, err := os.Stat(staticDir); err == nil && info.IsDir() {
		log.Printf("Serving frontend from %s", staticDir)
		fs := http.FileServer(http.Dir(staticDir))
		r.PathPrefix("/").Handler(spaHandler(staticDir, fs))
	} else {
		log.Printf("No frontend build at %s (API only)", staticDir)
	}

	c := cors.New(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"*"},
		AllowCredentials: false,
	})

	go func() {
		ticker := time.NewTicker(60 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			_ = store.MarkOfflineStale(2 * time.Minute)
		}
	}()

	addr := ":" + port
	log.Printf("ESP32-C3 Controller listening on %s", addr)
	log.Printf("Database: %s", dbPath)
	if err := http.ListenAndServe(addr, c.Handler(r)); err != nil {
		log.Fatal(err)
	}
}

func spaHandler(staticDir string, fileServer http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := filepath.Join(staticDir, r.URL.Path)
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			fileServer.ServeHTTP(w, r)
			return
		}
		http.ServeFile(w, r, filepath.Join(staticDir, "index.html"))
	})
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
