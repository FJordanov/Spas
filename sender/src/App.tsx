import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const IS_TEST_BUILD = true
const HOLD_MS = 1500
const SEND_DELAY_MS = 4000

type ScreenState = 'idle' | 'holding' | 'sending' | 'locating' | 'submitting' | 'sent' | 'error' | 'insert-error'
type LocationStatus = 'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported'

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
  const [settingsReturnTo, setSettingsReturnTo] = useState<ScreenState>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking')
  const [locationMessage, setLocationMessage] = useState('')
  const holdTimeout = useRef<number | null>(null)
  const sendTimeout = useRef<number | null>(null)

  const clearHold = () => {
    if (holdTimeout.current !== null) {
      window.clearTimeout(holdTimeout.current)
      holdTimeout.current = null
    }
  }

  const clearSendDelay = () => {
    if (sendTimeout.current !== null) {
      window.clearTimeout(sendTimeout.current)
      sendTimeout.current = null
    }
  }

  const cancel = () => {
    clearHold()
    clearSendDelay()
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
            is_test: IS_TEST_BUILD,
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

  useEffect(() => {
    let isActive = true
    let permissionStatus: PermissionStatus | null = null

    if (!('geolocation' in navigator)) {
      setLocationStatus('unsupported')
    } else if (!('permissions' in navigator) || !navigator.permissions) {
      setLocationStatus('prompt')
    } else {
      navigator.permissions.query({ name: 'geolocation' })
        .then((status) => {
          if (!isActive) return
          permissionStatus = status
          setLocationStatus(status.state)
          status.onchange = () => {
            if (isActive) setLocationStatus(status.state)
          }
        })
        .catch(() => {
          if (isActive) setLocationStatus('prompt')
        })
    }

    return () => {
      isActive = false
      if (permissionStatus) permissionStatus.onchange = null
    }
  }, [])

  const requestLocation = () => {
    if (!('geolocation' in navigator)) {
      setLocationStatus('unsupported')
      return
    }

    navigator.geolocation.getCurrentPosition(
      () => setLocationStatus('granted'),
      (error) => {
        if (error.code === 1) setLocationStatus('denied')
      },
      { timeout: 10000 },
    )
  }

  const startSending = () => {
    clearSendDelay()
    setScreenState('sending')
    sendTimeout.current = window.setTimeout(() => {
      sendTimeout.current = null
      sendAlert()
    }, SEND_DELAY_MS)
  }

  useEffect(() => () => {
    clearHold()
    clearSendDelay()
  }, [])

  const startHold = () => {
    if (screenState !== 'idle' || holdTimeout.current !== null) return

    setScreenState('holding')
    holdTimeout.current = window.setTimeout(() => {
      holdTimeout.current = null
      startSending()
    }, HOLD_MS)
  }

  const endHold = () => {
    if (screenState !== 'holding') return
    clearHold()
    setScreenState('idle')
  }

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
        .test-banner { margin: 0 0 12px; color: #626863; font-size: 13px; text-align: center; }
        .header-actions { display: flex; align-items: center; gap: 12px; }
        .settings-button { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 1px solid #c8c5bf; border-radius: 50%; color: #202321; background: #f4f2ee; font-size: 19px; line-height: 1; }
        .settings-button:disabled { opacity: .5; }
        .sos-wrap { position: relative; display: grid; place-items: center; width: 244px; height: 244px; }
        .progress-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; pointer-events: none; }
        .ring-track, .ring-progress { fill: none; stroke-width: 5; }
        .ring-track { stroke: #dedbd5; }
        .ring-progress { stroke: #c7352c; stroke-linecap: round; }
        .ring-progress.ring-active { animation: ring-fill ${HOLD_MS}ms linear forwards; }
        @keyframes ring-fill { from { stroke-dashoffset: 283; } to { stroke-dashoffset: 0; } }
        .sos-button {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          width: 206px;
          height: 206px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          color: white;
          background: #c7352c;
          box-shadow: 0 12px 28px #8b211d38, inset 0 2px 0 #ffffff30;
          touch-action: none;
          user-select: none;
          -webkit-user-select: none;
          transition: transform 120ms ease, background 180ms ease;
        }
        .sos-button:active { transform: scale(.97); }
        .sos-label { display: block; font-size: 48px; line-height: 1; font-weight: 760; letter-spacing: .03em; }
        .sos-test-label { display: block; margin-top: 6px; font-size: 14px; line-height: 1; font-weight: 600; letter-spacing: .05em; color: inherit; }
        .hold-hint { margin: 28px 0 0; color: #626863; font-size: 13px; }
        .sending-card { width: 100%; max-width: 310px; padding: 24px; border: 1px solid #dedbd5; border-radius: 16px; background: #fff; text-align: left; }
        .sending-title { margin: 0 0 20px; font-size: 20px; line-height: 1.3; font-weight: 700; }
        .sending-track { width: 100%; height: 4px; margin-bottom: 22px; overflow: hidden; border-radius: 99px; background: #e6e3de; }
        .sending-fill { height: 100%; border-radius: inherit; background: #c7352c; transform: scaleX(0); transform-origin: left; }
        .sending-fill.bar-active { animation: bar-fill ${SEND_DELAY_MS}ms linear forwards; }
        @keyframes bar-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
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
        .location-row { margin: 24px 0; text-align: left; }
        .location-label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 650; }
        .location-detail { margin: 0; color: #555d57; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
        .location-active { display: flex; align-items: center; gap: 8px; color: #555d57; font-size: 14px; }
        .bottom-nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding-top: 14px; border-top: 1px solid #dedbd5; }
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
        <div className="header-actions">
          <span className="ready-indicator"><span className="ready-dot" />Ready</span>
          {(screenState === 'idle' || screenState === 'sent' || screenState === 'error' || screenState === 'insert-error') && (
            <button
              className="settings-button"
              type="button"
              aria-label="Settings"
              disabled={settingsOpen}
              onClick={() => {
                if (settingsOpen) return
                setSettingsReturnTo(screenState)
                setSettingsOpen(true)
              }}
            >
              <span aria-hidden="true">⚙</span>
            </button>
          )}
        </div>
      </header>

      <section className="action-area" aria-live="polite">
        {settingsOpen ? (
          <div className="status-panel">
            <h1 className="status-label">Settings</h1>
            <p className="status-message">Test mode and backend options will appear here.</p>
            <div className="location-row">
              <span className="location-label">Location</span>
              {locationStatus === 'granted' ? (
                <span className="location-active"><span className="ready-dot" />Active</span>
              ) : locationStatus === 'prompt' ? (
                <button className="cancel-button" type="button" onClick={requestLocation}>Allow location</button>
              ) : (
                <p className="location-detail">
                  {locationStatus === 'checking'
                    ? 'Checking…'
                    : locationStatus === 'denied'
                      ? 'Blocked. Turn on location for this site in iPhone Settings → Safari → Location Services, or Settings → Privacy & Security → Location Services.'
                      : 'Not available on this device.'}
                </p>
              )}
            </div>
            <button
              className="cancel-button"
              type="button"
              onClick={() => {
                setSettingsOpen(false)
                setScreenState(settingsReturnTo)
              }}
            >
              Close
            </button>
          </div>
        ) : screenState === 'idle' || screenState === 'holding' ? (
          <>
            {IS_TEST_BUILD && <p className="test-banner">Beta test build. Alerts are marked as tests.</p>}
            <h1 className="action-title">Emergency SOS</h1>
            <p className="action-copy">{screenState === 'holding' ? 'Keep holding to arm' : 'Press and hold to call for help'}</p>
            <div className="sos-wrap">
              <svg className="progress-ring" viewBox="0 0 100 100" aria-hidden="true">
                <circle className="ring-track" cx="50" cy="50" r="45" />
                <circle
                  cx="50"
                  cy="50"
                  r="45"
                  strokeDasharray="283"
                  className={`ring-progress${screenState === 'holding' ? ' ring-active' : ''}`}
                  strokeDashoffset="283"
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
                <span className="sos-label">SOS</span>
                {IS_TEST_BUILD && <span className="sos-test-label">(TEST)</span>}
              </button>
            </div>
          </>
        ) : screenState === 'sending' ? (
          <div className="sending-card">
            <h1 className="sending-title">Sending alert…</h1>
            <div className="sending-track" role="progressbar" aria-label="Sending alert" aria-valuemin={0} aria-valuemax={100}>
              <div className={`sending-fill${screenState === 'sending' ? ' bar-active' : ''}`} />
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
            {(screenState === 'sent' || screenState === 'error' || screenState === 'insert-error') && (
              <button className="cancel-button" type="button" onClick={cancel}>New alert</button>
            )}
          </div>
        )}
      </section>

      <nav className="bottom-nav" aria-label="Main navigation">
        <button className="nav-button" type="button">Check-in</button>
        <button className="nav-button" type="button">Messages</button>
        <button className="nav-button" type="button">Profile</button>
      </nav>
    </main>
  )
}