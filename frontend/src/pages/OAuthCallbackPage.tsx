import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { authApi } from '../services/api'
import toast from 'react-hot-toast'

/**
 * Landing page for OAuth redirects.
 * The backend redirects here with ?token=<access_token> after a successful
 * OAuth login. We store the token, fetch the user profile, then navigate home.
 * On error, ?oauth_error=<reason> redirects back to the login page with a toast.
 */
export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { setToken } = useAuthStore()

  useEffect(() => {
    const token = searchParams.get('token')
    const oauthError = searchParams.get('oauth_error')

    if (oauthError) {
      const messages: Record<string, string> = {
        access_denied: 'OAuth login was cancelled',
        state_error: 'OAuth state error — please try again',
        state_mismatch: 'OAuth state mismatch — please try again',
        token_exchange: 'Failed to exchange OAuth token',
        no_token: 'No token received from OAuth provider',
        userinfo_failed: 'Failed to retrieve user information',
        no_email: 'OAuth account has no accessible email address',
      }
      toast.error(messages[oauthError] ?? 'OAuth login failed')
      navigate('/login')
      return
    }

    if (!token) {
      toast.error('No token received')
      navigate('/login')
      return
    }

    setToken(token)
    authApi.me()
      .then(({ data }) => {
        useAuthStore.setState({ user: data })
        toast.success('Logged in successfully')
        navigate('/')
      })
      .catch(() => {
        toast.error('Failed to fetch user profile')
        navigate('/login')
      })
  }, [])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: 'var(--color-text-muted)', fontSize: 14 }}>Completing login…</p>
    </div>
  )
}
