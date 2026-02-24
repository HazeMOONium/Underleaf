import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { authApi } from '../services/api'
import toast from 'react-hot-toast'

export default function ProfilePage() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('New passwords do not match')
      return
    }
    if (newPassword.length < 6) {
      toast.error('New password must be at least 6 characters')
      return
    }
    setChangingPassword(true)
    try {
      await authApi.changePassword(currentPassword, newPassword)
      toast.success('Password changed successfully')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { detail?: string } } }
      const detail = axiosErr?.response?.data?.detail
      toast.error(detail ?? 'Failed to change password')
    } finally {
      setChangingPassword(false)
    }
  }

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const createdAt = user?.created_at
    ? new Date(user.created_at).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : 'Unknown'

  const userInitial = (user?.email?.[0] ?? 'U').toUpperCase()

  return (
    <div style={styles.page}>
      <div style={styles.card} className="animate-fade-in-scale">
        {/* Header */}
        <div style={styles.header}>
          <Link to="/" style={styles.backLink}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back to Dashboard
          </Link>
        </div>

        {/* Avatar + user info */}
        <div style={styles.avatarSection}>
          <div style={styles.avatar}>{userInitial}</div>
          <div>
            <div style={styles.userName}>{user?.email ?? 'Loading...'}</div>
            <div style={styles.userRole}>
              {user?.role === 'admin' ? 'Administrator' : 'User'}
            </div>
          </div>
        </div>

        {/* Account Info */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Account Information</h2>
          <div style={styles.infoGrid}>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Email</span>
              <span style={styles.infoValue}>{user?.email ?? '-'}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Member since</span>
              <span style={styles.infoValue}>{createdAt}</span>
            </div>
            <div style={styles.infoRow}>
              <span style={styles.infoLabel}>Account role</span>
              <span style={styles.infoValue}>{user?.role ?? '-'}</span>
            </div>
          </div>
        </section>

        <div style={styles.divider} />

        {/* Change Password */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Change Password</h2>
          <form onSubmit={handleChangePassword} style={styles.form}>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="current-password">
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
                minLength={6}
              />
            </div>
            <div style={styles.field}>
              <label style={styles.label} htmlFor="confirm-password">
                Confirm new password
              </label>
              <input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat new password"
                required
              />
            </div>
            <button
              type="submit"
              className="primary"
              disabled={changingPassword}
              style={styles.submitBtn}
            >
              {changingPassword ? 'Saving…' : 'Update password'}
            </button>
          </form>
        </section>

        <div style={styles.divider} />

        {/* Sign out */}
        <section style={styles.section}>
          <h2 style={styles.sectionTitle}>Session</h2>
          <button
            style={styles.signOutBtn}
            onClick={handleLogout}
          >
            Sign out of this account
          </button>
        </section>

        <div style={styles.divider} />

        {/* Danger Zone */}
        <section style={styles.section}>
          <h2 style={{ ...styles.sectionTitle, color: '#dc2626' }}>Danger Zone</h2>
          <div style={styles.dangerCard}>
            <div>
              <div style={styles.dangerTitle}>Delete account</div>
              <div style={styles.dangerDesc}>
                Permanently remove your account and all associated data.
              </div>
            </div>
            <button
              style={styles.dangerBtn}
              disabled
              title="Contact admin to delete account"
              aria-label="Delete account — contact admin to delete account"
            >
              Delete account
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'center',
    backgroundColor: 'var(--color-background)',
    background: 'linear-gradient(135deg, #f0f4f8 0%, #e8f0e9 100%)',
    padding: '40px 16px',
  },
  card: {
    width: '100%',
    maxWidth: '520px',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-xl)',
    boxShadow: 'var(--shadow-xl)',
    border: '1px solid var(--color-border)',
    overflow: 'hidden',
  },
  header: {
    padding: '16px 32px',
    borderBottom: '1px solid var(--color-border)',
  },
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    textDecoration: 'none',
  },
  avatarSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    padding: '28px 32px 24px',
    borderBottom: '1px solid var(--color-border)',
  },
  avatar: {
    width: '56px',
    height: '56px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-brand)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
    fontWeight: 700,
    color: '#fff',
    flexShrink: 0,
  },
  userName: {
    fontSize: '16px',
    fontWeight: 700,
    color: 'var(--color-text)',
  },
  userRole: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  section: {
    padding: '24px 32px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: 'var(--color-text)',
    marginBottom: '16px',
    letterSpacing: '0.01em',
  },
  infoGrid: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '13px',
    padding: '8px 0',
    borderBottom: '1px solid var(--color-border)',
  },
  infoLabel: {
    color: 'var(--color-text-muted)',
    fontWeight: 500,
  },
  infoValue: {
    color: 'var(--color-text)',
    fontWeight: 600,
  },
  divider: {
    height: '1px',
    backgroundColor: 'var(--color-border)',
  },
  form: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '14px',
  },
  field: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '5px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--color-text)',
    letterSpacing: '0.02em',
  },
  submitBtn: {
    marginTop: '4px',
    padding: '10px',
    width: '100%',
    fontSize: '13px',
  },
  signOutBtn: {
    padding: '9px 20px',
    fontSize: '13px',
    border: '1.5px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'none',
    color: 'var(--color-text)',
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'background var(--transition-fast)',
  },
  dangerCard: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    padding: '16px',
    border: '1px solid #fecaca',
    borderRadius: 'var(--radius-md)',
    backgroundColor: '#fef2f2',
  },
  dangerTitle: {
    fontSize: '13px',
    fontWeight: 600,
    color: '#dc2626',
    marginBottom: '2px',
  },
  dangerDesc: {
    fontSize: '12px',
    color: '#ef4444',
    lineHeight: 1.4,
  },
  dangerBtn: {
    padding: '8px 16px',
    fontSize: '12px',
    border: '1px solid #fca5a5',
    borderRadius: 'var(--radius-md)',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    cursor: 'not-allowed',
    fontWeight: 600,
    opacity: 0.6,
    flexShrink: 0,
    whiteSpace: 'nowrap' as const,
  },
}
