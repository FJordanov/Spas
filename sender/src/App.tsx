import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'

const IS_TEST_BUILD = import.meta.env.VITE_IS_TEST_BUILD === 'true'
const DEV_FAST = import.meta.env.VITE_DEV_FAST_MODE === 'true' && IS_TEST_BUILD
const HOLD_MS = DEV_FAST ? 300 : 1500
const SEND_DELAY_MS = DEV_FAST ? 500 : 4000

type ScreenState = 'idle' | 'holding' | 'sending' | 'locating' | 'submitting' | 'sent' | 'error' | 'insert-error' | 'rate-limited'
type LocationStatus = 'checking' | 'granted' | 'prompt' | 'denied' | 'unsupported'
type Theme = 'system' | 'dark' | 'light'
type PrefetchedFix = {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}
type AlertHistoryEntry = {
  id: string
  created_at: string
  type: 'sos'
  priority: 1
  latitude: number
  longitude: number
  accuracy_m: number
  is_test: boolean
  status: 'sent' | 'failed' | 'rate-limited'
  error: string | null
}

const APP_VERSION = '0.0.0'

function isAlertHistoryEntry(entry: unknown): entry is AlertHistoryEntry {
  if (typeof entry !== 'object' || entry === null) return false
  const item = entry as Record<string, unknown>
  return typeof item.id === 'string'
    && typeof item.created_at === 'string'
    && item.type === 'sos'
    && item.priority === 1
    && typeof item.latitude === 'number'
    && typeof item.longitude === 'number'
    && typeof item.accuracy_m === 'number'
    && typeof item.is_test === 'boolean'
    && (item.status === 'sent' || item.status === 'failed' || item.status === 'rate-limited')
    && (item.error === null || typeof item.error === 'string')
}

function getRateLimitSeconds(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null

  const value = error as { hint?: unknown; details?: unknown; message?: unknown }
  const isRateLimit = value.hint === 'rate_limit'
    || (typeof value.message === 'string' && value.message.startsWith('Rate limit exceeded'))
  if (!isRateLimit) return null
  if (value.hint !== 'rate_limit' || typeof value.details !== 'string') return 60

  const retryAfter = value.details.match(/retry_after_seconds=(\d+)/)
  return retryAfter ? Number(retryAfter[1]) : 60
}

function readAlertHistory(): AlertHistoryEntry[] {
  try {
    const value = localStorage.getItem('spas_alert_history')
    if (!value) return []
    const entries: unknown = JSON.parse(value)
    return Array.isArray(entries) ? entries.filter(isAlertHistoryEntry) : []
  } catch {
    return []
  }
}

function storeAlertHistory(entry: AlertHistoryEntry): AlertHistoryEntry[] {
  const history = [entry, ...readAlertHistory()].slice(0, 20)
  try {
    localStorage.setItem('spas_alert_history', JSON.stringify(history))
  } catch {
    return history
  }
  return history
}

function getDeviceId() {
  try {
    let deviceId = localStorage.getItem('spas_device_id')
    if (!deviceId) {
      deviceId = crypto.randomUUID()
      localStorage.setItem('spas_device_id', deviceId)
    }
    return deviceId
  } catch {
    return crypto.randomUUID()
  }
}

export default function App() {
  const [screenState, setScreenState] = useState<ScreenState>('idle')
  const [settingsReturnTo, setSettingsReturnTo] = useState<ScreenState>('idle')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [alertInfoOpen, setAlertInfoOpen] = useState(false)
  const [alertInfoReturnTo, setAlertInfoReturnTo] = useState<ScreenState>('idle')
  const [alertHistory, setAlertHistory] = useState<AlertHistoryEntry[]>(readAlertHistory)
  const [showAllAlertHistory, setShowAllAlertHistory] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [reportAlertListOpen, setReportAlertListOpen] = useState(false)
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(() => alertHistory[0]?.id ?? null)
  const [reportText, setReportText] = useState('')
  const [reportEmail, setReportEmail] = useState('')
  const [includeLocation, setIncludeLocation] = useState(false)
  const [reportMessage, setReportMessage] = useState('')
  const [reportErrorDetail, setReportErrorDetail] = useState('')
  const [reportMessageIsError, setReportMessageIsError] = useState(false)
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const storedTheme = localStorage.getItem('spas_theme')
      return storedTheme === 'dark' || storedTheme === 'light' ? storedTheme : 'system'
    } catch {
      return 'system'
    }
  })
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('checking')
  const [locationMessage, setLocationMessage] = useState('')
  const [rateLimitRemaining, setRateLimitRemaining] = useState<number | null>(null)
  const [sendingStage, setSendingStage] = useState('Processing…')
  const [cancelWindowActive, setCancelWindowActive] = useState(false)
  const holdTimeout = useRef<number | null>(null)
  const sendTimeout = useRef<number | null>(null)
  const stageTimeout = useRef<number | null>(null)
  const prefetchedFix = useRef<PrefetchedFix | null>(null)
  const prefetchError = useRef<string | null>(null)
  const prefetchPending = useRef(false)
  const attemptId = useRef(0)
  const sendWindowElapsed = useRef(false)

  const sortedAlertHistory = [...alertHistory].sort(
    (left, right) => Date.parse(right.created_at) - Date.parse(left.created_at),
  )
  const displayedAlertHistory = showAllAlertHistory
    ? sortedAlertHistory
    : sortedAlertHistory.slice(0, 3)

  useEffect(() => {
    if (screenState !== 'rate-limited' || rateLimitRemaining === null) return
    if (rateLimitRemaining === 0) {
      setRateLimitRemaining(null)
      setScreenState('idle')
      return
    }

    const timeout = window.setTimeout(() => {
      setRateLimitRemaining((remaining) => remaining === null ? null : Math.max(0, remaining - 1))
    }, 1000)
    return () => window.clearTimeout(timeout)
  }, [rateLimitRemaining, screenState])

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

  const clearStageDelay = () => {
    if (stageTimeout.current !== null) {
      window.clearTimeout(stageTimeout.current)
      stageTimeout.current = null
    }
  }

  const cancel = () => {
    clearHold()
    clearSendDelay()
    clearStageDelay()
    attemptId.current += 1
    prefetchedFix.current = null
    prefetchError.current = null
    prefetchPending.current = false
    sendWindowElapsed.current = false
    setLocationMessage('')
    setCancelWindowActive(false)
    setScreenState('idle')
  }

  const recordAlert = useCallback((fix: PrefetchedFix, status: AlertHistoryEntry['status'], error: string | null) => {
    const entry: AlertHistoryEntry = {
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      type: 'sos',
      priority: 1,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy_m: fix.accuracy,
      is_test: IS_TEST_BUILD,
      status,
      error,
    }
    setAlertHistory(storeAlertHistory(entry))
  }, [])

  const insertAlert = useCallback(async (fix: PrefetchedFix, currentAttempt: number) => {
    if (attemptId.current !== currentAttempt) return
    setSendingStage('Approving…')
    setLocationMessage('')

    try {
      const { error } = await supabase.from('alerts').insert({
        type: 'sos',
        priority: 1,
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracy_m: fix.accuracy,
        device_id: getDeviceId(),
        status: 'new',
        is_test: IS_TEST_BUILD,
      })

      if (attemptId.current !== currentAttempt) return
      if (error) {
        const retryAfterSeconds = getRateLimitSeconds(error)
        if (retryAfterSeconds !== null) {
          recordAlert(fix, 'rate-limited', null)
          setRateLimitRemaining(retryAfterSeconds)
          setCancelWindowActive(false)
          setScreenState('rate-limited')
          return
        }
        recordAlert(fix, 'failed', error.message)
        setLocationMessage(error.message)
        setScreenState('insert-error')
        return
      }

      recordAlert(fix, 'sent', null)
      setScreenState('sent')
    } catch (error) {
      if (attemptId.current !== currentAttempt) return
      const retryAfterSeconds = getRateLimitSeconds(error)
      if (retryAfterSeconds !== null) {
        recordAlert(fix, 'rate-limited', null)
        setRateLimitRemaining(retryAfterSeconds)
        setCancelWindowActive(false)
        setScreenState('rate-limited')
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      recordAlert(fix, 'failed', message)
      setLocationMessage(message)
      setScreenState('insert-error')
    }
  }, [recordAlert])

  const requestPrefetch = (currentAttempt: number) => {
    prefetchPending.current = true

    if (!('geolocation' in navigator)) {
      prefetchPending.current = false
      const message = 'Location is not available on this device.'
      prefetchError.current = message
      if (sendWindowElapsed.current && attemptId.current === currentAttempt) {
        setLocationMessage(message)
        setScreenState('error')
      }
      return
    }

    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          if (attemptId.current !== currentAttempt) return
          const { coords } = position
          const fix = {
            latitude: coords.latitude,
            longitude: coords.longitude,
            accuracy: coords.accuracy,
            timestamp: position.timestamp,
          }
          prefetchedFix.current = fix
          prefetchError.current = null
          prefetchPending.current = false
          clearStageDelay()
          if (!sendWindowElapsed.current) setSendingStage('Processing…')
          if (sendWindowElapsed.current) void insertAlert(fix, currentAttempt)
        },
        (error) => {
          if (attemptId.current !== currentAttempt) return
          const message = error.message || 'Unable to get your location.'
          prefetchedFix.current = null
          prefetchError.current = message
          prefetchPending.current = false
          if (sendWindowElapsed.current) {
            setLocationMessage(message)
            setScreenState('error')
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      )
    } catch (error) {
      if (attemptId.current !== currentAttempt) return
      const message = error instanceof Error ? error.message : String(error)
      prefetchError.current = message
      prefetchPending.current = false
      if (sendWindowElapsed.current) {
        setLocationMessage(message)
        setScreenState('error')
      }
    }
  }

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

  const startSending = (currentAttempt: number) => {
    clearSendDelay()
    clearStageDelay()
    setScreenState('sending')
    setCancelWindowActive(true)
    setSendingStage('Processing…')
    prefetchedFix.current = null
    prefetchError.current = null
    sendWindowElapsed.current = false
    stageTimeout.current = window.setTimeout(() => {
      stageTimeout.current = null
      if (attemptId.current === currentAttempt && !prefetchedFix.current) {
        setSendingStage('Locating…')
      }
    }, 1000)
    sendTimeout.current = window.setTimeout(() => {
      sendTimeout.current = null
      if (attemptId.current !== currentAttempt) return
      sendWindowElapsed.current = true
      setCancelWindowActive(false)
      clearStageDelay()
      const fix = prefetchedFix.current
      if (fix && Date.now() - fix.timestamp < 30_000) {
        void insertAlert(fix, currentAttempt)
      } else if (prefetchError.current) {
        setLocationMessage(prefetchError.current)
        setScreenState('error')
      } else {
        setSendingStage('Locating…')
        if (fix) {
          prefetchedFix.current = null
          requestPrefetch(currentAttempt)
        } else if (!prefetchPending.current) {
          requestPrefetch(currentAttempt)
        }
      }
    }, SEND_DELAY_MS)
    requestPrefetch(currentAttempt)
  }

  useEffect(() => () => {
    clearHold()
    clearSendDelay()
    clearStageDelay()
    attemptId.current += 1
    prefetchedFix.current = null
    prefetchError.current = null
    prefetchPending.current = false
  }, [])

  useEffect(() => {
    const root = document.documentElement
    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      root.dataset.theme = theme === 'system'
        ? colorScheme.matches ? 'dark' : 'light'
        : theme
    }

    try {
      localStorage.setItem('spas_theme', theme)
    } catch {
      // Theme remains active for this session when storage is unavailable.
    }
    applyTheme()

    if (theme === 'system') {
      colorScheme.addEventListener('change', applyTheme)
      return () => colorScheme.removeEventListener('change', applyTheme)
    }
  }, [theme])

  const startHold = () => {
    if (screenState !== 'idle' || holdTimeout.current !== null) return

    const currentAttempt = ++attemptId.current
    setScreenState('holding')
    holdTimeout.current = window.setTimeout(() => {
      holdTimeout.current = null
      startSending(currentAttempt)
    }, HOLD_MS)
  }

  const endHold = () => {
    if (screenState !== 'holding') return
    clearHold()
    attemptId.current += 1
    setScreenState('idle')
  }

  const sendReport = async () => {
    const description = reportText.trim()
    const email = reportEmail.trim()
    if (description.length < 5 || description.length > 1000 || reportSubmitting) return
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setReportMessage('Please enter a valid email or leave it empty.')
      setReportMessageIsError(true)
      return
    }

    const recentEntries = readAlertHistory().slice(0, 5)
    const selectedAlert = recentEntries.find((entry) => entry.id === selectedAlertId) ?? null
    const location = prefetchedFix.current ?? (recentEntries[0]
      ? {
        latitude: recentEntries[0].latitude,
        longitude: recentEntries[0].longitude,
      }
      : null)
    const report = [
      description,
      '',
      `App version: ${APP_VERSION}`,
      `Theme: ${theme}`,
      `Time: ${new Date().toISOString()}`,
      'Selected alert:',
      ...(selectedAlert
        ? [
          `- ${new Date(selectedAlert.created_at).toLocaleString()} · ${selectedAlert.status}`,
          ...(includeLocation
            ? [`  Coordinates: ${selectedAlert.latitude}, ${selectedAlert.longitude} · ±${selectedAlert.accuracy_m} m`]
            : []),
          ...(selectedAlert.error ? [`  Error: ${selectedAlert.error}`] : []),
        ]
        : ['- None']),
    ].join('\n')

    setReportSubmitting(true)
    setReportMessage('')
    setReportErrorDetail('')
    setReportMessageIsError(false)
    try {
      const { error } = await supabase.from('problem_reports').insert({
        message: description,
        contact_email: email || null,
        app_version: APP_VERSION,
        theme,
        device_id: getDeviceId(),
        include_location: includeLocation,
        latitude: includeLocation ? location?.latitude ?? null : null,
        longitude: includeLocation ? location?.longitude ?? null : null,
        selected_alert: selectedAlert
          ? {
            created_at: selectedAlert.created_at,
            status: selectedAlert.status,
            is_test: selectedAlert.is_test,
            error: selectedAlert.error,
            ...(includeLocation
              ? {
                latitude: selectedAlert.latitude,
                longitude: selectedAlert.longitude,
                accuracy_m: selectedAlert.accuracy_m,
              }
              : {}),
          }
          : null,
      })

      if (error) {
        const retryAfterSeconds = getRateLimitSeconds(error)
        if (retryAfterSeconds !== null) {
          setReportMessage(`Too many reports in a short time. Try again in ${retryAfterSeconds} seconds.`)
          setReportMessageIsError(true)
          return
        }
        throw new Error(error.message)
      }

      setReportText('')
      setReportEmail('')
      setIncludeLocation(false)
      setReportMessage('Report sent. Thank you.')
    } catch (error) {
      const retryAfterSeconds = getRateLimitSeconds(error)
      if (retryAfterSeconds !== null) {
        setReportMessage(`Too many reports in a short time. Try again in ${retryAfterSeconds} seconds.`)
        setReportMessageIsError(true)
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      try {
        await navigator.clipboard.writeText(report)
        setReportMessage('Could not send. Report copied to clipboard. Paste it to the developer.')
        setReportErrorDetail(message)
      } catch (clipboardError) {
        const clipboardMessage = clipboardError instanceof Error ? clipboardError.message : String(clipboardError)
        setReportMessage('Could not send the report. Clipboard copy failed.')
        setReportErrorDetail(`${message}. ${clipboardMessage}`)
      }
      setReportMessageIsError(true)
    } finally {
      setReportSubmitting(false)
    }
  }

  return (
    <main className="sos-screen">
      <style>{`
        * { box-sizing: border-box; }
        :root {
          --page-background: #f4f2ee;
          --card-background: #ffffff;
          --text-primary: #202321;
          --text-muted: #626863;
          --border: #dedbd5;
          --card: var(--card-background);
          --text: var(--text-primary);
          --selected-background: #e8e5df;
        }
        :root[data-theme="dark"] {
          --page-background: #1b1d1c;
          --card-background: #262927;
          --text-primary: #eceae6;
          --text-muted: #a3a9a5;
          --border: #3a3d3b;
          --card: var(--card-background);
          --text: var(--text-primary);
          --selected-background: #3a3d3b;
        }
        html, body, #root { min-width: 320px; min-height: 100%; margin: 0; }
        body { background: var(--page-background); color: var(--text-primary); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
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
          background: var(--page-background);
        }
        .topline { display: flex; align-items: center; justify-content: space-between; min-height: 42px; }
        .brand { font-size: 14px; font-weight: 750; letter-spacing: .08em; text-transform: uppercase; }
        .brand-group { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
        .dev-fast-badge { display: inline-flex; padding: 2px 6px; border: 1px solid var(--border); border-radius: 999px; color: var(--text-primary); background: var(--selected-background); font-size: 9px; font-weight: 750; letter-spacing: .07em; line-height: 1.2; white-space: nowrap; }
        .ready-indicator { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 12px; }
        .ready-dot { width: 8px; height: 8px; border-radius: 50%; background: #4c9b6a; box-shadow: 0 0 0 3px #dce9df; }
        .action-area { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 0; padding: 24px 0; text-align: center; }
        .action-title { margin: 0 0 10px; font-size: 27px; line-height: 1.15; font-weight: 720; letter-spacing: 0; }
        .action-copy { min-height: 22px; margin: 0 0 34px; color: var(--text-muted); font-size: 14px; }
        .test-banner { margin: 0 0 12px; color: var(--text-muted); font-size: 13px; text-align: center; }
        .header-actions { display: flex; align-items: center; gap: 12px; }
        .settings-button { display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 1px solid var(--border); border-radius: 50%; color: var(--text-primary); background: var(--page-background); font-size: 19px; line-height: 1; }
        .settings-button:disabled { opacity: .5; }
        .sos-wrap { position: relative; display: grid; place-items: center; width: 244px; height: 244px; }
        .progress-ring { position: absolute; inset: 0; width: 100%; height: 100%; transform: rotate(-90deg); overflow: visible; pointer-events: none; }
        .ring-track, .ring-progress { fill: none; stroke-width: 5; }
        .ring-track { stroke: var(--border); }
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
        .hold-hint { margin: 28px 0 0; color: var(--text-muted); font-size: 13px; }
        .sending-card { width: 100%; max-width: 310px; padding: 24px; border: 1px solid var(--border); border-radius: 16px; background: var(--card-background); text-align: left; }
        .sending-title { margin: 0 0 20px; font-size: 20px; line-height: 1.3; font-weight: 700; }
        .sending-track { width: 100%; height: 4px; margin-bottom: 22px; overflow: hidden; border-radius: 99px; background: #e6e3de; }
        .sending-fill { height: 100%; border-radius: inherit; background: #c7352c; transform: scaleX(0); transform-origin: left; }
        .sending-fill.bar-active { animation: bar-fill ${SEND_DELAY_MS}ms linear forwards; }
        @keyframes bar-fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }
        .cancel-button {
          width: 100%;
          min-height: 52px;
          padding: 12px 20px;
          border: 1px solid var(--border);
          border-radius: 12px;
          color: var(--text-primary);
          background: var(--page-background);
          font-size: 16px;
          font-weight: 650;
        }
        .status-panel { width: 100%; max-width: 310px; margin-top: 26px; }
        .alert-info-panel { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 360px; max-height: 100%; margin-top: 8px; overflow-y: auto; text-align: left; }
        .alert-history-list { display: grid; gap: 14px; margin: 0; padding: 0; list-style: none; }
        .alert-history-entry { padding-bottom: 12px; border-bottom: 1px solid var(--border); }
        .report-form { display: grid; gap: 12px; }
        .report-selected-alert { padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
        .report-alert-picker { display: grid; gap: 8px; }
        .report-textarea { width: 100%; min-height: 90px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-primary); background: var(--card-background); font: inherit; resize: vertical; }
        .report-email { width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-primary); background: var(--card-background); font: inherit; }
        .report-location-option { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 14px; }
        .report-alert-options { display: grid; gap: 8px; }
        .report-alert-option { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); color: var(--text); text-align: left; }
        .report-alert-option[aria-pressed="true"] { border: 2px solid var(--text); }
        .report-alert-detail { display: block; color: var(--text-muted); font-size: 14px; line-height: 1.5; }
        .report-message-error { color: #c7352c; }
        .status-label { margin: 0 0 8px; font-size: 18px; font-weight: 700; }
        .status-message { margin: 0; color: var(--text-muted); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
        .status-message-error { color: #c7352c; }
        .rate-limit-panel { display: grid; gap: 16px; }
        .call-112-button { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 68px; border-radius: 12px; color: #fff; background: #c7352c; font-size: 22px; font-weight: 750; text-decoration: none; }
        .location-row { margin: 24px 0; text-align: left; }
        .location-label { display: block; margin-bottom: 8px; font-size: 14px; font-weight: 650; }
        .location-detail { margin: 0; color: var(--text-muted); font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
        .location-active { display: flex; align-items: center; gap: 8px; color: var(--text-muted); font-size: 14px; }
        .appearance-options { display: flex; gap: 8px; }
        .theme-button {
          flex: 1;
          min-height: 44px;
          padding: 10px 12px;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: var(--card);
          color: var(--text);
          font-size: 14px;
          font-weight: 600;
        }
        .theme-button[aria-pressed="true"] { border: 2px solid var(--text); }
        .bottom-nav { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px; padding-top: 14px; border-top: 1px solid var(--border); }
        .nav-button { min-width: 0; min-height: 48px; padding: 8px 2px; border: 0; border-radius: 10px; color: var(--text-muted); background: transparent; font-size: 11px; font-weight: 600; white-space: nowrap; }
        .nav-button:first-child { color: var(--text-primary); background: var(--selected-background); }
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
        <div className="brand-group">
          <span className="brand">Spas Sender</span>
          {DEV_FAST && <span className="dev-fast-badge">DEV FAST MODE</span>}
        </div>
        <div className="header-actions">
          <span className="ready-indicator"><span className="ready-dot" />Ready</span>
          {(screenState === 'idle' || screenState === 'sent' || screenState === 'error' || screenState === 'insert-error') && (
            <>
              <button
                className="settings-button"
                type="button"
                aria-label="Alert info"
                title="Alert info"
                disabled={alertInfoOpen || settingsOpen}
                onClick={() => {
                  if (alertInfoOpen || settingsOpen) return
                  setAlertInfoReturnTo(screenState)
                  const history = readAlertHistory()
                  setAlertHistory(history)
                  setSelectedAlertId(history[0]?.id ?? null)
                  setAlertInfoOpen(true)
                }}
              >
                <span aria-hidden="true">ⓘ</span>
              </button>
              <button
                className="settings-button"
                type="button"
                aria-label="Settings"
                disabled={settingsOpen || alertInfoOpen}
                onClick={() => {
                  if (settingsOpen || alertInfoOpen) return
                  setSettingsReturnTo(screenState)
                  setSettingsOpen(true)
                }}
              >
                <span aria-hidden="true">⚙</span>
              </button>
            </>
          )}
        </div>
      </header>

      <section className="action-area" aria-live="polite">
        {settingsOpen ? (
          <div className="status-panel">
            <h1 className="status-label">Settings</h1>
            <p className="status-message">Test mode and backend options will appear here.</p>
            <div className="location-row">
              <span className="location-label">Appearance</span>
              <div className="appearance-options">
                {(['system', 'dark', 'light'] as const).map((option) => (
                  <button
                    key={option}
                    className="theme-button"
                    type="button"
                    aria-pressed={theme === option}
                    onClick={() => setTheme(option)}
                  >
                    {option === 'system' ? 'System' : option === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
            </div>
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
                      ? 'Blocked. Turn on location for this site in your device settings → Safari → Location Services, or Settings → Privacy & Security → Location Services.'
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
        ) : alertInfoOpen ? (
          reportOpen ? (
            <div className="alert-info-panel">
              <h1 className="status-label">Report a problem</h1>
              <p className="status-message">Tell us what went wrong. Your message goes to the developer.</p>
              <div className="report-form">
                <span className="location-label">Which alert is this about?</span>
                {alertHistory.length === 0 ? (
                  <p className="status-message">No alerts from this device yet. You can still describe the problem.</p>
                ) : (
                  <>
                    {(() => {
                      const selectedAlert = alertHistory.find((entry) => entry.id === selectedAlertId)
                      return selectedAlert ? (
                        <div className="report-selected-alert">
                          <p className="status-message">
                            {new Date(selectedAlert.created_at).toLocaleString()} · {selectedAlert.status}
                          </p>
                          {includeLocation && (
                            <p className="status-message">
                              {selectedAlert.latitude.toFixed(5)}, {selectedAlert.longitude.toFixed(5)} · ±{Math.round(selectedAlert.accuracy_m)} m
                            </p>
                          )}
                        </div>
                      ) : null
                    })()}
                    <button
                      className="cancel-button"
                      type="button"
                      onClick={() => setReportAlertListOpen((open) => !open)}
                    >
                      {reportAlertListOpen ? 'Cancel' : 'Change'}
                    </button>
                    {reportAlertListOpen && (
                      <div className="report-alert-picker">
                        {alertHistory.slice(0, 5).map((entry) => (
                          <button
                            key={entry.id}
                            className="report-alert-option"
                            type="button"
                            aria-pressed={selectedAlertId === entry.id}
                            onClick={() => {
                              setSelectedAlertId(entry.id)
                              setReportAlertListOpen(false)
                            }}
                          >
                            <span className="report-alert-detail">
                              {new Date(entry.created_at).toLocaleString()} · {entry.status}
                            </span>
                            {includeLocation && (
                              <span className="report-alert-detail">
                                {entry.latitude.toFixed(5)}, {entry.longitude.toFixed(5)} · ±{Math.round(entry.accuracy_m)} m
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
                <label className="location-label" htmlFor="report-description">What went wrong?</label>
                <textarea
                  id="report-description"
                  className="report-textarea"
                  maxLength={1000}
                  value={reportText}
                  onChange={(event) => {
                    setReportText(event.target.value)
                    setReportMessage('')
                    setReportErrorDetail('')
                    setReportMessageIsError(false)
                  }}
                />
                <p className="status-message">{1000 - reportText.length} characters remaining</p>
                <label className="location-label" htmlFor="report-email">Email (optional, so we can reply)</label>
                <input
                  id="report-email"
                  className="report-email"
                  type="email"
                  value={reportEmail}
                  onChange={(event) => {
                    setReportEmail(event.target.value)
                    setReportMessage('')
                    setReportErrorDetail('')
                    setReportMessageIsError(false)
                  }}
                />
                {reportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail.trim()) && (
                  <p className="status-message report-message-error">Please enter a valid email or leave it empty.</p>
                )}
                <label className="report-location-option">
                  <input
                    type="checkbox"
                    checked={includeLocation}
                    onChange={(event) => setIncludeLocation(event.target.checked)}
                  />
                  Include my location in the report
                </label>
                <button
                  className="cancel-button"
                  type="button"
                  disabled={reportText.trim().length < 5 || reportSubmitting || Boolean(reportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reportEmail.trim()))}
                  onClick={sendReport}
                >
                  {reportSubmitting ? 'Sending report…' : 'Send report'}
                </button>
                {reportMessage && (
                  <p className={`status-message${reportMessageIsError ? ' report-message-error' : ''}`} role="status">
                    {reportMessage}
                  </p>
                )}
                {reportErrorDetail && (
                  <p className="status-message report-message-error" role="status">{reportErrorDetail}</p>
                )}
              </div>
              <button
                className="cancel-button"
                type="button"
                onClick={() => {
                  setAlertInfoOpen(false)
                  setReportOpen(false)
                  setReportAlertListOpen(false)
                  setScreenState(alertInfoReturnTo)
                }}
              >
                Back
              </button>
            </div>
          ) : (
            <div className="alert-info-panel">
              <h1 className="status-label">Alert info</h1>
              {alertHistory.length === 0 ? (
                <p className="status-message">No alerts sent from this device yet.</p>
              ) : (
                <ul className="alert-history-list">
                  {displayedAlertHistory.map((entry) => (
                    <li className="alert-history-entry" key={entry.id}>
                      <p className="status-message">{new Date(entry.created_at).toLocaleString()} · {entry.status}</p>
                      <p className="status-message">
                        {entry.latitude.toFixed(5)}, {entry.longitude.toFixed(5)} · ±{Math.round(entry.accuracy_m)} m
                      </p>
                      {entry.error && <p className="status-message">{entry.error}</p>}
                    </li>
                  ))}
                </ul>
              )}
              {alertHistory.length > 3 && (
                <button
                  className="cancel-button"
                  type="button"
                  onClick={() => setShowAllAlertHistory((showAll) => !showAll)}
                >
                  {showAllAlertHistory ? 'Show less' : `See all (${alertHistory.length})`}
                </button>
              )}
              <button
                className="cancel-button"
                type="button"
                onClick={() => {
                  const history = readAlertHistory()
                  setAlertHistory(history)
                  setSelectedAlertId(history[0]?.id ?? null)
                  setReportAlertListOpen(false)
                  setReportOpen(true)
                  setReportMessage('')
                  setReportErrorDetail('')
                }}
              >
                Report a problem
              </button>
              <button
                className="cancel-button"
                type="button"
                onClick={() => {
                  setAlertInfoOpen(false)
                  setScreenState(alertInfoReturnTo)
                }}
              >
                Back
              </button>
            </div>
          )
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
            <h1 className="sending-title">{sendingStage}</h1>
            <div className="sending-track" role="progressbar" aria-label="Sending alert" aria-valuemin={0} aria-valuemax={100}>
              <div className={`sending-fill${screenState === 'sending' ? ' bar-active' : ''}`} />
            </div>
            {cancelWindowActive && sendingStage !== 'Approving…' && (
              <button className="cancel-button" type="button" onClick={cancel}>Cancel</button>
            )}
          </div>
        ) : screenState === 'rate-limited' ? (
          <div className="status-panel rate-limit-panel">
            <p className="status-message">
              Your alerts were already sent. You can send another in {rateLimitRemaining ?? 60} seconds. If you are in immediate danger, call 112.
            </p>
            <a className="call-112-button" href="tel:112">Call 112</a>
            <p className="status-message" role="status" aria-live="polite">
              SOS available in {rateLimitRemaining ?? 60} seconds.
            </p>
          </div>
        ) : (
          <div className="status-panel">
            <h1 className="status-label">
              {screenState === 'locating'
                ? 'Locating…'
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