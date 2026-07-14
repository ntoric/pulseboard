package db

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/esp32-c3/controller/internal/models"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
)

type Store struct {
	db *sql.DB
}

func New(path string) (*Store, error) {
	db, err := sql.Open("sqlite3", path+"?_foreign_keys=on&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS devices (
		id TEXT PRIMARY KEY,
		name TEXT NOT NULL,
		token TEXT NOT NULL UNIQUE,
		board_type TEXT NOT NULL DEFAULT 'esp32-c3',
		has_display INTEGER NOT NULL DEFAULT 0,
		display_type TEXT NOT NULL DEFAULT 'none',
		online INTEGER NOT NULL DEFAULT 0,
		last_seen DATETIME,
		firmware_ver TEXT DEFAULT '',
		local_ip TEXT DEFAULT '',
		notes TEXT DEFAULT '',
		created_at DATETIME NOT NULL,
		updated_at DATETIME NOT NULL
	);

	CREATE TABLE IF NOT EXISTS pin_configs (
		id TEXT PRIMARY KEY,
		device_id TEXT NOT NULL,
		gpio INTEGER NOT NULL,
		label TEXT DEFAULT '',
		mode TEXT NOT NULL DEFAULT 'disabled',
		value INTEGER NOT NULL DEFAULT 0,
		pwm_freq INTEGER NOT NULL DEFAULT 1000,
		enabled INTEGER NOT NULL DEFAULT 0,
		updated_at DATETIME NOT NULL,
		UNIQUE(device_id, gpio),
		FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS display_states (
		id TEXT PRIMARY KEY,
		device_id TEXT NOT NULL UNIQUE,
		enabled INTEGER NOT NULL DEFAULT 0,
		brightness INTEGER NOT NULL DEFAULT 128,
		text_lines TEXT NOT NULL DEFAULT '[]',
		clear INTEGER NOT NULL DEFAULT 0,
		updated_at DATETIME NOT NULL,
		FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
	);

	CREATE TABLE IF NOT EXISTS commands (
		id TEXT PRIMARY KEY,
		device_id TEXT NOT NULL,
		type TEXT NOT NULL,
		payload TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending',
		created_at DATETIME NOT NULL,
		acked_at DATETIME,
		FOREIGN KEY(device_id) REFERENCES devices(id) ON DELETE CASCADE
	);

	CREATE INDEX IF NOT EXISTS idx_commands_device_status ON commands(device_id, status);
	CREATE INDEX IF NOT EXISTS idx_pins_device ON pin_configs(device_id);
	`
	_, err := s.db.Exec(schema)
	return err
}

func (s *Store) CreateDevice(req models.CreateDeviceRequest) (*models.Device, error) {
	now := time.Now().UTC()
	d := &models.Device{
		ID:          uuid.New().String(),
		Name:        req.Name,
		Token:       uuid.New().String(),
		BoardType:   req.BoardType,
		HasDisplay:  req.HasDisplay,
		DisplayType: req.DisplayType,
		Notes:       req.Notes,
		CreatedAt:   now,
		UpdatedAt:   now,
	}
	if d.BoardType == "" {
		d.BoardType = "esp32-c3"
	}
	if d.DisplayType == "" {
		d.DisplayType = "none"
	}
	if d.Name == "" {
		d.Name = "ESP32-C3"
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	_, err = tx.Exec(`
		INSERT INTO devices (id, name, token, board_type, has_display, display_type, online, firmware_ver, local_ip, notes, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 0, '', '', ?, ?, ?)`,
		d.ID, d.Name, d.Token, d.BoardType, boolToInt(d.HasDisplay), d.DisplayType, d.Notes, d.CreatedAt, d.UpdatedAt)
	if err != nil {
		return nil, err
	}

	for _, gpio := range models.GPIOsForBoard(d.BoardType) {
		_, err = tx.Exec(`
			INSERT INTO pin_configs (id, device_id, gpio, label, mode, value, pwm_freq, enabled, updated_at)
			VALUES (?, ?, ?, ?, 'disabled', 0, 1000, 0, ?)`,
			uuid.New().String(), d.ID, gpio, models.PinLabel(d.BoardType, gpio), now)
		if err != nil {
			return nil, err
		}
	}

	if d.HasDisplay {
		lines, _ := json.Marshal([]string{"ESP32-C3", "Ready"})
		_, err = tx.Exec(`
			INSERT INTO display_states (id, device_id, enabled, brightness, text_lines, clear, updated_at)
			VALUES (?, ?, 1, 128, ?, 0, ?)`,
			uuid.New().String(), d.ID, string(lines), now)
		if err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return d, nil
}

func (s *Store) ListDevices() ([]models.Device, error) {
	rows, err := s.db.Query(`
		SELECT id, name, token, board_type, has_display, display_type, online, last_seen, firmware_ver, local_ip, notes, created_at, updated_at
		FROM devices ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var devices []models.Device
	for rows.Next() {
		d, err := scanDevice(rows)
		if err != nil {
			return nil, err
		}
		devices = append(devices, *d)
	}
	if devices == nil {
		devices = []models.Device{}
	}
	return devices, nil
}

func (s *Store) GetDevice(id string) (*models.Device, error) {
	row := s.db.QueryRow(`
		SELECT id, name, token, board_type, has_display, display_type, online, last_seen, firmware_ver, local_ip, notes, created_at, updated_at
		FROM devices WHERE id = ?`, id)
	return scanDevice(row)
}

func (s *Store) GetDeviceByToken(token string) (*models.Device, error) {
	row := s.db.QueryRow(`
		SELECT id, name, token, board_type, has_display, display_type, online, last_seen, firmware_ver, local_ip, notes, created_at, updated_at
		FROM devices WHERE token = ?`, token)
	return scanDevice(row)
}

func (s *Store) UpdateDevice(id string, req models.UpdateDeviceRequest) (*models.Device, error) {
	now := time.Now().UTC()
	_, err := s.db.Exec(`
		UPDATE devices SET name=?, board_type=?, has_display=?, display_type=?, notes=?, updated_at=?
		WHERE id=?`,
		req.Name, req.BoardType, boolToInt(req.HasDisplay), req.DisplayType, req.Notes, now, id)
	if err != nil {
		return nil, err
	}

	if req.HasDisplay {
		var count int
		_ = s.db.QueryRow(`SELECT COUNT(*) FROM display_states WHERE device_id=?`, id).Scan(&count)
		if count == 0 {
			lines, _ := json.Marshal([]string{"ESP32-C3", "Ready"})
			_, _ = s.db.Exec(`
				INSERT INTO display_states (id, device_id, enabled, brightness, text_lines, clear, updated_at)
				VALUES (?, ?, 1, 128, ?, 0, ?)`,
				uuid.New().String(), id, string(lines), now)
		}
	}

	return s.GetDevice(id)
}

func (s *Store) DeleteDevice(id string) error {
	_, err := s.db.Exec(`DELETE FROM devices WHERE id=?`, id)
	return err
}

func (s *Store) SetDeviceOnline(id string, online bool, firmwareVer, localIP string) error {
	now := time.Now().UTC()
	_, err := s.db.Exec(`
		UPDATE devices SET online=?, last_seen=?, firmware_ver=COALESCE(NULLIF(?, ''), firmware_ver),
		local_ip=COALESCE(NULLIF(?, ''), local_ip), updated_at=?
		WHERE id=?`,
		boolToInt(online), now, firmwareVer, localIP, now, id)
	return err
}

func (s *Store) MarkOfflineStale(threshold time.Duration) error {
	cutoff := time.Now().UTC().Add(-threshold)
	_, err := s.db.Exec(`UPDATE devices SET online=0 WHERE online=1 AND (last_seen IS NULL OR last_seen < ?)`, cutoff)
	return err
}

func (s *Store) GetPins(deviceID string) ([]models.PinConfig, error) {
	rows, err := s.db.Query(`
		SELECT id, device_id, gpio, label, mode, value, pwm_freq, enabled, updated_at
		FROM pin_configs WHERE device_id=? ORDER BY gpio`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var pins []models.PinConfig
	for rows.Next() {
		var p models.PinConfig
		var enabled int
		if err := rows.Scan(&p.ID, &p.DeviceID, &p.GPIO, &p.Label, &p.Mode, &p.Value, &p.PWMFreq, &enabled, &p.UpdatedAt); err != nil {
			return nil, err
		}
		p.Enabled = enabled == 1
		pins = append(pins, p)
	}
	if pins == nil {
		pins = []models.PinConfig{}
	}
	return pins, nil
}

func (s *Store) UpdatePin(deviceID string, req models.PinUpdateRequest) (*models.PinConfig, error) {
	now := time.Now().UTC()
	mode := req.Mode
	if !models.ValidModes[mode] {
		mode = "disabled"
	}
	res, err := s.db.Exec(`
		UPDATE pin_configs SET label=?, mode=?, value=?, pwm_freq=?, enabled=?, updated_at=?
		WHERE device_id=? AND gpio=?`,
		req.Label, mode, req.Value, req.PWMFreq, boolToInt(req.Enabled), now, deviceID, req.GPIO)
	if err != nil {
		return nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		_, err = s.db.Exec(`
			INSERT INTO pin_configs (id, device_id, gpio, label, mode, value, pwm_freq, enabled, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			uuid.New().String(), deviceID, req.GPIO, req.Label, mode, req.Value, req.PWMFreq, boolToInt(req.Enabled), now)
		if err != nil {
			return nil, err
		}
	}

	row := s.db.QueryRow(`
		SELECT id, device_id, gpio, label, mode, value, pwm_freq, enabled, updated_at
		FROM pin_configs WHERE device_id=? AND gpio=?`, deviceID, req.GPIO)
	var p models.PinConfig
	var enabled int
	if err := row.Scan(&p.ID, &p.DeviceID, &p.GPIO, &p.Label, &p.Mode, &p.Value, &p.PWMFreq, &enabled, &p.UpdatedAt); err != nil {
		return nil, err
	}
	p.Enabled = enabled == 1
	return &p, nil
}

func (s *Store) UpdatePinValue(deviceID string, gpio, value int) error {
	now := time.Now().UTC()
	_, err := s.db.Exec(`UPDATE pin_configs SET value=?, updated_at=? WHERE device_id=? AND gpio=?`, value, now, deviceID, gpio)
	return err
}

func (s *Store) GetDisplay(deviceID string) (*models.DisplayState, error) {
	row := s.db.QueryRow(`
		SELECT id, device_id, enabled, brightness, text_lines, clear, updated_at
		FROM display_states WHERE device_id=?`, deviceID)
	var d models.DisplayState
	var enabled, clear int
	err := row.Scan(&d.ID, &d.DeviceID, &enabled, &d.Brightness, &d.TextLines, &clear, &d.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.Enabled = enabled == 1
	d.Clear = clear == 1
	return &d, nil
}

func (s *Store) UpdateDisplay(deviceID string, req models.DisplayUpdateRequest) (*models.DisplayState, error) {
	now := time.Now().UTC()
	lines, err := json.Marshal(req.TextLines)
	if err != nil {
		return nil, err
	}
	brightness := req.Brightness
	if brightness < 0 {
		brightness = 0
	}
	if brightness > 255 {
		brightness = 255
	}

	existing, _ := s.GetDisplay(deviceID)
	if existing == nil {
		_, err = s.db.Exec(`
			INSERT INTO display_states (id, device_id, enabled, brightness, text_lines, clear, updated_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			uuid.New().String(), deviceID, boolToInt(req.Enabled), brightness, string(lines), boolToInt(req.Clear), now)
	} else {
		_, err = s.db.Exec(`
			UPDATE display_states SET enabled=?, brightness=?, text_lines=?, clear=?, updated_at=?
			WHERE device_id=?`,
			boolToInt(req.Enabled), brightness, string(lines), boolToInt(req.Clear), now, deviceID)
	}
	if err != nil {
		return nil, err
	}
	return s.GetDisplay(deviceID)
}

func (s *Store) CreateCommand(deviceID, cmdType string, payload any) (*models.Command, error) {
	now := time.Now().UTC()
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	c := &models.Command{
		ID:        uuid.New().String(),
		DeviceID:  deviceID,
		Type:      cmdType,
		Payload:   string(body),
		Status:    "pending",
		CreatedAt: now,
	}
	_, err = s.db.Exec(`
		INSERT INTO commands (id, device_id, type, payload, status, created_at)
		VALUES (?, ?, ?, ?, ?, ?)`,
		c.ID, c.DeviceID, c.Type, c.Payload, c.Status, c.CreatedAt)
	if err != nil {
		return nil, err
	}
	return c, nil
}

func (s *Store) GetPendingCommands(deviceID string) ([]models.Command, error) {
	rows, err := s.db.Query(`
		SELECT id, device_id, type, payload, status, created_at, acked_at
		FROM commands WHERE device_id=? AND status='pending' ORDER BY created_at ASC LIMIT 50`, deviceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cmds []models.Command
	for rows.Next() {
		var c models.Command
		var acked sql.NullTime
		if err := rows.Scan(&c.ID, &c.DeviceID, &c.Type, &c.Payload, &c.Status, &c.CreatedAt, &acked); err != nil {
			return nil, err
		}
		if acked.Valid {
			c.AckedAt = &acked.Time
		}
		cmds = append(cmds, c)
	}
	if cmds == nil {
		cmds = []models.Command{}
	}
	return cmds, nil
}

func (s *Store) MarkCommandStatus(id, status string) error {
	if status == "acked" {
		now := time.Now().UTC()
		_, err := s.db.Exec(`UPDATE commands SET status=?, acked_at=? WHERE id=?`, status, now, id)
		return err
	}
	_, err := s.db.Exec(`UPDATE commands SET status=? WHERE id=?`, status, id)
	return err
}

type scannable interface {
	Scan(dest ...any) error
}

func scanDevice(row scannable) (*models.Device, error) {
	var d models.Device
	var hasDisplay, online int
	var lastSeen sql.NullTime
	err := row.Scan(&d.ID, &d.Name, &d.Token, &d.BoardType, &hasDisplay, &d.DisplayType, &online, &lastSeen, &d.FirmwareVer, &d.LocalIP, &d.Notes, &d.CreatedAt, &d.UpdatedAt)
	if err != nil {
		return nil, err
	}
	d.HasDisplay = hasDisplay == 1
	d.Online = online == 1
	if lastSeen.Valid {
		d.LastSeen = &lastSeen.Time
	}
	return &d, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
