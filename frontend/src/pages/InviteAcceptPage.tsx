import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invitesApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import toast from 'react-hot-toast'

const ROLE_LABELS: Record<string, string> = {
  editor: 'Editor — can edit files and compile',
  commenter: 'Commenter — can read and leave comments',
  viewer: 'Viewer — read-only access',
}

export default function InviteAcceptPage() {
  const { token } = useParams<{ token: string }>()
  const { user } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const { data: preview, isLoading, error } = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => invitesApi.preview(token!).then((r) => r.data),
    enabled: !!token,
    retry: false,
  })

  const accept = useMutation({
    mutationFn: () => invitesApi.accept(token!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['members'] })
      toast.success(`Joined as ${res.data.role}`)
      navigate(`/project/${preview!.project_id}`)
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? 'Failed to accept invite')
    },
  })

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <h2 style={styles.heading}>Project Invitation</h2>

        {isLoading && <p style={styles.muted}>Loading invite details…</p>}

        {error && (
          <div style={styles.error}>
            <p style={{ fontWeight: 600, marginBottom: 4 }}>Invalid or expired invite</p>
            <p style={{ fontSize: 13 }}>This invite link may have expired or been revoked.</p>
            <Link to="/" style={{ fontSize: 14 }}>Go to Dashboard</Link>
          </div>
        )}

        {preview && (
          <>
            <div style={styles.projectInfo}>
              <div style={styles.projectTitle}>{preview.project_title}</div>
              <div style={styles.invitedBy}>Invited by {preview.created_by_email}</div>
              <div style={styles.rolePill}>
                {ROLE_LABELS[preview.role] ?? preview.role}
              </div>
            </div>

            {!user ? (
              <div>
                <p style={styles.muted}>
                  You need to be signed in to accept this invitation.
                </p>
                <Link
                  to={`/login?next=/invite/${token}`}
                  className="primary"
                  style={{ display: 'inline-block', padding: '10px 20px', borderRadius: 6, textDecoration: 'none' }}
                >
                  Sign in to Accept
                </Link>
              </div>
            ) : (
              <button
                className="primary"
                style={styles.acceptBtn}
                onClick={() => accept.mutate()}
                disabled={accept.isPending}
              >
                {accept.isPending ? 'Joining…' : `Join as ${preview.role.charAt(0).toUpperCase() + preview.role.slice(1)}`}
              </button>
            )}
          </>
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
    backgroundColor: 'var(--color-background)',
    padding: 20,
  },
  card: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 12,
    padding: '40px 48px',
    maxWidth: 440,
    width: '100%',
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
    border: '1px solid var(--color-border)',
  },
  heading: { margin: '0 0 24px', fontSize: 22, fontWeight: 700 },
  projectInfo: {
    padding: '16px',
    backgroundColor: 'var(--color-background)',
    borderRadius: 8,
    marginBottom: 24,
    border: '1px solid var(--color-border)',
  },
  projectTitle: { fontSize: 18, fontWeight: 600, marginBottom: 4 },
  invitedBy: { fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 },
  rolePill: {
    display: 'inline-block',
    padding: '4px 12px',
    borderRadius: 20,
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    fontSize: 13,
    fontWeight: 500,
  },
  muted: { color: 'var(--color-text-muted)', fontSize: 14, marginBottom: 16 },
  error: {
    padding: 16,
    backgroundColor: '#fef2f2',
    borderRadius: 8,
    border: '1px solid #fecaca',
    color: '#dc2626',
    marginBottom: 16,
  },
  acceptBtn: { width: '100%', padding: '12px', fontSize: 15 },
}
