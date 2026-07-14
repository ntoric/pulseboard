export type Device = {
  id: string
  name: string
  token: string
  board_type: string
  has_display: boolean
  display_type: string
  online: boolean
  last_seen?: string
  firmware_ver: string
  local_ip: string
  notes: string
  created_at: string
  updated_at: string
}

export type PinConfig = {
  id: string
  device_id: string
  gpio: number
  label: string
  mode: string
  value: number
  pwm_freq: number
  enabled: boolean
  updated_at: string
}

export type DisplayState = {
  id: string
  device_id: string
  enabled: boolean
  brightness: number
  text_lines: string
  clear: boolean
  updated_at: string
}

export type DeviceDetail = {
  device: Device
  pins: PinConfig[]
  display: DisplayState | null
  bus?: BusConfig | null
  pinout?: BoardPinout
}

export type BusConfig = {
  id: string
  device_id: string
  sda: number
  scl: number
  rx: number
  tx: number
  uart_baud: number
  updated_at: string
}

export type BusUpdateRequest = {
  sda: number
  scl: number
  rx: number
  tx: number
  uart_baud: number
}

export type DeviceEvent = {
  id: string
  device_id: string
  type: string
  payload: string
  created_at: string
}

export type BoardPinout = {
  board_type: string
  gpios: number[]
  power: string[]
  serial: string[]
  notes: string
}

export type FirmwarePreset = {
  id: string
  name: string
  description: string
  board_type: string
  has_display: boolean
  libraries: string[]
  code: string
}

export type CreateDeviceRequest = {
  name: string
  board_type: string
  has_display: boolean
  display_type: string
  notes: string
}

export type PinUpdateRequest = {
  gpio: number
  label: string
  mode: string
  value: number
  pwm_freq: number
  enabled: boolean
}

export type DisplayUpdateRequest = {
  enabled: boolean
  brightness: number
  text_lines: string[]
  clear: boolean
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.error || res.statusText)
  }
  return res.json()
}

export type PinAddRequest = {
  gpio: number
  label?: string
  mode?: string
}

export const api = {
  listDevices: () => request<Device[]>('/api/devices'),
  createDevice: (body: CreateDeviceRequest) =>
    request<Device>('/api/devices', { method: 'POST', body: JSON.stringify(body) }),
  getDevice: (id: string) => request<DeviceDetail>(`/api/devices/${id}`),
  updateDevice: (id: string, body: Partial<CreateDeviceRequest>) =>
    request<Device>(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteDevice: (id: string) =>
    request<{ ok: string }>(`/api/devices/${id}`, { method: 'DELETE' }),
  updatePin: (id: string, body: PinUpdateRequest) =>
    request<{ pin: PinConfig }>(`/api/devices/${id}/pins`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  addPin: (id: string, body: PinAddRequest) =>
    request<{ pin: PinConfig }>(`/api/devices/${id}/pins`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deletePin: (id: string, gpio: number) =>
    request<{ ok: boolean }>(`/api/devices/${id}/pins/${gpio}`, { method: 'DELETE' }),
  updateDisplay: (id: string, body: DisplayUpdateRequest) =>
    request<{ display: DisplayState; online?: boolean }>(`/api/devices/${id}/display`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getBus: (id: string) => request<BusConfig>(`/api/devices/${id}/bus`),
  updateBus: (id: string, body: BusUpdateRequest) =>
    request<{ bus: BusConfig }>(`/api/devices/${id}/bus`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  sendSerial: (id: string, message: string) =>
    request<{ online: boolean }>(`/api/devices/${id}/serial`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
  listEvents: (id: string) => request<DeviceEvent[]>(`/api/devices/${id}/events`),
  syncDevice: (id: string) =>
    request<{ online: boolean }>(`/api/devices/${id}/sync`, { method: 'POST' }),
  firmwarePresets: () => request<FirmwarePreset[]>('/api/firmware/presets'),
}
