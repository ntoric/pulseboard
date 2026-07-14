import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  api,
  type DeviceDetail,
  type PinConfig,
  type DisplayState,
  type PinUpdateRequest,
} from '../api'
import { useFrontendSocket } from '../hooks/useFrontendSocket'

const MODES = [
  { value: 'disabled', label: 'Disabled' },
  { value: 'input', label: 'Input' },
  { value: 'input_pullup', label: 'Input pull-up' },
  { value: 'output', label: 'Output' },
  { value: 'pwm', label: 'PWM' },
  { value: 'adc', label: 'ADC' },
]

function PinCard({
  pin,
  busy,
  onSave,
}: {
  pin: PinConfig
  busy: boolean
  onSave: (req: PinUpdateRequest) => Promise<void>
}) {
  const [draft, setDraft] = useState(pin)
  useEffect(() => setDraft(pin), [pin])

  const isOutput = draft.mode === 'output'
  const isPwm = draft.mode === 'pwm'
  const isReadOnly = draft.mode === 'input' || draft.mode === 'input_pullup' || draft.mode === 'adc'

  async function commit(next: PinConfig) {
    setDraft(next)
    await onSave({
      gpio: next.gpio,
      label: next.label,
      mode: next.mode,
      value: next.value,
      pwm_freq: next.pwm_freq,
      enabled: next.enabled,
    })
  }

  return (
    <div className={`pin-card ${draft.enabled ? 'enabled' : ''}`}>
      <div className="pin-card-head">
        <div>
          <div className="pin-gpio">GPIO {draft.gpio}</div>
          <input
            type="text"
            value={draft.label}
            disabled={busy}
            style={{
              marginTop: '0.35rem',
              width: '100%',
              background: 'transparent',
              border: 'none',
              borderBottom: '1px solid var(--border)',
              padding: '0.2rem 0',
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
            }}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            onBlur={() => {
              if (draft.label !== pin.label) commit(draft)
            }}
          />
        </div>
        <button
          className={`toggle ${draft.enabled ? 'on' : ''}`}
          disabled={busy}
          aria-label="Enable pin"
          onClick={() => commit({ ...draft, enabled: !draft.enabled })}
        />
      </div>

      <div className="pin-controls">
        <div className="row">
          <span>Mode</span>
          <select
            value={draft.mode}
            disabled={busy || !draft.enabled}
            onChange={(e) => commit({ ...draft, mode: e.target.value })}
          >
            {MODES.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {isOutput && draft.enabled && (
          <div className="switch-btn">
            <button
              className={draft.value === 0 ? 'active' : ''}
              disabled={busy}
              onClick={() => commit({ ...draft, value: 0 })}
            >
              LOW
            </button>
            <button
              className={draft.value === 1 ? 'active' : ''}
              disabled={busy}
              onClick={() => commit({ ...draft, value: 1 })}
            >
              HIGH
            </button>
          </div>
        )}

        {isPwm && draft.enabled && (
          <>
            <div className="row">
              <span>Duty</span>
              <input
                className="slider"
                type="range"
                min={0}
                max={255}
                value={draft.value}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
                onMouseUp={() => commit(draft)}
                onTouchEnd={() => commit(draft)}
              />
            </div>
            <div className="row">
              <span>Value</span>
              <input
                type="number"
                min={0}
                max={255}
                value={draft.value}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, value: Number(e.target.value) })}
                onBlur={() => commit(draft)}
              />
            </div>
            <div className="row">
              <span>Freq</span>
              <input
                type="number"
                min={1}
                max={40000}
                value={draft.pwm_freq}
                disabled={busy}
                onChange={(e) => setDraft({ ...draft, pwm_freq: Number(e.target.value) })}
                onBlur={() => commit(draft)}
              />
            </div>
          </>
        )}

        {isReadOnly && draft.enabled && (
          <div className="row">
            <span>Read</span>
            <strong style={{ color: 'var(--text)', fontFamily: 'var(--mono)' }}>
              {draft.mode === 'adc' ? draft.value : draft.value ? 'HIGH' : 'LOW'}
            </strong>
          </div>
        )}
      </div>
    </div>
  )
}

function DisplayPanel({
  deviceId,
  display,
  onUpdated,
}: {
  deviceId: string
  display: DisplayState
  onUpdated: (d: DisplayState) => void
}) {
  const lines = (() => {
    try {
      const parsed = JSON.parse(display.text_lines)
      return Array.isArray(parsed) ? (parsed as string[]) : ['']
    } catch {
      return ['']
    }
  })()

  const [enabled, setEnabled] = useState(display.enabled)
  const [brightness, setBrightness] = useState(display.brightness)
  const [text, setText] = useState(lines.join('\n'))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEnabled(display.enabled)
    setBrightness(display.brightness)
    try {
      const parsed = JSON.parse(display.text_lines)
      setText(Array.isArray(parsed) ? parsed.join('\n') : '')
    } catch {
      setText('')
    }
  }, [display])

  async function save(extra?: { clear?: boolean; enabled?: boolean; brightness?: number }) {
    setSaving(true)
    try {
      const text_lines = (extra?.clear ? [] : text.split('\n')).map((l) => l.slice(0, 40))
      const res = await api.updateDisplay(deviceId, {
        enabled: extra?.enabled ?? enabled,
        brightness: extra?.brightness ?? brightness,
        text_lines,
        clear: !!extra?.clear,
      })
      onUpdated(res.display)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="card">
      <div className="section-title">
        <h2>Display</h2>
        <button
          className={`toggle ${enabled ? 'on' : ''}`}
          disabled={saving}
          onClick={() => {
            const next = !enabled
            setEnabled(next)
            save({ enabled: next })
          }}
        />
      </div>
      <div className="display-panel">
        <div className="form-grid">
          <div className="field">
            <label>Text lines</label>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Line 1\nLine 2'}
              rows={5}
            />
          </div>
          <div className="field">
            <label>Brightness ({brightness})</label>
            <input
              className="slider"
              type="range"
              min={0}
              max={255}
              value={brightness}
              onChange={(e) => setBrightness(Number(e.target.value))}
              onMouseUp={() => save({ brightness })}
              onTouchEnd={() => save({ brightness })}
            />
          </div>
          <div className="actions">
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={() => save()}>
              Push to display
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={saving}
              onClick={() => {
                setText('')
                save({ clear: true })
              }}
            >
              Clear
            </button>
          </div>
        </div>
        <div className={`display-preview ${enabled ? '' : 'off'}`}>
          {enabled ? text || ' ' : '(display off)'}
        </div>
      </div>
    </div>
  )
}

export default function DeviceDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState<DeviceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyPin, setBusyPin] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const detail = await api.getDevice(id)
      setData(detail)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useFrontendSocket((msg) => {
    if (!id) return
    if (
      (msg.type === 'telemetry' ||
        msg.type === 'device_status' ||
        msg.type === 'device_online' ||
        msg.type === 'device_offline' ||
        msg.type === 'pin_updated' ||
        msg.type === 'display_updated') &&
      msg.id === id
    ) {
      load()
    }
  })

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2200)
  }

  async function savePin(req: PinUpdateRequest) {
    if (!id) return
    setBusyPin(req.gpio)
    try {
      const res = await api.updatePin(id, req)
      setData((prev) =>
        prev
          ? {
              ...prev,
              pins: prev.pins.map((p) => (p.gpio === res.pin.gpio ? res.pin : p)),
            }
          : prev,
      )
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Pin update failed')
      await load()
    } finally {
      setBusyPin(null)
    }
  }

  async function sync() {
    if (!id) return
    try {
      const res = await api.syncDevice(id)
      flash(res.online ? 'Sync sent to device' : 'Queued — device offline')
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Sync failed')
    }
  }

  async function remove() {
    if (!id || !data) return
    if (!confirm(`Delete ${data.device.name}?`)) return
    await api.deleteDevice(id)
    navigate('/')
  }

  async function copyToken() {
    if (!data) return
    await navigator.clipboard.writeText(data.device.token)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (loading) return <div className="loading">Loading device…</div>
  if (!data) {
    return (
      <div className="empty">
        <h3>Device not found</h3>
        <Link to="/" className="btn btn-ghost" style={{ marginTop: '1rem', display: 'inline-flex' }}>
          Back to devices
        </Link>
      </div>
    )
  }

  const { device, pins, display, pinout } = data

  return (
    <div className="detail-layout">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to="/" style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            ← Devices
          </Link>
          <h1 style={{ marginTop: '0.4rem' }}>{device.name}</h1>
          <p>Configure pins and display dynamically — no reflash needed.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={sync}>
            Sync now
          </button>
          <button className="btn btn-danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>

      <div className="card">
        <div className="detail-top">
          <div>
            <div className="info-row">
              <span className={`badge ${device.online ? 'online' : 'offline'}`}>
                <span className="dot" />
                {device.online ? 'Online' : 'Offline'}
              </span>
              <span className="badge">{device.board_type}</span>
              {device.has_display && <span className="badge">{device.display_type}</span>}
              {device.local_ip && <span className="badge">IP {device.local_ip}</span>}
              {device.firmware_ver && <span className="badge">FW {device.firmware_ver}</span>}
            </div>
            {device.notes && (
              <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                {device.notes}
              </p>
            )}
            <div className="token-box">
              <span style={{ color: 'var(--text-dim)' }}>TOKEN</span>
              <code>{device.token}</code>
              <button className="btn btn-ghost btn-sm" onClick={copyToken}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {pinout && (
        <div className="card">
          <div className="section-title">
            <h2>Board header</h2>
          </div>
          <div className="pinout-map">
            <div className="pinout-row">
              <span className="pinout-label">GPIO</span>
              <div className="pinout-chips">
                {pinout.gpios.map((g) => (
                  <span key={g} className="pin-chip gpio">
                    {g}
                  </span>
                ))}
              </div>
            </div>
            <div className="pinout-row">
              <span className="pinout-label">Power</span>
              <div className="pinout-chips">
                {pinout.power.map((p) => (
                  <span key={p} className="pin-chip power">
                    {p}
                  </span>
                ))}
              </div>
            </div>
            <div className="pinout-row">
              <span className="pinout-label">Serial</span>
              <div className="pinout-chips">
                {pinout.serial.map((p) => (
                  <span key={p} className="pin-chip serial">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          </div>
          <p style={{ marginTop: '0.85rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            {pinout.notes}
          </p>
        </div>
      )}

      {device.has_display && display && (
        <DisplayPanel
          deviceId={device.id}
          display={display}
          onUpdated={(d) => setData((prev) => (prev ? { ...prev, display: d } : prev))}
        />
      )}

      <div className="card">
        <div className="section-title">
          <h2>Pins (GPIO 0–10)</h2>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Enable a pin, set mode, then control signal live
          </span>
        </div>
        <div className="pin-grid">
          {pins.map((pin) => (
            <PinCard
              key={pin.id}
              pin={pin}
              busy={busyPin === pin.gpio}
              onSave={savePin}
            />
          ))}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
