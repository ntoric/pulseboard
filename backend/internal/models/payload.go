package models

import "encoding/json"

// DisplayCommandPayload builds a device-facing display payload with text_lines as a JSON array.
// clear is always false for sync — clear is a one-shot command only.
func DisplayCommandPayload(d *DisplayState) map[string]any {
	if d == nil {
		return nil
	}
	var lines []string
	if err := json.Unmarshal([]byte(d.TextLines), &lines); err != nil || lines == nil {
		lines = []string{}
	}
	return map[string]any{
		"enabled":    d.Enabled,
		"brightness": d.Brightness,
		"text_lines": lines,
		"clear":      false,
	}
}

// BusCommandPayload builds a device-facing bus pin payload.
func BusCommandPayload(b *BusConfig) map[string]any {
	if b == nil {
		return nil
	}
	return map[string]any{
		"sda":       b.SDA,
		"scl":       b.SCL,
		"rx":        b.RX,
		"tx":        b.TX,
		"uart_baud": b.UARTBaud,
	}
}

// PinCommandPayload strips DB metadata so device sync stays small.
func PinCommandPayload(p PinConfig) map[string]any {
	return map[string]any{
		"gpio":     p.GPIO,
		"mode":     p.Mode,
		"value":    p.Value,
		"pwm_freq": p.PWMFreq,
		"enabled":  p.Enabled,
	}
}

// SyncCommandPayload builds the full sync payload for a device.
func SyncCommandPayload(pins []PinConfig, display *DisplayState, bus *BusConfig) map[string]any {
	pinPayloads := make([]map[string]any, 0, len(pins))
	for _, p := range pins {
		pinPayloads = append(pinPayloads, PinCommandPayload(p))
	}
	payload := map[string]any{"pins": pinPayloads}
	if disp := DisplayCommandPayload(display); disp != nil {
		payload["display"] = disp
	}
	if b := BusCommandPayload(bus); b != nil {
		payload["bus"] = b
	}
	return payload
}
