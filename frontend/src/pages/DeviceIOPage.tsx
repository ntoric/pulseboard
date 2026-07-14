import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  api,
  type DeviceDetail,
  type PinConfig,
  type PinUpdateRequest,
  type BusConfig,
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

const ALL_GPIOS = Array.from({ length: 22 }, (_, i) => i)

function modeHint(mode: string): string {
  switch (mode) {
    case 'output':
      return 'Drive HIGH / LOW'
    case 'pwm':
      return 'Duty 0–255'
    case 'adc':
      return 'Analog read'
    case 'input':
    case 'input_pullup':
      return 'Digital read'
    default:
      return 'Not used'
  }
}

export default function DeviceIOPage() {
  const { id } = useParams()
  const [data, setData] = useState<DeviceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyGpio, setBusyGpio] = useState<number | null>(null)
  const [toast, setToast] = useState('')
  const [addGpio, setAddGpio] = useState<number | ''>('')
  const [adding, setAdding] = useState(false)
  const [busDraft, setBusDraft] = useState<BusConfig | null>(null)
  const [busSaving, setBusSaving] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    try {
      const detail = await api.getDevice(id)
      setData(detail)
      if (detail.bus) setBusDraft(detail.bus)
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
    if (msg.type === 'telemetry' && msg.id === id) {
      const payload = msg.payload as {
        pins?: { gpio: number; value: number }[]
        firmware_ver?: string
        local_ip?: string
      }
      if (payload?.pins?.length) {
        setData((prev) => {
          if (!prev) return prev
          const map = new Map(payload.pins!.map((p) => [p.gpio, p.value]))
          return {
            ...prev,
            device: {
              ...prev.device,
              online: true,
              firmware_ver: payload.firmware_ver || prev.device.firmware_ver,
              local_ip: payload.local_ip || prev.device.local_ip,
            },
            pins: prev.pins.map((p) =>
              map.has(p.gpio) ? { ...p, value: map.get(p.gpio)! } : p,
            ),
          }
        })
      }
      return
    }
    if (
      (msg.type === 'device_status' ||
        msg.type === 'device_online' ||
        msg.type === 'device_offline' ||
        msg.type === 'pin_updated' ||
        msg.type === 'bus_updated') &&
      msg.id === id
    ) {
      load()
    }
  })

  function flash(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(''), 2400)
  }

  const usedGpios = useMemo(() => new Set(data?.pins.map((p) => p.gpio) ?? []), [data])
  const availableGpios = ALL_GPIOS.filter((g) => !usedGpios.has(g))

  async function savePin(req: PinUpdateRequest) {
    if (!id) return
    setBusyGpio(req.gpio)
    try {
      const res = await api.updatePin(id, req)
      setData((prev) =>
        prev
          ? { ...prev, pins: prev.pins.map((p) => (p.gpio === res.pin.gpio ? res.pin : p)) }
          : prev,
      )
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Pin update failed')
      await load()
    } finally {
      setBusyGpio(null)
    }
  }

  async function commitPin(pin: PinConfig, patch: Partial<PinConfig>) {
    const next = { ...pin, ...patch }
    await savePin({
      gpio: next.gpio,
      label: next.label,
      mode: next.mode,
      value: next.value,
      pwm_freq: next.pwm_freq,
      enabled: next.enabled,
    })
  }

  async function addPin() {
    if (!id || addGpio === '') return
    setAdding(true)
    try {
      await api.addPin(id, { gpio: addGpio })
      setAddGpio('')
      flash(`GPIO ${addGpio} added to IO program`)
      await load()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Add failed')
    } finally {
      setAdding(false)
    }
  }

  async function removePin(gpio: number) {
    if (!id) return
    if (!confirm(`Remove GPIO ${gpio} from the IO program?`)) return
    setBusyGpio(gpio)
    try {
      await api.deletePin(id, gpio)
      flash(`GPIO ${gpio} removed`)
      await load()
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setBusyGpio(null)
    }
  }

  async function applyAll() {
    if (!id) return
    try {
      const res = await api.syncDevice(id)
      flash(res.online ? 'Full IO program pushed to module' : 'Queued — module offline')
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Sync failed')
    }
  }

  async function saveBus() {
    if (!id || !busDraft) return
    setBusSaving(true)
    try {
      const res = await api.updateBus(id, {
        sda: busDraft.sda,
        scl: busDraft.scl,
        rx: busDraft.rx,
        tx: busDraft.tx,
        uart_baud: busDraft.uart_baud,
      })
      setBusDraft(res.bus)
      setData((prev) => (prev ? { ...prev, bus: res.bus } : prev))
      flash('Bus pins applied')
    } catch (err) {
      flash(err instanceof Error ? err.message : 'Bus update failed')
    } finally {
      setBusSaving(false)
    }
  }

  if (loading) return <div className="loading">Loading IO programmer…</div>
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

  const { device, pins } = data
  const enabledCount = pins.filter((p) => p.enabled && p.mode !== 'disabled').length

  return (
    <div className="detail-layout">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to={`/devices/${device.id}`} style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            ← {device.name}
          </Link>
          <h1 style={{ marginTop: '0.4rem' }}>IO Programmer</h1>
          <p>
            Configure GPIO modes, values, and bus pins in the app — the module only executes what you
            program here.
          </p>
        </div>
        <div className="actions">
          <span className={`badge ${device.online ? 'online' : 'offline'}`}>
            <span className="dot" />
            {device.online ? 'Online' : 'Offline'}
          </span>
          <button className="btn btn-primary" onClick={applyAll}>
            Apply to module
          </button>
        </div>
      </div>

      <div className="card io-banner">
        <div>
          <strong>{enabledCount}</strong> of {pins.length} pins active in this program
        </div>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          Changes apply live when the module is online. Use Apply to push the full program after
          reconnect.
        </span>
      </div>

      <div className="card">
        <div className="section-title">
          <h2>GPIO program</h2>
          <div className="io-add-row">
            <select
              value={addGpio === '' ? '' : String(addGpio)}
              disabled={adding || availableGpios.length === 0}
              onChange={(e) => setAddGpio(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">Add GPIO…</option>
              {availableGpios.map((g) => (
                <option key={g} value={g}>
                  GPIO {g}
                </option>
              ))}
            </select>
            <button
              className="btn btn-ghost btn-sm"
              disabled={adding || addGpio === ''}
              onClick={addPin}
            >
              Add pin
            </button>
          </div>
        </div>

        <div className="io-table-wrap">
          <table className="io-table">
            <thead>
              <tr>
                <th>On</th>
                <th>GPIO</th>
                <th>Label</th>
                <th>Mode</th>
                <th>Signal</th>
                <th>PWM Hz</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pins.map((pin) => {
                const busy = busyGpio === pin.gpio
                const isOutput = pin.mode === 'output'
                const isPwm = pin.mode === 'pwm'
                const isRead =
                  pin.mode === 'input' || pin.mode === 'input_pullup' || pin.mode === 'adc'
                const isLed = pin.gpio === 8

                return (
                  <tr key={pin.id} className={pin.enabled ? 'active' : ''}>
                    <td>
                      <button
                        className={`toggle ${pin.enabled ? 'on' : ''}`}
                        disabled={busy}
                        aria-label={`Enable GPIO ${pin.gpio}`}
                        onClick={() => commitPin(pin, { enabled: !pin.enabled })}
                      />
                    </td>
                    <td className="mono">
                      {pin.gpio}
                      <div className="io-hint">{modeHint(pin.mode)}</div>
                    </td>
                    <td>
                      <input
                        className="io-input"
                        type="text"
                        defaultValue={pin.label}
                        key={`${pin.id}-${pin.label}`}
                        disabled={busy}
                        onBlur={(e) => {
                          const label = e.target.value
                          if (label !== pin.label) commitPin(pin, { label })
                        }}
                      />
                    </td>
                    <td>
                      <select
                        className="io-input"
                        value={pin.mode}
                        disabled={busy || !pin.enabled}
                        onChange={(e) => commitPin(pin, { mode: e.target.value })}
                      >
                        {MODES.map((m) => (
                          <option key={m.value} value={m.value}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      {isOutput && pin.enabled && (
                        <div className="switch-btn compact">
                          <button
                            className={pin.value === 0 ? 'active' : ''}
                            disabled={busy}
                            onClick={() => commitPin(pin, { value: 0 })}
                          >
                            {isLed ? 'OFF' : 'LOW'}
                          </button>
                          <button
                            className={pin.value === 1 ? 'active' : ''}
                            disabled={busy}
                            onClick={() => commitPin(pin, { value: 1 })}
                          >
                            {isLed ? 'ON' : 'HIGH'}
                          </button>
                        </div>
                      )}
                      {isPwm && pin.enabled && (
                        <div className="io-pwm">
                          <input
                            type="range"
                            min={0}
                            max={255}
                            value={pin.value}
                            disabled={busy}
                            onChange={(e) =>
                              setData((prev) =>
                                prev
                                  ? {
                                      ...prev,
                                      pins: prev.pins.map((p) =>
                                        p.gpio === pin.gpio
                                          ? { ...p, value: Number(e.target.value) }
                                          : p,
                                      ),
                                    }
                                  : prev,
                              )
                            }
                            onMouseUp={(e) =>
                              commitPin(pin, {
                                value: Number((e.target as HTMLInputElement).value),
                              })
                            }
                            onTouchEnd={(e) =>
                              commitPin(pin, {
                                value: Number((e.target as HTMLInputElement).value),
                              })
                            }
                          />
                          <span className="mono">{pin.value}</span>
                        </div>
                      )}
                      {isRead && pin.enabled && (
                        <strong className="mono io-read">
                          {pin.mode === 'adc' ? pin.value : pin.value ? 'HIGH' : 'LOW'}
                        </strong>
                      )}
                      {(!pin.enabled || pin.mode === 'disabled') && (
                        <span className="io-muted">—</span>
                      )}
                    </td>
                    <td>
                      {isPwm && pin.enabled ? (
                        <input
                          className="io-input narrow"
                          type="number"
                          min={1}
                          max={40000}
                          defaultValue={pin.pwm_freq}
                          key={`${pin.id}-freq-${pin.pwm_freq}`}
                          disabled={busy}
                          onBlur={(e) => {
                            const pwm_freq = Number(e.target.value)
                            if (pwm_freq !== pin.pwm_freq) commitPin(pin, { pwm_freq })
                          }}
                        />
                      ) : (
                        <span className="io-muted">—</span>
                      )}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() => removePin(pin.gpio)}
                        title="Remove from program"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {busDraft && (
        <div className="card">
          <div className="section-title">
            <h2>Bus pins (I2C / UART)</h2>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
              Program SDA, SCL, RX, TX without reflashing
            </span>
          </div>
          <div className="form-grid bus-grid">
            {(['sda', 'scl', 'rx', 'tx'] as const).map((key) => (
              <div className="field" key={key}>
                <label>{key.toUpperCase()}</label>
                <select
                  value={busDraft[key]}
                  onChange={(e) =>
                    setBusDraft({ ...busDraft, [key]: Number(e.target.value) })
                  }
                >
                  {ALL_GPIOS.map((g) => (
                    <option key={g} value={g}>
                      GPIO {g}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div className="field">
              <label>UART baud</label>
              <input
                type="number"
                min={1200}
                max={921600}
                value={busDraft.uart_baud}
                onChange={(e) =>
                  setBusDraft({ ...busDraft, uart_baud: Number(e.target.value) })
                }
              />
            </div>
            <div className="actions">
              <button className="btn btn-primary btn-sm" disabled={busSaving} onClick={saveBus}>
                Apply bus config
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
