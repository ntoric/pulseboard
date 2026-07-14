import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Device, type DeviceEvent, type PinConfig } from '../api'
import { useFrontendSocket } from '../hooks/useFrontendSocket'

type TelemetryPin = {
  gpio: number
  value: number
  mode?: string
}

type LiveTelemetry = {
  firmware_ver?: string
  local_ip?: string
  uptime_ms?: number
  pins: TelemetryPin[]
  received_at: string
}

function formatPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function formatPinValue(mode: string | undefined, value: number): string {
  if (mode === 'adc' || mode === 'pwm') return String(value)
  return value ? 'HIGH' : 'LOW'
}

function parseTelemetryPayload(raw: unknown): LiveTelemetry | null {
  try {
    const p =
      typeof raw === 'string'
        ? JSON.parse(raw)
        : raw && typeof raw === 'object'
          ? (raw as Record<string, unknown>)
          : null
    if (!p) return null
    const pinsRaw: unknown[] = Array.isArray(p.pins) ? p.pins : []
    const pins: TelemetryPin[] = pinsRaw
      .map((item): TelemetryPin => {
        const x = item as { gpio?: number; value?: number; mode?: string }
        return {
          gpio: Number(x.gpio),
          value: Number(x.value),
          mode: x.mode,
        }
      })
      .filter((x: TelemetryPin) => !Number.isNaN(x.gpio))
      .sort((a: TelemetryPin, b: TelemetryPin) => a.gpio - b.gpio)
    return {
      firmware_ver: typeof p.firmware_ver === 'string' ? p.firmware_ver : undefined,
      local_ip: typeof p.local_ip === 'string' ? p.local_ip : undefined,
      uptime_ms: typeof p.uptime_ms === 'number' ? p.uptime_ms : undefined,
      pins,
      received_at: new Date().toISOString(),
    }
  } catch {
    return null
  }
}

function summarize(ev: DeviceEvent): string {
  try {
    const p = JSON.parse(ev.payload)
    if (ev.type === 'data' || ev.type === 'serial_out') {
      return p.message ?? p.payload?.message ?? JSON.stringify(p)
    }
    if (ev.type === 'telemetry') {
      const pins = (p.pins || []) as TelemetryPin[]
      if (!pins.length) {
        return `heartbeat · ${p.local_ip || 'online'} · FW ${p.firmware_ver || '?'}`
      }
      return pins
        .map((x) => {
          const mode = x.mode ? `/${x.mode}` : ''
          return `GPIO${x.gpio}${mode}=${formatPinValue(x.mode, x.value)}`
        })
        .join(' · ')
    }
    if (ev.type === 'hello') {
      return `hello ${p.local_ip || ''} ${p.firmware_ver || ''}`.trim()
    }
    return JSON.stringify(p)
  } catch {
    return ev.payload
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

function formatUptime(ms?: number): string {
  if (ms == null || ms < 0) return '—'
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m ${sec}s`
  if (m > 0) return `${m}m ${sec}s`
  return `${sec}s`
}

export default function DeviceDataPage() {
  const { id } = useParams()
  const [device, setDevice] = useState<Device | null>(null)
  const [pins, setPins] = useState<PinConfig[]>([])
  const [events, setEvents] = useState<DeviceEvent[]>([])
  const [live, setLive] = useState<LiveTelemetry | null>(null)
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [detail, evs] = await Promise.all([api.getDevice(id), api.listEvents(id)])
      setDevice(detail.device)
      setPins(detail.pins || [])
      setEvents(evs)

      const latestTelemetry = evs.find((e) => e.type === 'telemetry')
      if (latestTelemetry) {
        const parsed = parseTelemetryPayload(latestTelemetry.payload)
        if (parsed) {
          parsed.received_at = latestTelemetry.created_at
          setLive(parsed)
        }
      } else {
        // Fallback: show enabled pins from DB config
        const enabled = (detail.pins || []).filter((p) => p.enabled && p.mode !== 'disabled')
        if (enabled.length) {
          setLive({
            firmware_ver: detail.device.firmware_ver,
            local_ip: detail.device.local_ip,
            pins: enabled.map((p) => ({ gpio: p.gpio, value: p.value, mode: p.mode })),
            received_at: new Date().toISOString(),
          })
        }
      }
    } catch {
      setDevice(null)
      setEvents([])
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    load()
  }, [load])

  useFrontendSocket((msg) => {
    if (!id || msg.id !== id) return

    if (msg.type === 'telemetry' || msg.type === 'device_status') {
      const parsed = parseTelemetryPayload(msg.payload)
      if (parsed) {
        setLive(parsed)
        setPins((prev) =>
          prev.map((p) => {
            const hit = parsed.pins.find((t) => t.gpio === p.gpio)
            return hit ? { ...p, value: hit.value } : p
          }),
        )
      }
      // Refresh history in background (don't wipe live view)
      api.listEvents(id).then(setEvents).catch(() => {})
      return
    }

    if (msg.type === 'device_data' || msg.type === 'device_online' || msg.type === 'device_offline') {
      api.listEvents(id).then(setEvents).catch(() => {})
      if (msg.type === 'device_online' || msg.type === 'device_offline') {
        api.getDevice(id).then((d) => {
          setDevice(d.device)
          setPins(d.pins || [])
        }).catch(() => {})
      }
    }
  })

  const filtered = useMemo(() => {
    if (filter === 'all') return events
    if (filter === 'data') return events.filter((e) => e.type === 'data' || e.type === 'serial_out')
    return events.filter((e) => e.type === filter)
  }, [events, filter])

  const displayPins = useMemo(() => {
    if (live?.pins?.length) return live.pins
    return pins
      .filter((p) => p.enabled && p.mode !== 'disabled')
      .map((p) => ({ gpio: p.gpio, value: p.value, mode: p.mode }))
  }, [live, pins])

  if (loading) return <div className="loading">Loading data…</div>
  if (!device) {
    return (
      <div className="empty">
        <h3>Device not found</h3>
        <Link to="/" className="btn btn-ghost" style={{ marginTop: '1rem', display: 'inline-flex' }}>
          Back to devices
        </Link>
      </div>
    )
  }

  return (
    <div className="detail-layout">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to={`/devices/${device.id}`} style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            ← {device.name}
          </Link>
          <h1 style={{ marginTop: '0.4rem' }}>Module data</h1>
          <p>Live telemetry from the board, plus message history.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">
          <h2>Live telemetry</h2>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            {live ? `Updated ${formatTime(live.received_at)}` : 'Waiting for samples…'}
          </span>
        </div>

        <div className="info-row" style={{ marginBottom: '1rem' }}>
          <span className={`badge ${device.online ? 'online' : 'offline'}`}>
            <span className="dot" />
            {device.online ? 'Online' : 'Offline'}
          </span>
          {(live?.local_ip || device.local_ip) && (
            <span className="badge">IP {live?.local_ip || device.local_ip}</span>
          )}
          {(live?.firmware_ver || device.firmware_ver) && (
            <span className="badge">FW {live?.firmware_ver || device.firmware_ver}</span>
          )}
          <span className="badge">Uptime {formatUptime(live?.uptime_ms)}</span>
        </div>

        {displayPins.length === 0 ? (
          <div className="empty" style={{ padding: '1.5rem' }}>
            <h3>No pin samples yet</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Enable pins on the device page (any mode). Telemetry reports all enabled pins every ~2s.
            </p>
          </div>
        ) : (
          <div className="telemetry-grid">
            {displayPins.map((p) => (
              <div key={p.gpio} className="telemetry-card">
                <div className="telemetry-gpio">GPIO {p.gpio}</div>
                <div className="telemetry-value">{formatPinValue(p.mode, p.value)}</div>
                <div className="telemetry-mode">{p.mode || '—'}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-title">
          <h2>Event log</h2>
          <div className="actions">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ minWidth: 140 }}>
              <option value="all">All</option>
              <option value="telemetry">Telemetry</option>
              <option value="data">Data / serial</option>
              <option value="hello">Hello</option>
              <option value="serial_out">App → serial</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: '2rem' }}>
            <h3>No events yet</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              After redeploying the backend, telemetry heartbeats and pin samples appear here automatically.
            </p>
          </div>
        ) : (
          <div className="event-list">
            {filtered.map((ev) => (
              <div key={ev.id} className="event-row">
                <button
                  className="event-main"
                  onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                >
                  <span className={`event-type type-${ev.type}`}>{ev.type}</span>
                  <span className="event-summary">{summarize(ev)}</span>
                  <span className="event-time">{formatTime(ev.created_at)}</span>
                </button>
                {expanded === ev.id && (
                  <pre className="event-payload">{formatPayload(ev.payload)}</pre>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
