import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authApi } from '../services/api'

type VerifyState = 'loading' | 'success' | 'error'

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [state, setState] = useState<VerifyState>('loading')

  useEffect(() => {
    const token = searchParams.get('token')

    // If there is no token in the URL, redirect to login immediately.
    // This prevents the page from being a confusing dead-end when visited directly.
    if (!token) {
      navigate('/login', { replace: true })
      return
    }

    let cancelled = false

    authApi
      .verifyEmail(token)
      .then(() => {
        if (!cancelled) setState('success')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })

    return () => {
      cancelled = true
    }
  }, []) // Run once on mount — token is stable for the lifetime of this page

  return (
    <div style={styles.page}>
      <div style={styles.card} className="animate-fade-in-scale">
        {/* Logo area */}
        <div style={styles.logoArea}>
          <div style={styles.logoIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7v10l10 5 10-5V7L12 2z"
                fill="rgba(26,127,75,0.15)"
                stroke="#1a7f4b"
                strokeWidth="1.5"
                strokeLinejoin="round"
              />
              <path d="M2 7l10 5 10-5" stroke="#1a7f4b" strokeWidth="1.5" />
              <path d="M12 12v10" stroke="#1a7f4b" strokeWidth="1.5" />
            </svg>
          </div>
          <h1 style={styles.logoText}>Underleaf</h1>
        </div>

        {/* Content varies by verification state */}
        {state === 'loading' && (
          <div style={styles.stateBox}>
            <div style={styles.spinner} />
            <p style={styles.stateTitle}>Verifying your email...</p>
            <p style={styles.stateBody}>Please wait a moment.</p>
          </div>
        )}

        {state === 'success' && (
          <div style={styles.stateBox}>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              style={{ margin: '0 auto 16px' }}
            >
              <circle cx="12" cy="12" r="10" stroke="#1a7f4b" strokeWidth="1.5" />
              <path
                d="M8 12l3 3 5-5"
                stroke="#1a7f4b"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <p style={styles.stateTitle}>Email verified!</p>
            <p style={styles.stateBody}>
              Your email address has been confirmed. You can now sign in and
              access all features.
            </p>
            <Link to="/login" style={styles.actionBtn}>
              Go to sign in
            </Link>
          </div>
        )}

        {state === 'error' && (
          <div style={styles.stateBox}>
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              style={{ margin: '0 auto 16px' }}
            >
              <circle cx="12" cy="12" r="10" stroke="#ef4444" strokeWidth="1.5" />
              <path
                d="M15 9l-6 6M9 9l6 6"
                stroke="#ef4444"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
            <p style={{ ...styles.stateTitle, color: '#ef4444' }}>
              Verification failed
            </p>
            <p style={styles.stateBody}>
              This verification link is invalid or has expired. Links are valid
              for 24 hours and can only be used once.
            </p>
            <Link to="/login" style={styles.actionBtn}>
              Back to sign in
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #f0f4f8 0%, #e8f0e9 100%)',
  },
  card: {
    width: '100%',
    maxWidth: '400px',
    padding: '40px',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-xl)',
    border: '1px solid var(--color-border)',
  },
  logoArea: {
    textAlign: 'center' as const,
    marginBottom: '32px',
  },
  logoIcon: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: '12px',
  },
  logoText: {
    fontSize: '26px',
    fontWeight: 800,
    color: 'var(--color-text)',
    letterSpacing: '-0.03em',
  },
  stateBox: {
    textAlign: 'center' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '0',
  },
  spinner: {
    width: '40px',
    height: '40px',
    borderRadius: '50%',
    border: '3px solid var(--color-border)',
    borderTopColor: '#1a7f4b',
    animation: 'spin 0.8s linear infinite',
    margin: '0 auto 16px',
  },
  stateTitle: {
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '8px',
  },
  stateBody: {
    fontSize: '14px',
    color: 'var(--color-text-muted)',
    lineHeight: 1.6,
    marginBottom: '24px',
    maxWidth: '300px',
  },
  actionBtn: {
    display: 'inline-block',
    padding: '10px 24px',
    background: '#1a7f4b',
    color: '#fff',
    borderRadius: '6px',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: '14px',
  },
}
