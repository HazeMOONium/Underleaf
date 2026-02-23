import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { membersApi, invitesApi } from '../services/api'
import type { ProjectRole } from '../types'
import toast from 'react-hot-toast'

interface CollabModalProps {
  projectId: string
  onClose: () => void
}

type Tab = 'members' | 'email' | 'link'

const ASSIGNABLE_ROLES: Exclude<ProjectRole, 'owner'>[] = ['editor', 'commenter', 'viewer']

const ROLE_DESCRIPTIONS: Record<string, string> = {
  editor: 'Can edit files and compile',
  commenter: 'Can read and leave comments',
  viewer: 'Read-only access',
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (r: string) => void
  disabled?: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      style={styles.roleSelect}
    >
      {ASSIGNABLE_ROLES.map((r) => (
        <option key={r} value={r}>
          {r.charAt(0).toUpperCase() + r.slice(1)}
        </option>
      ))}
    </select>
  )
}

export default function CollabModal({ projectId, onClose }: CollabModalProps) {
  const [tab, setTab] = useState<Tab>('members')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<string>('editor')
  const [linkRole, setLinkRole] = useState<string>('editor')
  const queryClient = useQueryClient()

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => membersApi.list(projectId).then((r) => r.data),
  })

  const { data: invites = [], isLoading: invitesLoading } = useQuery({
    queryKey: ['invites', projectId],
    queryFn: () => invitesApi.list(projectId).then((r) => r.data),
  })

  const addMember = useMutation({
    mutationFn: () => membersApi.add(projectId, inviteEmail.trim(), inviteRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', projectId] })
      toast.success(`${inviteEmail} added as ${inviteRole}`)
      setInviteEmail('')
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.detail ?? 'Failed to add member')
    },
  })

  const updateMember = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      membersApi.update(projectId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', projectId] })
    },
    onError: () => toast.error('Failed to update role'),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => membersApi.remove(projectId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', projectId] })
      toast.success('Member removed')
    },
    onError: () => toast.error('Failed to remove member'),
  })

  const createInvite = useMutation({
    mutationFn: () => invitesApi.create(projectId, linkRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites', projectId] })
      toast.success('Invite link created')
    },
    onError: () => toast.error('Failed to create invite link'),
  })

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => invitesApi.revoke(projectId, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invites', projectId] })
      toast.success('Invite revoked')
    },
    onError: () => toast.error('Failed to revoke invite'),
  })

  const copyLink = (token: string) => {
    const url = `${window.location.origin}/invite/${token}`
    navigator.clipboard.writeText(url).then(
      () => toast.success('Link copied!'),
      () => toast.error('Could not copy link'),
    )
  }

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.header}>
          <h3 style={styles.title}>Share Project</h3>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          {(['members', 'email', 'link'] as Tab[]).map((t) => (
            <button
              key={t}
              style={{ ...styles.tab, ...(tab === t ? styles.activeTab : {}) }}
              onClick={() => setTab(t)}
            >
              {t === 'members' ? 'Members' : t === 'email' ? 'Invite by Email' : 'Invite Link'}
            </button>
          ))}
        </div>

        {/* Members tab */}
        {tab === 'members' && (
          <div style={styles.body}>
            {membersLoading ? (
              <p style={styles.hint}>Loading…</p>
            ) : (
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Role</th>
                    <th style={styles.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id}>
                      <td style={styles.td}>{m.email}</td>
                      <td style={styles.td}>
                        {m.role === 'owner' ? (
                          <span style={styles.ownerBadge}>Owner</span>
                        ) : (
                          <RoleSelect
                            value={m.role}
                            onChange={(role) =>
                              updateMember.mutate({ userId: m.user_id, role })
                            }
                          />
                        )}
                      </td>
                      <td style={styles.td}>
                        {m.role !== 'owner' && (
                          <button
                            style={styles.removeBtn}
                            onClick={() => removeMember.mutate(m.user_id)}
                          >
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Email tab */}
        {tab === 'email' && (
          <div style={styles.body}>
            <p style={styles.hint}>
              Add a collaborator by their Underleaf account email address.
            </p>
            <div style={styles.row}>
              <input
                type="email"
                placeholder="collaborator@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                style={styles.input}
                onKeyDown={(e) => e.key === 'Enter' && addMember.mutate()}
              />
              <RoleSelect value={inviteRole} onChange={setInviteRole} />
            </div>
            <div style={styles.roleHint}>{ROLE_DESCRIPTIONS[inviteRole]}</div>
            <button
              className="primary"
              onClick={() => addMember.mutate()}
              disabled={!inviteEmail.trim() || addMember.isPending}
              style={{ marginTop: 12 }}
            >
              {addMember.isPending ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        )}

        {/* Link tab */}
        {tab === 'link' && (
          <div style={styles.body}>
            <p style={styles.hint}>
              Generate a shareable link that grants the chosen role when accepted.
            </p>
            <div style={styles.row}>
              <RoleSelect value={linkRole} onChange={setLinkRole} />
              <button
                className="primary"
                onClick={() => createInvite.mutate()}
                disabled={createInvite.isPending}
              >
                {createInvite.isPending ? 'Generating…' : 'Generate Link'}
              </button>
            </div>
            <div style={styles.roleHint}>{ROLE_DESCRIPTIONS[linkRole]}</div>

            {invitesLoading ? (
              <p style={styles.hint}>Loading…</p>
            ) : invites.length === 0 ? (
              <p style={styles.hint}>No invite links yet.</p>
            ) : (
              <div style={styles.inviteList}>
                {invites.map((inv) => (
                  <div key={inv.id} style={styles.inviteRow}>
                    <div style={styles.inviteInfo}>
                      <span style={styles.inviteRole}>
                        {inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}
                      </span>
                      <span style={styles.inviteMeta}>
                        {inv.use_count} use{inv.use_count !== 1 ? 's' : ''}
                        {inv.max_uses != null ? ` / ${inv.max_uses} max` : ''}
                        {inv.expires_at
                          ? ` · expires ${new Date(inv.expires_at).toLocaleDateString()}`
                          : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="secondary" onClick={() => copyLink(inv.token)}>
                        Copy
                      </button>
                      <button
                        className="secondary"
                        style={{ color: '#dc2626' }}
                        onClick={() => revokeInvite.mutate(inv.id)}
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 8,
    width: 520,
    maxWidth: '95vw',
    maxHeight: '85vh',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px 16px',
    borderBottom: '1px solid var(--color-border)',
  },
  title: { margin: 0, fontSize: 18, fontWeight: 600 },
  closeBtn: {
    background: 'none',
    border: 'none',
    fontSize: 18,
    cursor: 'pointer',
    color: 'var(--color-text-muted)',
    padding: '2px 6px',
  },
  tabs: {
    display: 'flex',
    borderBottom: '1px solid var(--color-border)',
  },
  tab: {
    flex: 1,
    padding: '10px 8px',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    fontSize: 14,
    color: 'var(--color-text-muted)',
  },
  activeTab: {
    borderBottomColor: 'var(--color-primary)',
    color: 'var(--color-primary)',
    fontWeight: 600,
  },
  body: {
    padding: '20px 24px',
    overflowY: 'auto',
    flex: 1,
  },
  hint: { color: 'var(--color-text-muted)', fontSize: 13, marginBottom: 12 },
  row: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 },
  roleHint: { fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 4 },
  input: {
    flex: 1,
    padding: '8px 12px',
    fontSize: 14,
    border: '1px solid var(--color-border)',
    borderRadius: 4,
  },
  roleSelect: {
    padding: '7px 8px',
    fontSize: 13,
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    background: 'var(--color-surface)',
    cursor: 'pointer',
  },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: {
    textAlign: 'left',
    padding: '6px 8px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    borderBottom: '1px solid var(--color-border)',
  },
  td: { padding: '8px', fontSize: 14, borderBottom: '1px solid var(--color-border)' },
  ownerBadge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 10,
    backgroundColor: '#dbeafe',
    color: '#1d4ed8',
    fontSize: 12,
    fontWeight: 600,
  },
  removeBtn: {
    padding: '3px 8px',
    fontSize: 12,
    background: 'none',
    border: '1px solid #fca5a5',
    borderRadius: 4,
    color: '#dc2626',
    cursor: 'pointer',
  },
  inviteList: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 },
  inviteRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 12px',
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    gap: 8,
  },
  inviteInfo: { display: 'flex', flexDirection: 'column', gap: 2 },
  inviteRole: { fontSize: 13, fontWeight: 600 },
  inviteMeta: { fontSize: 12, color: 'var(--color-text-muted)' },
}
