package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/esp32-c3/controller/internal/db"
	"github.com/esp32-c3/controller/internal/models"
	"github.com/esp32-c3/controller/internal/ws"
	"github.com/gorilla/mux"
)

type API struct {
	Store *db.Store
	Hub   *ws.Hub
}

func (a *API) Register(r *mux.Router) {
	api := r.PathPrefix("/api").Subrouter()
	api.HandleFunc("/health", a.Health).Methods("GET")
	api.HandleFunc("/devices", a.ListDevices).Methods("GET")
	api.HandleFunc("/devices", a.CreateDevice).Methods("POST")
	api.HandleFunc("/devices/{id}", a.GetDevice).Methods("GET")
	api.HandleFunc("/devices/{id}", a.UpdateDevice).Methods("PUT")
	api.HandleFunc("/devices/{id}", a.DeleteDevice).Methods("DELETE")
	api.HandleFunc("/devices/{id}/pins", a.GetPins).Methods("GET")
	api.HandleFunc("/devices/{id}/pins", a.UpdatePin).Methods("PUT")
	api.HandleFunc("/devices/{id}/display", a.GetDisplay).Methods("GET")
	api.HandleFunc("/devices/{id}/display", a.UpdateDisplay).Methods("PUT")
	api.HandleFunc("/devices/{id}/sync", a.SyncDevice).Methods("POST")
	api.HandleFunc("/firmware/presets", a.ListFirmwarePresets).Methods("GET")
	api.HandleFunc("/meta/board-types", a.BoardTypes).Methods("GET")
}

func (a *API) Health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (a *API) ListDevices(w http.ResponseWriter, r *http.Request) {
	devices, err := a.Store.ListDevices()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for i := range devices {
		devices[i].Online = a.Hub.IsOnline(devices[i].ID) || devices[i].Online
	}
	writeJSON(w, http.StatusOK, devices)
}

func (a *API) CreateDevice(w http.ResponseWriter, r *http.Request) {
	var req models.CreateDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.HasDisplay && req.DisplayType == "none" {
		req.DisplayType = "oled_ssd1306"
	}
	device, err := a.Store.CreateDevice(req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.Hub.BroadcastFrontend(ws.Message{Type: "device_created", ID: device.ID})
	writeJSON(w, http.StatusCreated, device)
}

func (a *API) GetDevice(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	device, err := a.Store.GetDevice(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "device not found")
		return
	}
	device.Online = a.Hub.IsOnline(device.ID) || device.Online
	pins, _ := a.Store.GetPins(id)
	display, _ := a.Store.GetDisplay(id)
	writeJSON(w, http.StatusOK, map[string]any{
		"device":  device,
		"pins":    pins,
		"display": display,
		"pinout":  models.PinoutForBoard(device.BoardType),
	})
}

func (a *API) UpdateDevice(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	var req models.UpdateDeviceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	device, err := a.Store.UpdateDevice(id, req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.Hub.BroadcastFrontend(ws.Message{Type: "device_updated", ID: id})
	writeJSON(w, http.StatusOK, device)
}

func (a *API) DeleteDevice(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	if err := a.Store.DeleteDevice(id); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	a.Hub.BroadcastFrontend(ws.Message{Type: "device_deleted", ID: id})
	writeJSON(w, http.StatusOK, map[string]string{"ok": "true"})
}

func (a *API) GetPins(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	pins, err := a.Store.GetPins(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, pins)
}

func (a *API) UpdatePin(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	var req models.PinUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if !models.ValidModes[req.Mode] {
		writeErr(w, http.StatusBadRequest, "invalid mode")
		return
	}
	pin, err := a.Store.UpdatePin(id, req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	payload := map[string]any{
		"gpio":     pin.GPIO,
		"label":    pin.Label,
		"mode":     pin.Mode,
		"value":    pin.Value,
		"pwm_freq": pin.PWMFreq,
		"enabled":  pin.Enabled,
	}
	cmd, err := a.Hub.PushCommand(id, "pin_set", payload)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	a.Hub.BroadcastFrontend(ws.Message{Type: "pin_updated", ID: id, Payload: mustRaw(pin)})
	writeJSON(w, http.StatusOK, map[string]any{"pin": pin, "command": cmd})
}

func (a *API) GetDisplay(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	display, err := a.Store.GetDisplay(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if display == nil {
		writeJSON(w, http.StatusOK, nil)
		return
	}
	writeJSON(w, http.StatusOK, display)
}

func (a *API) UpdateDisplay(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	var req models.DisplayUpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "invalid json")
		return
	}
	if req.TextLines == nil {
		req.TextLines = []string{}
	}
	display, err := a.Store.UpdateDisplay(id, req)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	payload := map[string]any{
		"enabled":    display.Enabled,
		"brightness": display.Brightness,
		"text_lines": req.TextLines,
		"clear":      display.Clear,
	}
	cmd, err := a.Hub.PushCommand(id, "display_set", payload)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}

	a.Hub.BroadcastFrontend(ws.Message{Type: "display_updated", ID: id, Payload: mustRaw(display)})
	writeJSON(w, http.StatusOK, map[string]any{"display": display, "command": cmd})
}

func (a *API) SyncDevice(w http.ResponseWriter, r *http.Request) {
	id := mux.Vars(r)["id"]
	pins, _ := a.Store.GetPins(id)
	display, _ := a.Store.GetDisplay(id)
	payload := map[string]any{"pins": pins, "display": display}
	cmd, err := a.Hub.PushCommand(id, "sync", payload)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"command": cmd, "online": a.Hub.IsOnline(id)})
}

func (a *API) BoardTypes(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"board_types":   models.BoardTypes,
		"display_types": models.DisplayTypes,
		"modes":         []string{"disabled", "input", "input_pullup", "output", "pwm", "adc"},
		"default_gpios": models.DefaultGPIOs,
		"pinouts": map[string]models.BoardPinout{
			"esp32-c3":      models.PinoutForBoard("esp32-c3"),
			"esp32-c3-oled": models.PinoutForBoard("esp32-c3-oled"),
			"esp32-c3-lcd":  models.PinoutForBoard("esp32-c3-lcd"),
		},
	})
}

func (a *API) ListFirmwarePresets(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, FirmwarePresets())
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func mustRaw(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}
