import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import LoginPage from './LoginPage'
import { supabase } from './lib/supabase'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

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

  if (isLoading) {
    return (
      <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f4f2ee', color: '#555d57', fontFamily: 'system-ui, sans-serif' }}>
        Loading…
      </main>
    )
  }

  if (!session) return <LoginPage />

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#f4f2ee',
        color: '#202321',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <section style={{ width: '100%', maxWidth: 480, padding: 32, border: '1px solid #dedbd5', borderRadius: 12, background: '#fff' }}>
        <p style={{ margin: '0 0 20px', color: '#202321', fontSize: 18, fontWeight: 600 }}>
          Signed in as {session.user.email}
        </p>
        <button
          type="button"
          onClick={() => { void supabase.auth.signOut() }}
          style={{ minHeight: 48, padding: '12px 18px', border: 0, borderRadius: 8, background: '#28734b', color: '#fff', fontSize: 15, fontWeight: 650, cursor: 'pointer' }}
        >
          Sign out
        </button>
      </section>
    </main>
  )
}
