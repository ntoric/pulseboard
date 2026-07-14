import { useEffect, useState } from 'react'
import { api, type FirmwarePreset } from '../api'

export default function FirmwarePage() {
  const [presets, setPresets] = useState<FirmwarePreset[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const [copied, setCopied] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api
      .firmwarePresets()
      .then((list) => {
        setPresets(list)
        if (list[0]) setOpenId(list[0].id)
      })
      .finally(() => setLoading(false))
  }, [])

  async function copyCode(id: string, code: string) {
    await navigator.clipboard.writeText(code)
    setCopied(id)
    setTimeout(() => setCopied(''), 1600)
  }

  if (loading) return <div className="loading">Loading firmware presets…</div>

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Firmware presets</h1>
          <p>
            Flash once with your server URL and device token. Pin modes, signals, and display are
            controlled from the app afterwards.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Setup steps</h2>
        <ol style={{ color: 'var(--text-muted)', fontSize: '0.9rem', paddingLeft: '1.2rem', display: 'grid', gap: '0.45rem' }}>
          <li>Create a device in the app and copy its token.</li>
          <li>Install required Arduino libraries listed on the preset.</li>
          <li>
            Set <code style={{ color: 'var(--blue-bright)' }}>WIFI_SSID</code>,{' '}
            <code style={{ color: 'var(--blue-bright)' }}>WIFI_PASS</code>,{' '}
            <code style={{ color: 'var(--blue-bright)' }}>SERVER_HOST</code>, and{' '}
            <code style={{ color: 'var(--blue-bright)' }}>DEVICE_TOKEN</code>.
          </li>
          <li>
            For local network use <code style={{ color: 'var(--blue-bright)' }}>USE_SSL = false</code> and
            port 8080. For internet, point to your hosted domain with SSL.
          </li>
          <li>Upload to the board — it connects via WebSocket and waits for commands.</li>
        </ol>
      </div>

      <div className="firmware-list">
        {presets.map((p) => {
          const open = openId === p.id
          return (
            <div key={p.id} className="card firmware-card">
              <div className="firmware-card-head">
                <div>
                  <h3>{p.name}</h3>
                  <p>{p.description}</p>
                  <div className="libs">
                    <span className="badge">{p.board_type}</span>
                    {p.has_display && <span className="badge">display</span>}
                    {p.libraries.map((lib) => (
                      <span key={lib} className="badge">
                        {lib}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setOpenId(open ? null : p.id)}
                  >
                    {open ? 'Hide code' : 'Show code'}
                  </button>
                  <button className="btn btn-primary btn-sm" onClick={() => copyCode(p.id, p.code)}>
                    {copied === p.id ? 'Copied' : 'Copy code'}
                  </button>
                </div>
              </div>
              {open && (
                <div className="code-block">
                  <button
                    className="btn btn-ghost btn-sm copy-btn"
                    onClick={() => copyCode(p.id, p.code)}
                  >
                    {copied === p.id ? 'Copied' : 'Copy'}
                  </button>
                  <pre>{p.code}</pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
