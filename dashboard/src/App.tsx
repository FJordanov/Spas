import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import LoginPage from './LoginPage'
import AlertsMap, { type Alert, type MapStyle, type UserRole } from './AlertsMap'
import Layout from './Layout'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [role, setRole] = useState<UserRole | null>(null)
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [showTestAlerts, setShowTestAlerts] = useState(false)
  const [mapStyle, setMapStyle] = useState<MapStyle>(() => {
    try {
      return localStorage.getItem('spas_dashboard_map') === 'satellite' ? 'satellite' : 'street'
    } catch {
      return 'street'
    }
  })

  const handleRoleChange = useCallback((nextRole: UserRole | null) => setRole(nextRole), [])
  const handleAlertsChange = useCallback((nextAlerts: Alert[]) => setAlerts(nextAlerts), [])
  const handleShowTestAlertsChange = useCallback((show: boolean) => setShowTestAlerts(show), [])
  const handleMapStyleChange = useCallback((style: MapStyle) => setMapStyle(style), [])

  useEffect(() => {
    let isActive = true
    let authEventReceived = false
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!isActive) return
      authEventReceived = true
      setSession(nextSession)
      setIsLoading(false)
    })

    supabase.auth.getSession()
      .then(({ data: { session: currentSession } }) => {
        if (isActive && !authEventReceived) {
          setSession(currentSession)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (isActive && !authEventReceived) setIsLoading(false)
      })

    return () => {
      isActive = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('spas_dashboard_map', mapStyle)
    } catch {
      // Keep the selected map style active for the current session.
    }
  }, [mapStyle])

  if (isLoading) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f4f2ee', color: '#555d57', fontFamily: 'system-ui, sans-serif' }}>
        Loading…
      </main>
    )
  }

  if (!session) return <LoginPage />

  return (
    <Layout
      email={session.user.email ?? ''}
      role={role}
      showTestAlerts={showTestAlerts}
      onShowTestAlertsChange={handleShowTestAlertsChange}
      alertCount={alerts.length}
      testAlertCount={alerts.filter((alert) => alert.is_test).length}
      alerts={alerts}
      mapStyle={mapStyle}
      onMapStyleChange={handleMapStyleChange}
      onSignOut={() => { void supabase.auth.signOut() }}
      alertsContent={(isVisible) => (
        <AlertsMap
          mapStyle={mapStyle}
          showTestAlerts={showTestAlerts}
          isVisible={isVisible}
          onShowTestAlertsChange={handleShowTestAlertsChange}
          onMapStyleChange={handleMapStyleChange}
          onRoleChange={handleRoleChange}
          onAlertsChange={handleAlertsChange}
        />
      )}
    />
  )
}
