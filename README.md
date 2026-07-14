# PulseBoard — ESP32-C3 Remote Control

Control multiple ESP32-C3 boards from a web app over local network or the internet. Flash a minimal agent once; pin modes, signals, PWM, ADC reads, and display content are driven live from the app via the **IO Programmer** — not hardcoded in the module sketch.

## Stack

- **Backend:** Go (REST + WebSocket), SQLite
- **Frontend:** React + Vite + TypeScript
- **Firmware:** Arduino sketches (WebSocket agent)

## Quick start

### 1. Backend

```bash
cd backend
go run ./cmd/server
```

Listens on `http://localhost:8080`. SQLite DB is created at `backend/data/esp32c3.db`.

### 2. Frontend (dev)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` (API/WebSocket proxied to the Go server).

### 3. Production-style (single process)

```bash
cd frontend && npm run build && cd ../backend
STATIC_DIR=../frontend/dist go run ./cmd/server
```

Then open `http://localhost:8080`.

## How it works

1. Create a device in the UI — you get a unique **device token**.
2. Open **Firmware**, copy a preset, set WiFi + `SERVER_HOST` + `DEVICE_TOKEN`.
3. Upload to the board. It connects to `/ws/device?token=...`.
4. Open the device → **Program IOs** to enable GPIOs, set modes (`input`, `output`, `pwm`, `adc`, …), add/remove pins, and control values live.
5. Boards with OLED/LCD show a **Display** panel for text, brightness, and clear.

Commands are delivered instantly over WebSocket when online, or queued in SQLite until the board reconnects.

## Network modes

| Mode | Firmware settings |
|------|-------------------|
| Local LAN | `USE_SSL = false`, `SERVER_HOST = 192.168.x.x`, `SERVER_PORT = 8080` |
| Internet | Host this app behind HTTPS, `USE_SSL = true`, `SERVER_HOST = your-domain.com`, `SERVER_PORT = 443` |

## API overview

- `GET/POST /api/devices`
- `GET/PUT/DELETE /api/devices/{id}`
- `PUT /api/devices/{id}/pins`
- `POST /api/devices/{id}/pins` — add a GPIO to the IO program
- `DELETE /api/devices/{id}/pins/{gpio}` — remove a GPIO from the program
- `PUT /api/devices/{id}/display`
- `GET/PUT /api/devices/{id}/bus` — SDA / SCL / RX / TX / baud
- `POST /api/devices/{id}/serial` — print a line on the device Serial Monitor
- `GET /api/devices/{id}/events` — telemetry and data from the module
- `POST /api/devices/{id}/sync`
- `GET /api/firmware/presets`
- `WS /ws/frontend` — UI live updates
- `WS /ws/device?token=...` — board agent

## Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8080` | HTTP listen port |
| `DATA_DIR` | `./data` | SQLite directory |
| `STATIC_DIR` | `../frontend/dist` | Built frontend (optional) |

## Project layout

```
backend/          Go API + WebSocket hub + SQLite
frontend/         React control panel
firmware/         Arduino agent sketches (also served as presets in UI)
```
