import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const HOLD_MS = 1500
const SEND_DELAY_MS = 5000

type ScreenState = 'idle' | 'holding' | 'sending' | 'locating' | 'submitting' | 'sent' | 'error' | 'insert-error'

function getDeviceId() {
  let deviceId = localStorage.getItem('spas_device_id')
  if (!deviceId) {
    deviceId = crypto.randomUUID()
    localStorage.setItem('spas_device_id', deviceId)
  }
  return deviceId
}

export default function App() {
  const [screenState, setScreenState] = useState<ScreenState>('idle')
  const [holdProgress, setHoldProgress] = useState(0)
  const [sendProgress, setSendProgress] = useState(0)
  const [locationMessage, setLocationMessage] = useState('')
  const holdStartedAt = useRef<number | null>(null)
  const holdInterval = useRef<number | null>(null)
  const sendStartedAt = useRef<number | null>(null)
  const sendInterval = useRef<number | null>(null)

  const clearHold = () => {
    if (holdInterval.current !== null) {
      window.clearInterval(holdInterval.current)
      holdInterval.current = null
    }
    holdStartedAt.current = null
  }

  const clearSendDelay = () => {
    if (sendInterval.current !== null) {
      window.clearInterval(sendInterval.current)
      sendInterval.current = null
    }
    sendStartedAt.current = null
  }

  const cancel = () => {
    clearHold()
    clearSendDelay()
    setHoldProgress(0)
    setSendProgress(0)
    setLocationMessage('')
    setScreenState('idle')
  }

  const sendAlert = useCallback(() => {
    setScreenState('locating')
    setLocationMessage('')

    if (!('geolocation' in navigator)) {
      setLocationMessage('Location is not available on this device.')
      setScreenState('error')
      return
    }

    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        setLocationMessage(
          `Lat ${coords.latitude.toFixed(5)} · Lon ${coords.longitude.toFixed(5)} · Accuracy ±${Math.round(coords.accuracy)} m`,
        )
        setScreenState('submitting')

        try {
          const { error } = await supabase.from('alerts').insert({
            type: 'sos',
            priority: 1,
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy_m: coords.accuracy,
            device_id: getDeviceId(),
            status: 'new',
            is_test: false,
          })

          if (error) {
            setLocationMessage(error.message)
            setScreenState('insert-error')
            return
          }

          setScreenState('sent')
        } catch (error) {
          setLocationMessage(error instanceof Error ? error.message : String(error))
          setScreenState('insert-error')
        }
      },
      (error) => {
        setLocationMessage(error.message || 'Unable to get your location.')
        setScreenState('error')
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    )
  }, [])

  const startSending = () => {
    clearSendDelay()
    sendStartedAt.current = performance.now()
    setSendProgress(0)
    setScreenState('sending')
    sendInterval.current = window.setInterval(() => {
      const startedAt = sendStartedAt.current
      if (startedAt === null) return

      const progress = Math.min((performance.now() - startedAt) / SEND_DELAY_MS, 1)
      setSendProgress(progress)
      if (progress === 1) {
        clearSendDelay()
        sendAlert()
      }
    }, 16)
  }

  useEffect(() => () => {
    clearHold()
    clearSendDelay()
  }, [])

  const startHold = () => {
    if (screenState !== 'idle' || holdStartedAt.current !== null) return

    holdStartedAt.current = performance.now()
    setScreenState('holding')
    holdInterval.current = window.setInterval(() => {
      const startedAt = holdStartedAt.current
      if (startedAt === null) return

      const progress = Math.min((performance.now() - startedAt) / HOLD_MS, 1)
      setHoldProgress(progress)
      if (progress === 1) {
        clearHold()
        startSending()
      }
    }, 16)
  }

  const endHold = () => {
    if (screenState !== 'holding') return
    clearHold()
    setHoldProgress(0)
    setScreenState('idle')
  }

  const ringOffset = 283 * (1 - holdProgress)

  return (
    <main className="sos-screen">
      <style>{`
        * { box-sizing: border-box; }
        html, body, #root { min-width: 320px; min-height: 100%; margin: 0; }
        body { background: #f4f2ee; color: #202321; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        button { font: inherit; }
        .sos-screen {
          min-height: 100vh;
          min-height: 100dvh;
          display: flex;
          flex-direction: column;
          width: 100%;
          max-width: 480px;
          margin: 0 auto;
          padding: max(24px, env(safe-area-inset-top)) 24px max(16px, env(safe-area-inset-bottom));
          background: #f4f2ee;
        }
        .topline { display: flex; align-items: center; justify-content: space-between; min-height: 42px; }
        .brand { font-size: 14px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
        .ready-indicator { display: flex; align-items: center; gap: 8px; color: #626863; font-size: 12px; }
        .ready-dot { width: 8px; height: 8px; border-radius: 50%; background: #4c9b6a; box-shadow: 0 0 0 3px #dce9df; }
        .action-area { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; padding: 24px 0; text-align: center; }
        .action-title { margin: 0 0 10px; font-size: 27px; line-height: 1.15; font-weight: 720; letter-spacing: 0; }
        .action-copy { min-height: 22px; margin: 0 0 34px; color: #666d68; font-size: 14px; }
        .sos-wrap { position: relative; display: grid; place-items: center; width: 244px; height: 244px; }
        .progress-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; pointer-events: none; }
        .ring-track, .ring-progress { fill: none; stroke-width: 5; }
        .ring-track { stroke: #dedbd5; }
        .ring-progress { stroke: #c7352c; stroke-linecap: round; transition: stroke-dashoffset 40ms linear; }
        .sos-button {
          display: grid;
          place-items: center;
          width: 206px;
          height: 206px;
          border: 0;
          border-radius: 50%;
          color: white;
          background: #c7352c;
          box-shadow: 0 12px 28px #8b211d38, inset 0 2px 0 #ffffff30;
          font-size: 48px;
          line-height: 1;
          font-weight: 760;
          letter-spacing: .03em;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          transition: transform 120ms ease, background 180ms ease;
        }
        .sos-button:active { transform: scale(.97); }
        .hold-hint { margin: 28px 0 0; color: #626863; font-size: 13px; }
        .sending-card { width: 100%; max-width: 310px; padding: 24px; border: 1px solid #dedbd5; border-radius: 16px; background: #fff; text-align: left; }
        .sending-title { margin: 0 0 20px; font-size: 20px; line-height: 1.3; font-weight: 700; }
        .sending-track { width: 100%; height: 4px; margin-bottom: 22px; overflow: hidden; border-radius: 99px; background: #e6e3de; }
        .sending-fill { height: 100%; border-radius: inherit; background: #c7352c; transition: width 16ms linear; }
        .cancel-button {
          width: 100%;
          min-height: 52px;
          padding: 12px 20px;
          border: 1px solid #c8c5bf;
          border-radius: 12px;
          color: #202321;
          background: #f4f2ee;
          font-size: 16px;
          font-weight: 650;
        }
        .status-panel { width: 100%; max-width: 310px; margin-top: 26px; }
        .status-label { margin: 0 0 8px; font-size: 18px; font-weight: 700; }
        .status-message { margin: 0; color: #555d57; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
        .status-message-error { color: #c7352c; }
        .bottom-nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 4px; padding-top: 14px; border-top: 1px solid #dedbd5; }
        .nav-button { min-width: 0; min-height: 48px; padding: 8px 2px; border: 0; border-radius: 10px; color: #626863; background: transparent; font-size: 11px; font-weight: 600; white-space: nowrap; }
        .nav-button:first-child { color: #202321; background: #e8e5df; }
        @media (max-height: 680px) {
          .sos-screen { padding-top: 12px; }
          .action-area { padding: 12px 0; }
          .action-copy { margin-bottom: 16px; }
          .sos-wrap { width: 208px; height: 208px; }
          .sos-button { width: 176px; height: 176px; }
          .hold-hint { margin-top: 18px; }
        }
      `}</style>

      <header className="topline">
        <span className="brand">Spas Sender</span>
        <span className="ready-indicator"><span className="ready-dot" />Ready</span>
      </header>

      <section className="action-area" aria-live="polite">
        {screenState === 'idle' || screenState === 'holding' ? (
          <>
            <h1 className="action-title">Emergency SOS</h1>
            <p className="action-copy">{screenState === 'holding' ? 'Keep holding to arm' : 'Press and hold to call for help'}</p>
            <div className="sos-wrap">
              <svg className="progress-ring" viewBox="0 0 100 100" aria-hidden="true">
                <circle className="ring-track" cx="50" cy="50" r="45" />
                <circle
                  className="ring-progress"
                  cx="50"
                  cy="50"
                  r="45"
                  strokeDasharray="283"
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <button
                className="sos-button"
                type="button"
                aria-label="Press and hold for one and a half seconds to arm SOS"
                onPointerDown={startHold}
                onPointerUp={endHold}
                onPointerLeave={endHold}
                onPointerCancel={endHold}
              >
                SOS
              </button>
            </div>
            <p className="hold-hint">Hold for 1.5 seconds to arm</p>
          </>
        ) : screenState === 'sending' ? (
          <div className="sending-card">
            <h1 className="sending-title">Sending alert…</h1>
            <div className="sending-track" role="progressbar" aria-label="Sending alert" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(sendProgress * 100)}>
              <div className="sending-fill" style={{ width: `${sendProgress * 100}%` }} />
            </div>
            <button className="cancel-button" type="button" onClick={cancel}>Cancel</button>
          </div>
        ) : (
          <div className="status-panel">
            <h1 className="status-label">
              {screenState === 'locating'
                ? 'Getting location…'
                : screenState === 'submitting'
                  ? 'Sending…'
                  : screenState === 'sent'
                    ? 'Sent. Alert received by server.'
                    : screenState === 'insert-error'
                      ? 'Alert could not be sent'
                      : 'Location unavailable'}
            </h1>
            {locationMessage && (
              <p className={`status-message${screenState === 'insert-error' ? ' status-message-error' : ''}`} role="status">
                {locationMessage}
              </p>
            )}
          </div>
        )}
      </section>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className="nav-button" type="button">Check-in</button>
        <button className="nav-button" type="button">Messages</button>
        <button className="nav-button" type="button">Profile</button>
        <button className="nav-button" type="button">Settings</button>
      </nav>
    </main>
  )
}