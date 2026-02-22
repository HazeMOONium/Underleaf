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
    onError: () => {
      toast.error('Failed to create project')
    },
  })

  const deleteProject = useMutation({
    mutationFn: (id: string) => projectsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      toast.success('Project deleted')
    },
    onError: () => {
      toast.error('Failed to delete project')
    },
  })

  const renameProject = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      projectsApi.update(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setRenamingId(null)
      toast.success('Project renamed')
    },
    onError: () => {
      toast.error('Failed to rename project')
    },
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

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.logo}>Underleaf</h1>
        </div>
        <div style={styles.headerRight}>
          <span>{user?.email}</span>
          <button onClick={logout} className="secondary">
            Logout
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.toolbar}>
          <h2>My Projects</h2>
          <button className="primary" onClick={() => setShowCreateModal(true)}>
            + New Project
          </button>
        </div>

        {isLoading ? (
          <p>Loading...</p>
        ) : projects?.length === 0 ? (
          <div style={styles.empty}>
            <p>No projects yet. Create your first project!</p>
          </div>
        ) : (
          <div style={styles.grid}>
            {projects?.map((project) => (
              <Link
                key={project.id}
                to={`/project/${project.id}`}
                style={styles.card}
              >
                <div style={styles.cardHeader}>
                  {renamingId === project.id ? (
                    <input
                      ref={renameInputRef}
                      value={renameTitle}
                      onChange={(e) => setRenameTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename(project.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      onBlur={() => submitRename(project.id)}
                      onClick={(e) => e.preventDefault()}
                      style={styles.renameInput}
                    />
                  ) : (
                    <h3 style={styles.cardTitle}>{project.title}</h3>
                  )}
                  <div style={styles.cardActions}>
                    <button
                      style={styles.actionBtn}
                      onClick={(e) => startRename(e, project.id, project.title)}
                      title="Rename"
                    >
                      &#9998;
                    </button>
                    <button
                      style={{ ...styles.actionBtn, ...styles.deleteBtn }}
                      onClick={(e) => handleDelete(e, project.id, project.title)}
                      title="Delete"
                    >
                      &times;
                    </button>
                  </div>
                </div>
                <p>
                  {project.visibility === 'private' ? 'Private' : 'Public'}
                </p>
                <p style={styles.date}>
                  {new Date(project.updated_at).toLocaleDateString()}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>

      {showCreateModal && (
        <div style={styles.modal}>
          <div style={styles.modalContent}>
            <h3>Create New Project</h3>
            <form onSubmit={handleCreate}>
              <input
                type="text"
                placeholder="Project title"
                value={newProjectTitle}
                onChange={(e) => setNewProjectTitle(e.target.value)}
                autoFocus
                required
              />
              <div style={styles.modalActions}>
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
                  {createProject.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
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
    padding: '16px 24px',
    backgroundColor: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '24px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  logo: {
    fontSize: '20px',
    fontWeight: 600,
  },
  main: {
    maxWidth: '1200px',
    margin: '0 auto',
    padding: '24px',
  },
  toolbar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
    gap: '20px',
  },
  card: {
    display: 'block',
    padding: '20px',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    boxShadow: 'var(--shadow-sm)',
    textDecoration: 'none',
    color: 'inherit',
    transition: 'transform 0.2s, box-shadow 0.2s',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '8px',
  },
  cardTitle: {
    margin: 0,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  cardActions: {
    display: 'flex',
    gap: '4px',
    flexShrink: 0,
  },
  actionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '2px 6px',
    fontSize: '16px',
    borderRadius: '4px',
    color: 'var(--color-text-muted)',
    lineHeight: 1,
  },
  deleteBtn: {
    fontSize: '20px',
  },
  renameInput: {
    flex: 1,
    fontSize: '16px',
    fontWeight: 600,
    padding: '2px 4px',
    border: '1px solid var(--color-primary)',
    borderRadius: '4px',
    outline: 'none',
  },
  date: {
    fontSize: '12px',
    color: 'var(--color-text-muted)',
    marginTop: '8px',
  },
  empty: {
    textAlign: 'center',
    padding: '60px 20px',
    color: 'var(--color-text-muted)',
  },
  modal: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: 'var(--color-surface)',
    padding: '24px',
    borderRadius: 'var(--radius-md)',
    width: '100%',
    maxWidth: '400px',
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  modalActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '12px',
    marginTop: '8px',
  },
}
