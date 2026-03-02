import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore, type TwoFAChallenge } from '../stores/auth'
import toast from 'react-hot-toast'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [totpChallenge, setTotpChallenge] = useState<TwoFAChallenge | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const { login, completeTotpLogin, loading, fetchUser } = useAuthStore()
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
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'requires2FA' in err) {
        setTotpChallenge(err as TwoFAChallenge)
      } else {
        toast.error('Invalid credentials')
      }
    }
  }

  const handleTotpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!totpChallenge) return
    try {
      await completeTotpLogin(totpChallenge.sessionToken, totpCode)
      toast.success('Logged in successfully')
      navigate(nextPath)
    } catch {
      toast.error('Invalid authentication code')
      setTotpCode('')
    }
  }

  const Logo = () => (
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
  )

  if (totpChallenge) {
    return (
      <div style={styles.page}>
        <div style={styles.card} className="animate-fade-in-scale">
          <Logo />
          <p style={{ textAlign: 'center', marginBottom: 20, color: 'var(--color-text-muted)', fontSize: 14 }}>
            Enter the 6-digit code from your authenticator app, or one of your backup codes.
          </p>
          <form onSubmit={handleTotpSubmit} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="totp-code">Authentication code</label>
              <input
                id="totp-code"
                type="text"
                inputMode="numeric"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.trim())}
                placeholder="123456"
                autoComplete="one-time-code"
                autoFocus
                maxLength={10}
                required
              />
            </div>
            <button type="submit" className="primary" disabled={loading} style={styles.submitBtn}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              style={{ ...styles.submitBtn, background: 'none', color: 'var(--color-text-muted)', border: '1px solid var(--color-border)' }}
              onClick={() => { setTotpChallenge(null); setTotpCode('') }}
            >
              Back to login
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.card} className="animate-fade-in-scale">
        <Logo />

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

        <div style={styles.divider}>
          <span style={styles.dividerText}>or continue with</span>
        </div>

        <div style={styles.oauthRow}>
          <a href="/api/v1/auth/oauth/google" style={styles.oauthBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            Google
          </a>
          <a href="/api/v1/auth/oauth/github" style={styles.oauthBtn}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
            GitHub
          </a>
        </div>

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
  divider: {
    position: 'relative' as const,
    textAlign: 'center' as const,
    margin: '20px 0 16px',
    borderTop: '1px solid var(--color-border)',
  },
  dividerText: {
    position: 'relative' as const,
    top: '-10px',
    backgroundColor: 'var(--color-surface)',
    padding: '0 10px',
    fontSize: '12px',
    color: 'var(--color-text-muted)',
  },
  oauthRow: {
    display: 'flex',
    gap: '10px',
    marginBottom: '16px',
  },
  oauthBtn: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    padding: '9px',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    backgroundColor: 'var(--color-surface)',
    color: 'var(--color-text)',
    fontSize: '13px',
    fontWeight: 500,
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'background var(--transition-fast)',
  },
}
