package ws

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/esp32-c3/controller/internal/db"
	"github.com/esp32-c3/controller/internal/models"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
	ID      string          `json:"id,omitempty"`
}

type Hub struct {
	store       *db.Store
	mu          sync.RWMutex
	devices     map[string]*websocket.Conn // deviceID -> conn
	frontends   map[*websocket.Conn]bool
	deviceConns map[*websocket.Conn]string // conn -> deviceID
}

func NewHub(store *db.Store) *Hub {
	return &Hub{
		store:       store,
		devices:     make(map[string]*websocket.Conn),
		frontends:   make(map[*websocket.Conn]bool),
		deviceConns: make(map[*websocket.Conn]string),
	}
}

func (h *Hub) HandleFrontend(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	h.mu.Lock()
	h.frontends[conn] = true
	h.mu.Unlock()

	defer func() {
		h.mu.Lock()
		delete(h.frontends, conn)
		h.mu.Unlock()
		conn.Close()
	}()

	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	go func() {
		ticker := time.NewTicker(30 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		}
	}()

	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

func (h *Hub) HandleDevice(w http.ResponseWriter, r *http.Request) {
	token := r.URL.Query().Get("token")
	if token == "" {
		http.Error(w, "token required", http.StatusUnauthorized)
		return
	}
	device, err := h.store.GetDeviceByToken(token)
	if err != nil {
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	h.mu.Lock()
	if old, ok := h.devices[device.ID]; ok {
		old.Close()
		delete(h.deviceConns, old)
	}
	h.devices[device.ID] = conn
	h.deviceConns[conn] = device.ID
	h.mu.Unlock()

	_ = h.store.SetDeviceOnline(device.ID, true, "", "")
	h.BroadcastFrontend(Message{Type: "device_online", ID: device.ID})

	defer func() {
		h.mu.Lock()
		if h.devices[device.ID] == conn {
			delete(h.devices, device.ID)
		}
		delete(h.deviceConns, conn)
		h.mu.Unlock()
		_ = h.store.SetDeviceOnline(device.ID, false, "", "")
		h.BroadcastFrontend(Message{Type: "device_offline", ID: device.ID})
		conn.Close()
	}()

	// Send full sync on connect
	h.sendSync(device.ID, conn)

	// Flush pending commands
	cmds, _ := h.store.GetPendingCommands(device.ID)
	for _, cmd := range cmds {
		h.writeJSON(conn, Message{Type: cmd.Type, ID: cmd.ID, Payload: json.RawMessage(cmd.Payload)})
		_ = h.store.MarkCommandStatus(cmd.ID, "sent")
	}

	conn.SetReadDeadline(time.Now().Add(90 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		return nil
	})

	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			if err := conn.WriteControl(websocket.PingMessage, []byte{}, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		}
	}()

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			break
		}
		conn.SetReadDeadline(time.Now().Add(90 * time.Second))
		h.handleDeviceMessage(device.ID, data)
	}
}

func (h *Hub) handleDeviceMessage(deviceID string, data []byte) {
	var msg Message
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}

	switch msg.Type {
	case "hello":
		var status models.DeviceStatusPayload
		if err := json.Unmarshal(msg.Payload, &status); err == nil {
			_ = h.store.SetDeviceOnline(deviceID, true, status.FirmwareVer, status.LocalIP)
			for _, p := range status.Pins {
				_ = h.store.UpdatePinValue(deviceID, p.GPIO, p.Value)
			}
			_, _ = h.store.InsertDeviceEvent(deviceID, "hello", status)
			h.BroadcastFrontend(Message{Type: "device_status", ID: deviceID, Payload: msg.Payload})
		}
	case "telemetry":
		var status models.DeviceStatusPayload
		if err := json.Unmarshal(msg.Payload, &status); err == nil {
			_ = h.store.SetDeviceOnline(deviceID, true, status.FirmwareVer, status.LocalIP)
			for _, p := range status.Pins {
				_ = h.store.UpdatePinValue(deviceID, p.GPIO, p.Value)
			}
			// Always persist telemetry samples (including heartbeats with empty pins)
			_, _ = h.store.InsertDeviceEvent(deviceID, "telemetry", json.RawMessage(msg.Payload))
			h.BroadcastFrontend(Message{Type: "telemetry", ID: deviceID, Payload: msg.Payload})
		} else {
			// Fallback: keep raw payload so the UI still shows something
			_, _ = h.store.InsertDeviceEvent(deviceID, "telemetry", json.RawMessage(msg.Payload))
			h.BroadcastFrontend(Message{Type: "telemetry", ID: deviceID, Payload: msg.Payload})
		}
	case "data":
		var payload models.DeviceDataPayload
		if err := json.Unmarshal(msg.Payload, &payload); err == nil {
			_, _ = h.store.InsertDeviceEvent(deviceID, "data", payload)
			h.BroadcastFrontend(Message{Type: "device_data", ID: deviceID, Payload: msg.Payload})
		}
	case "ack":
		if msg.ID != "" {
			_ = h.store.MarkCommandStatus(msg.ID, "acked")
			h.BroadcastFrontend(Message{Type: "command_acked", ID: msg.ID, Payload: mustJSON(map[string]string{"device_id": deviceID})})
		}
	case "pong":
		_ = h.store.SetDeviceOnline(deviceID, true, "", "")
	default:
		log.Printf("unknown device message type: %s", msg.Type)
	}
}

func (h *Hub) sendSync(deviceID string, conn *websocket.Conn) {
	device, _ := h.store.GetDevice(deviceID)
	pins, _ := h.store.GetPins(deviceID)
	display, _ := h.store.GetDisplay(deviceID)
	boardType := "esp32-c3"
	if device != nil {
		boardType = device.BoardType
	}
	bus, _ := h.store.EnsureBus(deviceID, boardType)
	payload := models.SyncCommandPayload(pins, display, bus)
	h.writeJSON(conn, Message{Type: "sync", Payload: mustJSON(payload)})
}

func (h *Hub) SendToDevice(deviceID string, msg Message) bool {
	h.mu.RLock()
	conn, ok := h.devices[deviceID]
	h.mu.RUnlock()
	if !ok {
		return false
	}
	return h.writeJSON(conn, msg)
}

func (h *Hub) IsOnline(deviceID string) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.devices[deviceID]
	return ok
}

func (h *Hub) BroadcastFrontend(msg Message) {
	data, err := json.Marshal(msg)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for conn := range h.frontends {
		_ = conn.WriteMessage(websocket.TextMessage, data)
	}
}

func (h *Hub) writeJSON(conn *websocket.Conn, msg Message) bool {
	data, err := json.Marshal(msg)
	if err != nil {
		return false
	}
	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		return false
	}
	return true
}

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

// PushCommand stores and optionally delivers a command to the device.
func (h *Hub) PushCommand(deviceID, cmdType string, payload any) (*models.Command, error) {
	cmd, err := h.store.CreateCommand(deviceID, cmdType, payload)
	if err != nil {
		return nil, err
	}
	sent := h.SendToDevice(deviceID, Message{
		Type:    cmdType,
		ID:      cmd.ID,
		Payload: mustJSON(payload),
	})
	if sent {
		_ = h.store.MarkCommandStatus(cmd.ID, "sent")
		cmd.Status = "sent"
	}
	return cmd, nil
}
