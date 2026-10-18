import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import type { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './lib/supabase'

export type Alert = {
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

export type UserRole = 'admin' | 'developer' | 'rescue' | string
type AlertTypeFilter = 'all' | 'sos' | 'checkin' | 'message'
type AlertStatusFilter = 'all' | 'new' | 'acknowledged'
type AlertTimeFilter = 'all' | '1h' | '24h' | '7d'
export type MapStyle = 'street' | 'satellite'

type AlertsMapProps = {
  mapStyle: MapStyle
  showTestAlerts: boolean
  isVisible: boolean
  onShowTestAlertsChange: (show: boolean) => void
  onMapStyleChange: (style: MapStyle) => void
  onRoleChange: (role: UserRole | null) => void
  onAlertsChange: (alerts: Alert[]) => void
}

const SOFIA: LatLngExpression = [42.6977, 23.3219]
const TIME_FILTER_MS: Record<Exclude<AlertTimeFilter, 'all'>, number> = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
}

function MapCenter({ center }: { center: LatLngExpression }) {
  const map = useMap()
  const latitude = Array.isArray(center) ? center[0] : center.lat
  const longitude = Array.isArray(center) ? center[1] : center.lng

  useEffect(() => {
    map.setView([latitude, longitude])
  }, [latitude, longitude, map])

  return null
}

function MapSizeInvalidator({ isVisible }: { isVisible: boolean }) {
  const map = useMap()

  useEffect(() => {
    const container = map.getContainer()
    const invalidateSize = () => map.invalidateSize({ pan: false })
    const observer = new ResizeObserver(invalidateSize)

    observer.observe(container)
    window.addEventListener('resize', invalidateSize)
    invalidateSize()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', invalidateSize)
    }
  }, [map])

  useEffect(() => {
    if (isVisible) map.invalidateSize({ pan: false })
  }, [isVisible, map])

  return null
}

export default function AlertsMap({
  mapStyle,
  showTestAlerts,
  isVisible,
  onShowTestAlertsChange,
  onMapStyleChange,
  onRoleChange,
  onAlertsChange,
}: AlertsMapProps) {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [role, setRole] = useState<UserRole | null>(null)
  const [typeFilter, setTypeFilter] = useState<AlertTypeFilter>('all')
  const [statusFilter, setStatusFilter] = useState<AlertStatusFilter>('all')
  const [timeFilter, setTimeFilter] = useState<AlertTimeFilter>('all')
  const [filtersAppliedAt, setFiltersAppliedAt] = useState(0)
  const [focusedAlertId, setFocusedAlertId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [alertsLoaded, setAlertsLoaded] = useState(false)
  const [alertsError, setAlertsError] = useState('')
  const [roleError, setRoleError] = useState('')
  const [tileError, setTileError] = useState(false)

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
    onAlertsChange((data ?? []) as Alert[])
    setFocusedAlertId(null)
    setAlertsLoaded(true)
    setIsLoading(false)
  }, [fetchAlerts, onAlertsChange])

  useEffect(() => {
    let isActive = true

    const loadRole = async () => {
      const { data, error } = await supabase.from('user_roles').select('role').single()
      if (!isActive) return
      if (error) {
        setRoleError(error.message)
        setRole(null)
        onRoleChange(null)
        return
      }
      setRole(data.role as UserRole)
      onRoleChange(data.role as UserRole)
    }

    void loadRole()
    void fetchAlerts().then(({ data, error }) => {
      if (!isActive) return
      if (error) {
        setAlertsError(`Could not load alerts: ${error.message}`)
      } else {
        const loadedAlerts = (data ?? []) as Alert[]
        setAlerts(loadedAlerts)
        onAlertsChange(loadedAlerts)
        setAlertsLoaded(true)
      }
      setIsLoading(false)
    })

    return () => {
      isActive = false
    }
  }, [fetchAlerts, onAlertsChange, onRoleChange])

  const canViewTestAlerts = role === 'admin' || role === 'developer'
  const visibleAlerts = useMemo(() => {
    if (!alertsLoaded) return []
    return alerts.filter((alert) => {
      if (!(canViewTestAlerts && showTestAlerts) && alert.is_test) return false
      if (typeFilter !== 'all' && alert.type.toLowerCase().replace(/[-_\s]/g, '') !== typeFilter) return false
      if (statusFilter !== 'all' && alert.status.toLowerCase() !== statusFilter) return false
      if (timeFilter !== 'all') {
        const createdAt = new Date(alert.created_at).getTime()
        if (!Number.isFinite(createdAt) || filtersAppliedAt - createdAt > TIME_FILTER_MS[timeFilter] || createdAt > filtersAppliedAt) {
          return false
        }
      }
      return true
    })
  }, [alerts, alertsLoaded, canViewTestAlerts, showTestAlerts, typeFilter, statusFilter, timeFilter, filtersAppliedAt])
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
  const resetFilters = () => {
    setFiltersAppliedAt(Date.now())
    setTypeFilter('all')
    setStatusFilter('all')
    setTimeFilter('all')
    setFocusedAlertId(null)
  }
  const selectStyle = {
    minHeight: 38,
    padding: '6px 10px',
    border: '1px solid #dedbd5',
    borderRadius: 8,
    background: '#fff',
    color: '#202321',
  }

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
        .alerts-map-column { position: relative; min-width: 0; }
        .alerts-map { width: 100%; height: 420px; min-height: 320px; border-radius: 10px; }
        .alerts-list { max-height: 560px; overflow: auto; overflow-x: hidden; }
        .alerts-filter-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .alerts-filter-row > label { min-width: 0; }
        .alerts-filter-row select { max-width: 100%; }
        .alerts-style-controls { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
        @media (min-width: 769px) {
          .alerts-style-controls { position: absolute; z-index: 1000; top: 12px; left: 12px; margin: 0; }
        }
        @media (max-width: 768px) {
          .alerts-layout { grid-template-columns: minmax(0, 1fr); }
          .alerts-map { width: 100%; height: 55vh; min-height: 320px; }
          .alerts-list { max-height: none; }
          .alerts-filter-row { display: grid; grid-template-columns: minmax(0, 1fr); }
          .alerts-filter-row > label, .alerts-filter-row select { width: 100%; }
          .alerts-filter-row > button { width: 100%; }
        }
      `}</style>
      <div className="alerts-heading-row" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, color: '#202321', fontSize: 24 }}>Alerts</h1>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16 }}>
          {canViewTestAlerts && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={showTestAlerts}
                onChange={(event) => {
                  setFiltersAppliedAt(Date.now())
                  onShowTestAlertsChange(event.target.checked)
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
            style={{ minHeight: 44, padding: '8px 14px', border: '1px solid #dedbd5', borderRadius: 8, background: '#fff', color: '#202321', fontWeight: 600, cursor: isLoading ? 'wait' : 'pointer' }}
          >
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>
      {alertsError && <p role="alert" style={{ margin: '0 0 12px', color: '#c7352c' }}>{alertsError}</p>}
      {roleError && <p role="alert" style={{ margin: '0 0 12px', color: '#c7352c' }}>{roleError}</p>}
      {tileError && (
        <p role="alert" style={{ margin: '0 0 12px', color: '#c7352c' }}>
          Map tiles could not load. Check your connection.
        </p>
      )}
      <div className="alerts-layout">
        <div className="alerts-map-column">
        <MapContainer className="alerts-map" center={center} zoom={visibleAlerts.length ? 13 : 11} scrollWheelZoom>
          <MapCenter center={center} />
          <MapSizeInvalidator isVisible={isVisible} />
          <TileLayer
            attribution={mapStyle === 'street' ? '© OpenStreetMap contributors' : 'Tiles © Esri'}
            url={mapStyle === 'street'
              ? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
              : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'}
            eventHandlers={{
              tileerror: () => setTileError(true),
              tileload: () => setTileError(false),
            }}
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
                  </div>
                </Popup>
              </CircleMarker>
            )
          })}
        </MapContainer>
        <div className="alerts-style-controls">
          {(['street', 'satellite'] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={mapStyle === style}
              onClick={() => onMapStyleChange(style)}
              style={{
                minHeight: 44,
                padding: '8px 12px',
                border: mapStyle === style ? '2px solid #202321' : '1px solid #dedbd5',
                borderRadius: 6,
                background: '#fff',
                color: '#202321',
                cursor: 'pointer',
              }}
            >
              {style === 'street' ? 'Street' : 'Satellite'}
            </button>
          ))}
        </div>
        </div>
        <div className="alerts-list" style={{ display: 'grid', alignContent: 'start', gap: 8 }}>
          <div className="alerts-filter-row">
            <label style={{ display: 'grid', gap: 4, color: '#626863', fontSize: 12 }}>
              Type
              <select value={typeFilter} onChange={(event) => {
                setFiltersAppliedAt(Date.now())
                setTypeFilter(event.target.value as AlertTypeFilter)
                setFocusedAlertId(null)
              }} style={selectStyle}>
                <option value="all">All types</option>
                <option value="sos">SOS</option>
                <option value="checkin">Check-in</option>
                <option value="message">Message</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, color: '#626863', fontSize: 12 }}>
              Status
              <select value={statusFilter} onChange={(event) => {
                setFiltersAppliedAt(Date.now())
                setStatusFilter(event.target.value as AlertStatusFilter)
                setFocusedAlertId(null)
              }} style={selectStyle}>
                <option value="all">All statuses</option>
                <option value="new">New</option>
                <option value="acknowledged">Acknowledged</option>
              </select>
            </label>
            <label style={{ display: 'grid', gap: 4, color: '#626863', fontSize: 12 }}>
              Time
              <select value={timeFilter} onChange={(event) => {
                setFiltersAppliedAt(Date.now())
                setTimeFilter(event.target.value as AlertTimeFilter)
                setFocusedAlertId(null)
              }} style={selectStyle}>
                <option value="all">All time</option>
                <option value="1h">Last hour</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
              </select>
            </label>
            <button
              type="button"
              onClick={resetFilters}
              style={{ alignSelf: 'end', minHeight: 38, padding: '6px 10px', border: '1px solid #dedbd5', borderRadius: 8, background: '#fff', color: '#202321', cursor: 'pointer' }}
            >
              Reset filters
            </button>
          </div>
          {alertsLoaded && (
            <p style={{ margin: '0 0 4px', color: '#626863' }}>
              Showing {visibleAlerts.length} of {alerts.length} alerts
            </p>
          )}
          {alertsLoaded && (
            <p style={{ margin: '0 0 4px', color: '#626863' }}>
              Loaded {alerts.length} alerts ({testAlertCount} tests)
            </p>
          )}
          {alertsLoaded && !alertsError && alerts.length === 0 ? (
            <p style={{ margin: 0, color: '#626863' }}>No alerts to show.</p>
          ) : alertsLoaded && !alertsError && visibleAlerts.length === 0 ? (
            <p style={{ margin: 0, color: '#626863' }}>No alerts match these filters.</p>
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
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
