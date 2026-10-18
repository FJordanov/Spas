import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './lib/supabase'

type Alert = {
  id: string
  created_at: string
  type: string
  priority: number
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  status: string
  is_test: boolean
  device_id: string
}

type UserRole = 'admin' | 'developer' | 'rescue' | string

const SOFIA: LatLngExpression = [42.6977, 23.3219]

function MapCenter({ center }: { center: LatLngExpression }) {
  const map = useMap()

  useEffect(() => {
    map.setView(center)
  }, [center, map])

  return null
}

export default function AlertsMap() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [role, setRole] = useState<UserRole | null>(null)
  const [showTestAlerts, setShowTestAlerts] = useState(false)
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [alertsLoaded, setAlertsLoaded] = useState(false)
  const [alertsError, setAlertsError] = useState('')
  const [roleError, setRoleError] = useState('')

  const fetchAlerts = useCallback(async () => {
    const { data, error } = await supabase
      .from('alerts')
      .select('id, created_at, type, priority, latitude, longitude, accuracy_m, status, is_test, device_id')
      .order('created_at', { ascending: false })
      .limit(100)

    return { data, error }
  }, [])

  const loadAlerts = useCallback(async () => {
    setIsLoading(true)
    setAlertsLoaded(false)
    setAlertsError('')
    const { data, error } = await fetchAlerts()
    if (error) {
      setAlertsError(`Could not load alerts: ${error.message}`)
      setIsLoading(false)
      return
    }

    setAlerts((data ?? []) as Alert[])
    setFocusedAlertId(null)
    setAlertsLoaded(true)
    setIsLoading(false)
  }, [fetchAlerts])

  useEffect(() => {
    let isActive = true

    const loadRole = async () => {
      const { data, error } = await supabase.from('user_roles').select('role').single()
      if (!isActive) return
      if (error) {
        setRoleError(error.message)
        setRole(null)
        return
      }
      setRole(data.role as UserRole)
    }

    void loadRole()
    void fetchAlerts().then(({ data, error }) => {
      if (!isActive) return
      if (error) {
        setAlertsError(`Could not load alerts: ${error.message}`)
      } else {
        setAlerts((data ?? []) as Alert[])
        setAlertsLoaded(true)
      }
      setIsLoading(false)
    })

    return () => {
      isActive = false
    }
  }, [fetchAlerts])

  const canViewTestAlerts = role === 'admin' || role === 'developer'
  const canViewDeviceId = canViewTestAlerts
  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => (canViewTestAlerts && showTestAlerts) || !alert.is_test),
    [alerts, canViewTestAlerts, showTestAlerts],
  )
  const visibleAlertsWithCoordinates = visibleAlerts.filter(
    (alert): alert is Alert & { latitude: number; longitude: number } =>
      typeof alert.latitude === 'number'
      && Number.isFinite(alert.latitude)
      && typeof alert.longitude === 'number'
      && Number.isFinite(alert.longitude),
  )
  const focusedAlert = visibleAlertsWithCoordinates.find((alert) => alert.id === focusedAlertId)
  const center: LatLngExpression = focusedAlert
    ? [focusedAlert.latitude, focusedAlert.longitude]
    : visibleAlertsWithCoordinates[0]
      ? [visibleAlertsWithCoordinates[0].latitude, visibleAlertsWithCoordinates[0].longitude]
      : SOFIA
  const testAlertCount = alerts.filter((alert) => alert.is_test).length

  const formatTime = (value: string) => new Date(value).toLocaleString()

  return (
    <section style={{ width: '100%' }}>
      <style>{`
        .alerts-layout {
          display: grid;
          grid-template-columns: minmax(0, 1.8fr) minmax(260px, 1fr);
          gap: 16px;
          align-items: start;
        }
        .alerts-map { width: 100%; height: 560px; border-radius: 10px; }
        .alerts-list { max-height: 560px; overflow: auto; }
        @media (max-width: 760px) {
          .alerts-layout { grid-template-columns: minmax(0, 1fr); }
          .alerts-map { height: 400px; }
          .alerts-list { max-height: none; }
        }
      `}</style>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, color: '#202321', fontSize: 24 }}>Alerts</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
          {canViewTestAlerts && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={showTestAlerts}
                onChange={(event) => {
                  setShowTestAlerts(event.target.checked)
                  setFocusedAlertId(null)
                }}
              />
              Show test alerts
            </label>
          )}
          <button
            type="button"
            onClick={() => { void loadAlerts() }}
            disabled={isLoading}
            style={{ minHeight: 40, padding: '8px 14px', border: '1px solid #dedbd5', borderRadius: 8, background: '#fff', color: '#202321', fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer' }}
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {alertsError && <p role="alert" style={{ margin: '0 0 12px', color: '#c7352c' }}>{alertsError}</p>}
      {roleError && <p role="alert" style={{ margin: '0 0 12px', color: '#c7352c' }}>{roleError}</p>}
      <div className="alerts-layout">
        <MapContainer className="alerts-map" center={center} zoom={visibleAlerts.length ? 13 : 11} scrollWheelZoom>
          <MapCenter center={center} />
          <TileLayer
            attribution="© OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {visibleAlertsWithCoordinates.map((alert) => {
            const color = alert.priority === 1 ? '#c7352c' : '#626863'
            return (
              <CircleMarker
                key={alert.id}
                center={[alert.latitude, alert.longitude]}
                radius={8}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.8,
                  weight: 2,
                  dashArray: alert.is_test ? '5 5' : undefined,
                }}
              >
                <Popup>
                  <div>
                    <div>{formatTime(alert.created_at)}</div>
                    <div>Type: {alert.type}</div>
                    <div>Priority: {alert.priority}</div>
                    <div>Status: {alert.status}</div>
                    <div>Accuracy: {alert.accuracy_m === null ? 'Unknown' : `${alert.accuracy_m} m`}</div>
                    <div>Test: {String(alert.is_test)}</div>
                    {canViewDeviceId && <div>Device: {alert.device_id}</div>}
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
        <div className="alerts-list" style={{ display: 'grid', alignContent: 'start', gap: 8 }}>
          {alertsLoaded && (
            <p style={{ margin: '0 0 4px', color: '#626863' }}>
              Loaded {alerts.length} alerts ({testAlertCount} tests)
            </p>
          )}
          {alertsLoaded && !alertsError && visibleAlerts.length === 0 ? (
            <p style={{ margin: 0, color: '#626863' }}>No alerts to show.</p>
          ) : visibleAlerts.map((alert) => (
            <button
              key={alert.id}
              type="button"
              onClick={() => {
                if (typeof alert.latitude === 'number' && typeof alert.longitude === 'number') {
                  setFocusedAlertId(alert.id)
                }
              }}
              disabled={typeof alert.latitude !== 'number' || typeof alert.longitude !== 'number'}
              style={{ width: '100%', padding: 12, border: '1px solid #dedbd5', borderRadius: 8, background: '#fff', color: '#202321', textAlign: 'left', cursor: 'pointer' }}
            >
              <span style={{ display: 'block', marginBottom: 4, color: '#626863', fontSize: 13 }}>
                {formatTime(alert.created_at)} · {alert.type} · {alert.status}
              </span>
              <span style={{ display: 'block' }}>
                {typeof alert.latitude === 'number' && typeof alert.longitude === 'number'
                  ? `${alert.latitude.toFixed(5)}, ${alert.longitude.toFixed(5)}`
                  : 'Coordinates unavailable'}
              </span>
              {canViewDeviceId && (
                <span style={{ display: 'block', marginTop: 4, color: '#626863', fontSize: 12 }}>
                  Device: {alert.device_id}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
