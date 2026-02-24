import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import toast from 'react-hot-toast'

export default function DashboardPage() {
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: () => projectsApi.list().then((res) => res.data),
  })

  const createProject = useMutation({
    mutationFn: (title: string) => projectsApi.create(title),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setShowCreateModal(false)
      setNewProjectTitle('')
      navigate(`/project/${res.data.id}`)
    },
    onError: () => toast.error('Failed to create project'),
  })

  const deleteProject = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Project deleted')
    },
    onError: () => toast.error('Failed to delete project'),
  })

  const renameProject = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      projectsApi.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setRenamingId(null)
      toast.success('Project renamed')
    },
    onError: () => toast.error('Failed to rename project'),
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    createProject.mutate(newProjectTitle)
  }

  const handleDelete = (e: React.MouseEvent, id: string, title: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (window.confirm(`Delete "${title}"? This cannot be undone.`)) {
      deleteProject.mutate(id)
    }
  }

  const startRename = (e: React.MouseEvent, id: string, title: string) => {
    e.preventDefault()
    e.stopPropagation()
    setRenamingId(id)
    setRenameTitle(title)
  }

  const submitRename = (id: string) => {
    const trimmed = renameTitle.trim()
    if (trimmed && trimmed !== projects?.find((p) => p.id === id)?.title) {
      renameProject.mutate({ id, title: trimmed })
    } else {
      setRenamingId(null)
    }
  }

  const userInitial = (user?.email?.[0] ?? 'U').toUpperCase()

  return (
    <div style={styles.container}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <div style={styles.logoWrap}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
              <path d="M12 2L2 7v10l10 5 10-5V7L12 2z" fill="rgba(255,255,255,0.2)" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinejoin="round"/>
              <path d="M2 7l10 5 10-5" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5"/>
              <path d="M12 12v10" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5"/>
            </svg>
            <span style={styles.logoText}>Underleaf</span>
          </div>
        </div>
        <div style={styles.headerRight}>
          <span style={styles.userEmail}>{user?.email}</span>
          <div style={styles.userAvatar} title={user?.email}>{userInitial}</div>
          <button style={styles.logoutBtn} onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {/* Main */}
      <main style={styles.main}>
        <div style={styles.toolbar}>
          <div>
            <h2 style={styles.pageTitle}>My Projects</h2>
            <p style={styles.pageSubtitle}>
              {isLoading
                ? 'Loading...'
                : `${projects?.length ?? 0} project${(projects?.length ?? 0) !== 1 ? 's' : ''}`}
            </p>
          </div>
          <button
            className="primary"
            style={styles.newBtn}
            onClick={() => setShowCreateModal(true)}
          >
            <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
            New Project
          </button>
        </div>

        {isLoading ? (
          <div style={styles.grid}>
            {[1, 2, 3].map((i) => (
              <div key={i} className="skeleton" style={styles.skeletonCard} />
            ))}
          </div>
        ) : projects?.length === 0 ? (
          <div style={styles.empty} className="animate-fade-in">
            <div style={styles.emptyIcon}>
              <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <path d="M14 2v6h6" stroke="currentColor" strokeWidth="1.5"/>
                <path d="M12 12v4M10 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
            <p style={styles.emptyTitle}>No projects yet</p>
            <p style={styles.emptyText}>Create your first LaTeX project to get started.</p>
            <button className="primary" style={{ marginTop: '20px' }} onClick={() => setShowCreateModal(true)}>
              + Create project
            </button>
          </div>
        ) : (
          <div style={styles.grid}>
            {projects?.map((project, idx) => (
              <ProjectCard
                key={project.id}
                project={project}
                idx={idx}
                renamingId={renamingId}
                renameTitle={renameTitle}
                renameInputRef={renameInputRef}
                onRenameChange={setRenameTitle}
                onRenameSubmit={submitRename}
                onRenameCancel={() => setRenamingId(null)}
                onStartRename={startRename}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </main>

      {/* Create modal */}
      {showCreateModal && (
        <div style={styles.modalOverlay} onClick={() => setShowCreateModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()} className="animate-fade-in-scale">
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>New Project</h3>
              <button
                style={styles.modalClose}
                onClick={() => setShowCreateModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreate} style={styles.modalBody}>
              <label style={styles.label}>Project title</label>
              <input
                type="text"
                placeholder="My LaTeX Document"
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                autoFocus
                required
              />
              <div style={styles.modalFooter}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary"
                  disabled={createProject.isPending}
                >
                  {createProject.isPending ? 'Creating...' : 'Create project'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectCard({
  project,
  idx,
  renamingId,
  renameTitle,
  renameInputRef,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onStartRename,
  onDelete,
}: {
  project: { id: string; title: string; visibility: string; updated_at: string }
  idx: number
  renamingId: string | null
  renameTitle: string
  renameInputRef: React.RefObject<HTMLInputElement>
  onRenameChange: (v: string) => void
  onRenameSubmit: (id: string) => void
  onRenameCancel: () => void
  onStartRename: (e: React.MouseEvent, id: string, title: string) => void
  onDelete: (e: React.MouseEvent, id: string, title: string) => void
}) {
  const isRenaming = renamingId === project.id
  const isPrivate = project.visibility === 'private'

  return (
    <Link
      to={`/project/${project.id}`}
      style={{
        ...cardStyles.card,
        animationDelay: `${idx * 50}ms`,
      }}
      className="animate-fade-in project-card"
    >
      {/* Colored accent bar */}
      <div style={{ ...cardStyles.accentBar, background: cardGradients[idx % cardGradients.length] }} />

      <div style={cardStyles.body}>
        <div style={cardStyles.titleRow}>
          {isRenaming ? (
            <input
              ref={renameInputRef}
              value={renameTitle}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onRenameSubmit(project.id)
                if (e.key === 'Escape') onRenameCancel()
              }}
              onBlur={() => onRenameSubmit(project.id)}
              onClick={(e) => e.preventDefault()}
              style={cardStyles.renameInput}
            />
          ) : (
            <h3 style={cardStyles.title}>{project.title}</h3>
          )}
          <div style={cardStyles.actions} className="card-actions">
            <button
              style={cardStyles.actionBtn}
              onClick={(e) => onStartRename(e, project.id, project.title)}
              title="Rename"
            >
              ✎
            </button>
            <button
              style={{ ...cardStyles.actionBtn, ...cardStyles.deleteBtn }}
              onClick={(e) => onDelete(e, project.id, project.title)}
              title="Delete"
            >
              ×
            </button>
          </div>
        </div>

        <div style={cardStyles.meta}>
          <span className={`badge ${isPrivate ? 'badge-gray' : 'badge-green'}`}>
            {isPrivate ? '🔒 Private' : '🌐 Public'}
          </span>
          <span style={cardStyles.date}>
            {new Date(project.updated_at).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      </div>
    </Link>
  )
}

const cardGradients = [
  'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  'linear-gradient(135deg, #1a7f4b 0%, #22a262 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
  'linear-gradient(135deg, #ec4899 0%, #8b5cf6 100%)',
  'linear-gradient(135deg, #14b8a6 0%, #0ea5e9 100%)',
]

const cardStyles: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-sm)',
    border: '1px solid var(--color-border)',
    textDecoration: 'none',
    color: 'inherit',
    overflow: 'hidden',
    transition: 'transform 0.18s ease, box-shadow 0.18s ease',
    cursor: 'pointer',
  },
  accentBar: {
    height: '4px',
    width: '100%',
    flexShrink: 0,
  },
  body: {
    padding: '18px 20px',
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
  },
  title: {
    fontSize: '15px',
    fontWeight: 600,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    color: 'var(--color-text)',
  },
  actions: {
    display: 'flex',
    gap: '2px',
    flexShrink: 0,
    opacity: 0,
    transition: 'opacity 0.15s ease',
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '3px 6px',
    fontSize: '15px',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--color-text-muted)',
    lineHeight: 1,
    transition: 'background var(--transition-fast), color var(--transition-fast)',
  },
  deleteBtn: {
    fontSize: '18px',
    color: 'var(--color-error)',
  },
  renameInput: {
    flex: 1,
    fontSize: '15px',
    fontWeight: 600,
    padding: '2px 4px',
    border: '1.5px solid var(--color-border-focus)',
    borderRadius: 'var(--radius-sm)',
    outline: 'none',
    minWidth: 0,
  },
  meta: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
  },
  date: {
    fontSize: '12px',
    color: 'var(--color-text-light)',
  },
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    backgroundColor: 'var(--color-background)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '0 28px',
    height: '58px',
    backgroundColor: 'var(--color-header-bg)',
    borderBottom: '1px solid var(--color-header-border)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 100,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
  },
  logoWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    cursor: 'default',
  },
  logoText: {
    fontSize: '18px',
    fontWeight: 700,
    color: 'white',
    letterSpacing: '-0.02em',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  userEmail: {
    fontSize: '13px',
    color: 'rgba(255,255,255,0.6)',
  },
  userAvatar: {
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--color-brand-light), var(--color-brand))',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '12px',
    fontWeight: 700,
    color: 'white',
    cursor: 'default',
    flexShrink: 0,
  },
  logoutBtn: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.8)',
    padding: '6px 12px',
    borderRadius: 'var(--radius-md)',
    fontSize: '13px',
    cursor: 'pointer',
    transition: 'background var(--transition-fast)',
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '32px 24px',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: '28px',
  },
  pageTitle: {
    fontSize: '22px',
    fontWeight: 700,
    color: 'var(--color-text)',
    letterSpacing: '-0.02em',
  },
  pageSubtitle: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    marginTop: '2px',
  },
  newBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '9px 18px',
    fontSize: '13px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '18px',
  },
  skeletonCard: {
    height: '108px',
    borderRadius: 'var(--radius-lg)',
  },
  empty: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '80px 20px',
    color: 'var(--color-text-muted)',
    gap: '8px',
  },
  emptyIcon: {
    color: 'var(--color-border)',
    marginBottom: '8px',
  },
  emptyTitle: {
    fontSize: '17px',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  emptyText: {
    fontSize: '14px',
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-xl)',
    width: '100%',
    maxWidth: '420px',
    boxShadow: 'var(--shadow-xl)',
    overflow: 'hidden',
  },
  modalHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '20px 24px 0 24px',
  },
  modalTitle: {
    fontSize: '17px',
    fontWeight: 700,
  },
  modalClose: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    color: 'var(--color-text-muted)',
    padding: '4px 6px',
    borderRadius: 'var(--radius-sm)',
  },
  modalBody: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px',
    padding: '20px 24px 24px 24px',
  },
  label: {
    fontSize: '13px',
    fontWeight: 500,
    color: 'var(--color-text)',
  },
  modalFooter: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '10px',
    paddingTop: '4px',
  },
}
