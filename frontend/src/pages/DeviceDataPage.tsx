import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Device, type DeviceEvent } from '../api'
import { useFrontendSocket } from '../hooks/useFrontendSocket'

function formatPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

function summarize(ev: DeviceEvent): string {
  try {
    const p = JSON.parse(ev.payload)
    if (ev.type === 'data' || ev.type === 'serial_out') {
      return p.message ?? p.payload?.message ?? JSON.stringify(p)
    }
    if (ev.type === 'telemetry') {
      const pins = p.pins as { gpio: number; value: number }[] | undefined
      if (!pins?.length) return 'telemetry (no inputs)'
      return pins.map((x) => `GPIO${x.gpio}=${x.value}`).join(' · ')
    }
    if (ev.type === 'hello') {
      return `hello ${p.local_ip || ''} ${p.firmware_ver || ''}`.trim()
    }
    return JSON.stringify(p)
  } catch {
    return ev.payload
  }
}

export default function DeviceDataPage() {
  const { id } = useParams()
  const [device, setDevice] = useState<Device | null>(null)
  const [events, setEvents] = useState<DeviceEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')

  const load = useCallback(async () => {
    if (!id) return
    try {
      const [detail, evs] = await Promise.all([api.getDevice(id), api.listEvents(id)])
      setDevice(detail.device)
      setEvents(evs)
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
    if (!id) return
    if (
      (msg.type === 'telemetry' ||
        msg.type === 'device_data' ||
        msg.type === 'device_status' ||
        msg.type === 'device_online') &&
      msg.id === id
    ) {
      load()
    }
  })

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

  const filtered =
    filter === 'all' ? events : events.filter((e) => e.type === filter || (filter === 'data' && e.type === 'serial_out'))

  return (
    <div className="detail-layout">
      <div className="page-header" style={{ marginBottom: 0 }}>
        <div>
          <Link to={`/devices/${device.id}`} style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
            ← {device.name}
          </Link>
          <h1 style={{ marginTop: '0.4rem' }}>Module data</h1>
          <p>Live stream of telemetry, serial lines, and messages from the board.</p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={load}>
            Refresh
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-title">
          <h2>Event log</h2>
          <div className="actions">
            <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ minWidth: 140 }}>
              <option value="all">All</option>
              <option value="data">Data / serial</option>
              <option value="telemetry">Telemetry</option>
              <option value="hello">Hello</option>
              <option value="serial_out">App → serial</option>
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: '2rem' }}>
            <h3>No events yet</h3>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Enable input pins for telemetry, type into the Serial Monitor, or send a serial message
              from the device page.
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
                  <span className="event-time">
                    {new Date(ev.created_at).toLocaleString()}
                  </span>
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
