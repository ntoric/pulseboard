import { NavLink, Outlet } from 'react-router-dom'

export default function Layout() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C3</div>
          <div className="brand-text">
            <strong>PulseBoard</strong>
            <span>ESP32-C3 Control</span>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Devices
          </NavLink>
          <NavLink to="/firmware">Firmware</NavLink>
        </nav>
      </aside>
      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}
