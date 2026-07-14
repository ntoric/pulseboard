import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type Device, type CreateDeviceRequest } from '../api'
import { useFrontendSocket } from '../hooks/useFrontendSocket'

function CreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (d: Device) => void
}) {
  const [form, setForm] = useState<CreateDeviceRequest>({
    name: '',
    board_type: 'esp32-c3',
    has_display: false,
    display_type: 'none',
    notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload = {
        ...form,
        display_type: form.has_display
          ? form.display_type === 'none'
            ? 'oled_ssd1306'
            : form.display_type
          : 'none',
      }
      const device = await api.createDevice(payload)
      onCreated(device)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Add ESP32-C3</h2>
        <form className="form-grid" onSubmit={submit}>
          <div className="field">
            <label>Name</label>
            <input
              required
              placeholder="Living room node"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Board type</label>
            <select
              value={form.board_type}
              onChange={(e) => {
                const board_type = e.target.value
                const has_display = board_type !== 'esp32-c3'
                setForm({
                  ...form,
                  board_type,
                  has_display,
                  display_type: board_type === 'esp32-c3-oled'
                    ? 'oled_ssd1306'
                    : board_type === 'esp32-c3-lcd'
                      ? 'lcd_st7735'
                      : 'none',
                })
              }}
            >
              <option value="esp32-c3">ESP32-C3 (GPIO 0–10)</option>
              <option value="esp32-c3-oled">ESP32-C3 OLED (GPIO 0–10 + display)</option>
              <option value="esp32-c3-lcd">ESP32-C3 + LCD (GPIO 0–10)</option>
            </select>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.has_display}
              onChange={(e) =>
                setForm({
                  ...form,
                  has_display: e.target.checked,
                  display_type: e.target.checked ? 'oled_ssd1306' : 'none',
                })
              }
            />
            Has built-in / attached display
          </label>
          {form.has_display && (
            <div className="field">
              <label>Display type</label>
              <select
                value={form.display_type}
                onChange={(e) => setForm({ ...form, display_type: e.target.value })}
              >
                <option value="oled_ssd1306">OLED SSD1306</option>
                <option value="lcd_st7735">LCD ST7735</option>
              </select>
            </div>
          )}
          <div className="field">
            <label>Notes</label>
            <textarea
              placeholder="Optional notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</p>}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create device'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)

  async function load() {
    try {
      const list = await api.listDevices()
      setDevices(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useFrontendSocket((msg) => {
    if (
      msg.type === 'device_online' ||
      msg.type === 'device_offline' ||
      msg.type === 'device_created' ||
      msg.type === 'device_deleted' ||
      msg.type === 'device_updated' ||
      msg.type === 'device_status' ||
      msg.type === 'telemetry'
    ) {
      load()
    }
  })

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Devices</h1>
          <p>Connect and control multiple ESP32-C3 modules independently.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Add device
        </button>
      </div>

      {loading ? (
        <div className="loading">Loading devices…</div>
      ) : devices.length === 0 ? (
        <div className="empty">
          <h3>No devices yet</h3>
          <p>Create a device, flash the firmware preset with its token, then it will appear online.</p>
          <button
            className="btn btn-primary"
            style={{ marginTop: '1rem' }}
            onClick={() => setShowCreate(true)}
          >
            Add your first device
          </button>
        </div>
      ) : (
        <div className="card-grid">
          {devices.map((d) => (
            <Link key={d.id} to={`/devices/${d.id}`} className="card device-card">
              <div className="device-card-top">
                <div>
                  <h3>{d.name}</h3>
                  <div className="device-meta" style={{ marginTop: '0.4rem' }}>
                    <span className={`badge ${d.online ? 'online' : 'offline'}`}>
                      <span className="dot" />
                      {d.online ? 'Online' : 'Offline'}
                    </span>
                    <span className="badge">{d.board_type}</span>
                    {d.has_display && <span className="badge">{d.display_type}</span>}
                  </div>
                </div>
              </div>
              <div className="device-meta">
                {d.local_ip && <span>IP {d.local_ip}</span>}
                {d.firmware_ver && <span>FW {d.firmware_ver}</span>}
                {!d.local_ip && !d.firmware_ver && (
                  <span>Waiting for first connection…</span>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onCreated={(d) => setDevices((prev) => [d, ...prev])}
        />
      )}
    </div>
  )
}
