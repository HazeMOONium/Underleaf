import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../services/api'
import toast from 'react-hot-toast'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      await authApi.forgotPassword(email)
      setSent(true)
    } catch {
      toast.error('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
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
          <p style={styles.tagline}>Reset your password</p>
        </div>

        {sent ? (
          <div style={styles.successBox}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" style={{ margin: '0 auto 12px' }}>
              <circle cx="12" cy="12" r="10" stroke="#1a7f4b" strokeWidth="1.5"/>
              <path d="M8 12l3 3 5-5" stroke="#1a7f4b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <p style={styles.successTitle}>Check your email</p>
            <p style={styles.successBody}>
              If <strong>{email}</strong> is registered, we've sent a reset link.
              Check your inbox (and spam folder).
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={styles.form}>
            <p style={styles.instructions}>
              Enter your email and we'll send you a link to reset your password.
            </p>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="forgot-email">Email</label>
              <input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>
            <button type="submit" className="primary" disabled={loading} style={styles.submitBtn}>
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}

        <p style={styles.footer}>
          <Link to="/login">← Back to sign in</Link>
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
  instructions: {
    fontSize: '14px',
    color: 'var(--color-text-muted)',
    marginBottom: '4px',
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
  successBox: {
    textAlign: 'center' as const,
    padding: '8px 0',
  },
  successTitle: {
    fontSize: '17px',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '8px',
  },
  successBody: {
    fontSize: '14px',
    color: 'var(--color-text-muted)',
    lineHeight: 1.6,
  },
}
