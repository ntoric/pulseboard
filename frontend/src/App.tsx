import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import DevicesPage from './pages/DevicesPage'
import DeviceDetailPage from './pages/DeviceDetailPage'
import DeviceDataPage from './pages/DeviceDataPage'
import DeviceIOPage from './pages/DeviceIOPage'
import FirmwarePage from './pages/FirmwarePage'
import './index.css'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<DevicesPage />} />
          <Route path="devices/:id" element={<DeviceDetailPage />} />
          <Route path="devices/:id/io" element={<DeviceIOPage />} />
          <Route path="devices/:id/data" element={<DeviceDataPage />} />
          <Route path="firmware" element={<FirmwarePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
