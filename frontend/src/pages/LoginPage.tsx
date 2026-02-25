import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const { login, loading, fetchUser } = useAuthStore()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const nextPath = searchParams.get('next') ?? '/'

  useEffect(() => {
    fetchUser()
      .then(() => {
        if (localStorage.getItem('token')) navigate(nextPath)
      })
      .catch((err) => console.error('fetchUser error:', err))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await login(email, password)
      toast.success('Logged in successfully')
      navigate(nextPath)
    } catch {
      toast.error('Invalid credentials')
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card} className="animate-fade-in-scale">
        <div style={styles.logoArea}>
          <div style={styles.logoIcon}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" fill="rgba(26,127,75,0.15)" stroke="#1a7f4b" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M2 7l10 5 10-5" stroke="#1a7f4b" strokeWidth="1.5"/>
              <path d="M12 12v10" stroke="#1a7f4b" strokeWidth="1.5"/>
            </svg>
          </div>
          <h1 style={styles.logoText}>Underleaf</h1>
          <p style={styles.tagline}>Collaborative LaTeX editor</p>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label} htmlFor="login-password">Password</label>
            <div className="password-field">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="eye-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                tabIndex={-1}
              >
                {showPassword ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
          </div>
          <div style={styles.forgotRow}>
            <Link to="/forgot-password" style={styles.forgotLink}>Forgot password?</Link>
          </div>
          <button type="submit" className="primary" disabled={loading} style={styles.submitBtn}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={styles.footer}>
          Don't have an account?{' '}
          <Link to="/register">Create one</Link>
        </p>
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
    backgroundColor: 'var(--color-background)',
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
    marginBottom: '6px',
  },
  tagline: {
    fontSize: '14px',
    color: 'var(--color-text-muted)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '16px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  forgotRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '-4px',
  },
  forgotLink: {
    fontSize: '13px',
  },
  submitBtn: {
    marginTop: '4px',
    padding: '11px',
    width: '100%',
    fontSize: '14px',
  },
  footer: {
    marginTop: '20px',
    textAlign: 'center' as const,
    fontSize: '13px',
    color: 'var(--color-text-muted)',
  },
}
