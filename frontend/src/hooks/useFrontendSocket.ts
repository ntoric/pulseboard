import { useEffect, useRef, useCallback } from 'react'

type Handler = (msg: { type: string; id?: string; payload?: unknown }) => void

export function useFrontendSocket(onMessage: Handler) {
  const handlerRef = useRef(onMessage)
  handlerRef.current = onMessage

  const connect = useCallback(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws/frontend`)

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data)
        handlerRef.current(msg)
      } catch {
        /* ignore */
      }
    }

    ws.onclose = () => {
      setTimeout(connect, 3000)
    }

    return ws
  }, [])

  useEffect(() => {
    const ws = connect()
    return () => ws.close()
  }, [connect])
}
