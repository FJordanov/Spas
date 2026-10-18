import { useState, type FormEvent } from 'react'
import { supabase } from './lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!email.trim()) return

    setMessage('')
    setErrorMessage('')
    setIsSubmitting(true)

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      })

      if (error) {
        setErrorMessage(error.message)
      } else {
        setMessage('Check your email for a login link.')
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : String(error))
    } finally {
      setIsSubmitting(false)
    }
  }

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
      <section
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 32,
          border: '1px solid #dedbd5',
          borderRadius: 12,
          background: '#fff',
          boxShadow: '0 16px 40px #20232112',
        }}
      >
        <h1
          style={{
            margin: '0 0 28px',
            color: '#202321',
            fontFamily: 'system-ui, sans-serif',
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: 0,
            lineHeight: 1.2,
          }}
        >
          Spas Staff Login
        </h1>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 16 }}>
          <label style={{ display: 'grid', gap: 8, color: '#424843', fontSize: 14, fontWeight: 600 }}>
            Email address
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              style={{
                width: '100%',
                minHeight: 48,
                padding: '10px 12px',
                border: '1px solid #c8c5bf',
                borderRadius: 8,
                background: '#fff',
                color: '#202321',
                font: 'inherit',
              }}
            />
          </label>
          <button
            type="submit"
            disabled={!email.trim() || isSubmitting}
            style={{
              minHeight: 48,
              padding: '12px 16px',
              border: 0,
              borderRadius: 8,
              background: !email.trim() || isSubmitting ? '#a7aaa7' : '#28734b',
              color: '#fff',
              fontSize: 15,
              fontWeight: 650,
              cursor: !email.trim() || isSubmitting ? 'not-allowed' : 'pointer',
            }}
          >
            {isSubmitting ? 'Sending…' : 'Send login link'}
          </button>
        </form>
        {message && <p role="status" style={{ margin: '18px 0 0', color: '#28734b', fontSize: 14 }}>{message}</p>}
        {errorMessage && <p role="alert" style={{ margin: '18px 0 0', color: '#c7352c', fontSize: 14 }}>{errorMessage}</p>}
      </section>
    </main>
  )
}
