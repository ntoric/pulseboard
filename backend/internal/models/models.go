package models

import (
	"fmt"
	"time"
)

type Device struct {
	ID           string     `json:"id"`
	Name         string     `json:"name"`
	Token        string     `json:"token"`
	BoardType    string     `json:"board_type"` // esp32-c3, esp32-c3-oled, esp32-c3-lcd
	HasDisplay   bool       `json:"has_display"`
	DisplayType  string     `json:"display_type"` // none, oled_ssd1306, lcd_st7735
	Online       bool       `json:"online"`
	LastSeen     *time.Time `json:"last_seen,omitempty"`
	FirmwareVer  string     `json:"firmware_ver"`
	LocalIP      string     `json:"local_ip"`
	Notes        string     `json:"notes"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

type PinConfig struct {
	ID        string    `json:"id"`
	DeviceID  string    `json:"device_id"`
	GPIO      int       `json:"gpio"`
	Label     string    `json:"label"`
	Mode      string    `json:"mode"`  // disabled, input, input_pullup, output, pwm, adc
	Value     int       `json:"value"` // digital 0/1, pwm 0-255, adc reading
	PWMFreq   int       `json:"pwm_freq"`
	Enabled   bool      `json:"enabled"`
	UpdatedAt time.Time `json:"updated_at"`
}

type DisplayState struct {
	ID         string    `json:"id"`
	DeviceID   string    `json:"device_id"`
	Enabled    bool      `json:"enabled"`
	Brightness int       `json:"brightness"` // 0-255
	TextLines  string    `json:"text_lines"` // JSON array of strings
	Clear      bool      `json:"clear"`
	UpdatedAt  time.Time `json:"updated_at"`
}

type Command struct {
	ID        string     `json:"id"`
	DeviceID  string     `json:"device_id"`
	Type      string     `json:"type"` // pin_set, pin_mode, display_set, ping, sync
	Payload   string     `json:"payload"`
	Status    string     `json:"status"` // pending, sent, acked, failed
	CreatedAt time.Time  `json:"created_at"`
	AckedAt   *time.Time `json:"acked_at,omitempty"`
}

type CreateDeviceRequest struct {
	Name        string `json:"name"`
	BoardType   string `json:"board_type"`
	HasDisplay  bool   `json:"has_display"`
	DisplayType string `json:"display_type"`
	Notes       string `json:"notes"`
}

type UpdateDeviceRequest struct {
	Name        string `json:"name"`
	BoardType   string `json:"board_type"`
	HasDisplay  bool   `json:"has_display"`
	DisplayType string `json:"display_type"`
	Notes       string `json:"notes"`
}

type PinUpdateRequest struct {
	GPIO    int    `json:"gpio"`
	Label   string `json:"label"`
	Mode    string `json:"mode"`
	Value   int    `json:"value"`
	PWMFreq int    `json:"pwm_freq"`
	Enabled bool   `json:"enabled"`
}

type DisplayUpdateRequest struct {
	Enabled    bool     `json:"enabled"`
	Brightness int      `json:"brightness"`
	TextLines  []string `json:"text_lines"`
	Clear      bool     `json:"clear"`
}

type DeviceStatusPayload struct {
	FirmwareVer string         `json:"firmware_ver"`
	LocalIP     string         `json:"local_ip"`
	Pins        []PinTelemetry `json:"pins"`
}

type PinTelemetry struct {
	GPIO  int `json:"gpio"`
	Value int `json:"value"`
}

// DefaultGPIOs — common ESP32-C3 breakout (0–10 header)
var DefaultGPIOs = []int{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10}

// GPIOsForBoard returns controllable header pins for a board type.
// ESP32-C3 OLED modules typically expose GPIO 0–10 plus 3V, 5V, RX, TX, GND.
func GPIOsForBoard(boardType string) []int {
	switch boardType {
	case "esp32-c3", "esp32-c3-oled", "esp32-c3-lcd":
		return append([]int(nil), DefaultGPIOs...)
	default:
		return append([]int(nil), DefaultGPIOs...)
	}
}

// PinLabel returns a friendly label for a GPIO on the given board.
func PinLabel(boardType string, gpio int) string {
	if boardType == "esp32-c3-oled" {
		switch gpio {
		case 8:
			return "GPIO8 (OLED SDA*)"
		case 9:
			return "GPIO9 (OLED SCL*)"
		}
	}
	return fmt.Sprintf("GPIO%d", gpio)
}

// BoardPinout describes the physical header for the UI.
type BoardPinout struct {
	BoardType string   `json:"board_type"`
	GPIOs     []int    `json:"gpios"`
	Power     []string `json:"power"`
	Serial    []string `json:"serial"`
	Notes     string   `json:"notes"`
}

func PinoutForBoard(boardType string) BoardPinout {
	base := BoardPinout{
		BoardType: boardType,
		GPIOs:     GPIOsForBoard(boardType),
		Power:     []string{"3V", "5V", "GND"},
		Serial:    []string{"RX", "TX"},
		Notes:     "Controllable header pins are GPIO 0–10. 3V / 5V / GND are power only. RX / TX are UART (programming/serial) — avoid using them as GPIO unless you know the board mapping.",
	}
	if boardType == "esp32-c3-oled" {
		base.Notes = "ESP32-C3 OLED header: GPIO 0–10, 3V, 5V, RX, TX, GND. Built-in OLED usually uses I2C on GPIO8 (SDA) and GPIO9 (SCL) — leave those free if you use the display."
	}
	return base
}

var ValidModes = map[string]bool{
	"disabled":     true,
	"input":        true,
	"input_pullup": true,
	"output":       true,
	"pwm":          true,
	"adc":          true,
}

var BoardTypes = []string{"esp32-c3", "esp32-c3-oled", "esp32-c3-lcd"}
var DisplayTypes = []string{"none", "oled_ssd1306", "lcd_st7735"}
