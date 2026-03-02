import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { projectsApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import toast from 'react-hot-toast'

// ── Email verification banner ──────────────────────────────────────────────
// Shown at the top of the page whenever the authenticated user has not yet
// confirmed their email address. Dismissible for the current session only.

function EmailVerificationBanner({ email }: { email: string }) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div style={bannerStyles.banner}>
      <span style={bannerStyles.icon}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={{ verticalAlign: 'middle' }}>
          <rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <path d="M2 8l10 7 10-7" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </span>
      <span style={bannerStyles.text}>
        Please verify your email address. We sent a link to{' '}
        <strong>{email}</strong>. Check your inbox (and spam folder).
      </span>
      <button
        style={bannerStyles.dismiss}
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
    </div>
  )
}

const bannerStyles: Record<string, React.CSSProperties> = {
  banner: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#fefce8',
    borderBottom: '1px solid #fde68a',
    color: '#92400e',
    padding: '10px 28px',
    fontSize: '13px',
    lineHeight: 1.5,
  },
  icon: {
    flexShrink: 0,
    color: '#d97706',
  },
  text: {
    flex: 1,
  },
  dismiss: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '20px',
    color: '#92400e',
    lineHeight: 1,
    padding: '0 4px',
    flexShrink: 0,
    opacity: 0.65,
  },
}

// ── ZIP export helper ──────────────────────────────────────────────────────

async function downloadProjectZip(projectId: string, title: string) {
  try {
    const res = await projectsApi.exportZip(projectId)
    const blob = new Blob([res.data], { type: 'application/zip' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${title}.zip`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    toast.error('Failed to export ZIP')
  }
}

function relativeTime(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const secs = Math.floor(diff / 1000)
  const mins = Math.floor(secs / 60)
  const hours = Math.floor(mins / 60)
  const days = Math.floor(hours / 24)
  if (secs < 60) return 'just now'
  if (mins < 60) return `${mins} minute${mins !== 1 ? 's' : ''} ago`
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  if (days < 7) return `${days} day${days !== 1 ? 's' : ''} ago`
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ── Project templates ─────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'article',
    name: 'Academic Article',
    description: 'Standard article with abstract, sections, and bibliography',
    files: {
      'main.tex': `\\documentclass[12pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amssymb}
\\usepackage{graphicx}
\\usepackage[colorlinks=true,linkcolor=blue]{hyperref}
\\usepackage{natbib}

\\title{Your Title Here}
\\author{Your Name}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
Write your abstract here.
\\end{abstract}

\\section{Introduction}
\\label{sec:intro}

Your introduction goes here.

\\section{Methods}
\\label{sec:methods}

Describe your methods.

\\section{Results}

Present your results.

\\section{Conclusion}

Conclude your work.

\\bibliographystyle{plainnat}
\\bibliography{references}

\\end{document}
`,
      'references.bib': `@article{example2024,
  author  = {Author, A. and Author, B.},
  title   = {An Example Paper},
  journal = {Journal of Examples},
  year    = {2024},
  volume  = {1},
  pages   = {1--10},
}
`,
    },
  },
  {
    id: 'beamer',
    name: 'Beamer Presentation',
    description: 'Slide deck with title page, outline, and content sections',
    files: {
      'main.tex': `\\documentclass{beamer}
\\usetheme{Madrid}
\\usepackage[utf8]{inputenc}

\\title{Presentation Title}
\\author{Your Name}
\\institute{Your Institution}
\\date{\\today}

\\begin{document}

\\begin{frame}
  \\titlepage
\\end{frame}

\\begin{frame}{Outline}
  \\tableofcontents
\\end{frame}

\\section{Introduction}
\\begin{frame}{Introduction}
  \\begin{itemize}
    \\item First point
    \\item Second point
  \\end{itemize}
\\end{frame}

\\section{Conclusion}
\\begin{frame}{Conclusion}
  \\begin{itemize}
    \\item Summary point 1
    \\item Summary point 2
  \\end{itemize}
\\end{frame}

\\end{document}
`,
    },
  },
  {
    id: 'report',
    name: 'Technical Report',
    description: 'Multi-chapter report with table of contents and appendix',
    files: {
      'main.tex': `\\documentclass[12pt,a4paper]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{graphicx}
\\usepackage[margin=2.5cm]{geometry}
\\usepackage{hyperref}

\\title{Technical Report Title}
\\author{Author Name}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents
\\newpage

\\chapter{Introduction}

This is the introduction chapter.

\\chapter{Background}

Background and related work.

\\chapter{Approach}

Describe your approach.

\\chapter{Evaluation}

Results and evaluation.

\\chapter{Conclusion}

Summary and future work.

\\appendix
\\chapter{Additional Details}

Appendix content.

\\end{document}
`,
    },
  },
  {
    id: 'cv',
    name: 'Curriculum Vitae',
    description: 'Clean CV / résumé with education, experience, and skills',
    files: {
      'main.tex': `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage[margin=2cm]{geometry}
\\usepackage{enumitem}
\\usepackage{titlesec}
\\usepackage{hyperref}
\\usepackage{parskip}

\\titleformat{\\section}{\\large\\bfseries}{}{0em}{}[\\titlerule]
\\setlist[itemize]{leftmargin=1.5em,topsep=2pt,itemsep=1pt}

\\begin{document}

{\\LARGE \\textbf{Your Name}}\\\\[4pt]
your.email@example.com \\quad | \\quad +1 (555) 123-4567 \\quad | \\quad City, Country

\\section{Education}
\\textbf{Degree, Major} \\hfill 2020--2024\\\\
University Name, City

\\section{Experience}
\\textbf{Job Title} \\hfill Jan 2024--Present\\\\
Company Name, City
\\begin{itemize}
  \\item Key accomplishment
  \\item Another achievement
\\end{itemize}

\\section{Skills}
\\begin{itemize}
  \\item \\textbf{Programming:} Python, JavaScript, C++
  \\item \\textbf{Tools:} Git, Docker, LaTeX
\\end{itemize}

\\end{document}
`,
    },
  },
] as const

export default function DashboardPage() {
  const [newProjectTitle, setNewProjectTitle] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showTemplateModal, setShowTemplateModal] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameTitle, setRenameTitle] = useState('')
  const [search, setSearch] = useState('')
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

  const createFromTemplate = async (template: typeof TEMPLATES[number]) => {
    setShowTemplateModal(false)
    try {
      const res = await projectsApi.create(template.name)
      const projectId = res.data.id
      for (const [path, content] of Object.entries(template.files)) {
        await projectsApi.createFile(projectId, path, content)
      }
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      toast.success(`"${template.name}" created from template`)
      navigate(`/project/${projectId}`)
    } catch {
      toast.error('Failed to create project from template')
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
          <Link to="/profile" style={styles.profileLink} title="Profile & Settings">
            Profile
          </Link>
          <div style={styles.userAvatar} title={user?.email}>{userInitial}</div>
          <button style={styles.logoutBtn} onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      {/* Email verification banner — shown until dismissed or user verifies */}
      {user && !user.email_verified && (
        <EmailVerificationBanner email={user.email} />
      )}

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
          <div style={{ display: 'flex', gap: '10px' }}>
            <button
              style={styles.templateBtn}
              onClick={() => setShowTemplateModal(true)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 5, verticalAlign: 'middle' }}>
                <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
                <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
              </svg>
              From template
            </button>
            <button
              className="primary"
              style={styles.newBtn}
              onClick={() => setShowCreateModal(true)}
            >
              <span style={{ fontSize: '16px', lineHeight: 1 }}>+</span>
              New Project
            </button>
          </div>
        </div>

        {/* Search bar */}
        {!isLoading && (projects?.length ?? 0) > 0 && (
          <div style={styles.searchRow}>
            <div style={styles.searchWrap}>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                style={styles.searchIcon}
              >
                <circle cx="11" cy="11" r="8"/>
                <line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input
                type="search"
                placeholder="Search projects…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={styles.searchInput}
              />
            </div>
          </div>
        )}

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
        ) : (() => {
          const filtered = (projects ?? []).filter((p) =>
            p.title.toLowerCase().includes(search.toLowerCase())
          )
          if (filtered.length === 0 && search) {
            return (
              <div style={styles.empty} className="animate-fade-in">
                <p style={styles.emptyTitle}>No projects match your search.</p>
                <p style={styles.emptyText}>Try a different search term.</p>
              </div>
            )
          }
          return (
            <div style={styles.grid}>
              {filtered.map((project, idx) => (
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
          )
        })()}
      </main>

      {/* Create modal */}
      {/* Template picker modal */}
      {showTemplateModal && (
        <div style={styles.modalOverlay} onClick={() => setShowTemplateModal(false)}>
          <div
            style={{ ...styles.modal, maxWidth: '580px' }}
            onClick={(e) => e.stopPropagation()}
            className="animate-fade-in-scale"
          >
            <div style={styles.modalHeader}>
              <h3 style={styles.modalTitle}>Choose a template</h3>
              <button style={styles.modalClose} onClick={() => setShowTemplateModal(false)}>✕</button>
            </div>
            <div style={{ padding: '20px 24px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  onClick={() => createFromTemplate(tpl)}
                  style={{
                    textAlign: 'left',
                    background: 'var(--color-bg)',
                    border: '1.5px solid var(--color-border)',
                    borderRadius: 'var(--radius-lg)',
                    padding: '16px',
                    cursor: 'pointer',
                    transition: 'border-color var(--transition-fast), box-shadow var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-brand)'
                    e.currentTarget.style.boxShadow = 'var(--shadow-brand)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-border)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '6px', color: 'var(--color-text)' }}>
                    {tpl.name}
                  </div>
                  <div style={{ fontSize: '12px', color: 'var(--color-text-muted)', lineHeight: 1.4 }}>
                    {tpl.description}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

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
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); downloadProjectZip(project.id, project.title) }}
              title="Download as ZIP"
            >
              ↓
            </button>
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
          <span style={cardStyles.date} title={new Date(project.updated_at).toLocaleString()}>
            {relativeTime(project.updated_at)}
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
  profileLink: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.8)',
    padding: '6px 12px',
    borderRadius: 'var(--radius-md)',
    fontSize: '13px',
    textDecoration: 'none',
    transition: 'background var(--transition-fast)',
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
  templateBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '9px 16px',
    fontSize: '13px',
    background: 'transparent',
    border: '1.5px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text)',
    cursor: 'pointer',
  },
  searchRow: {
    marginBottom: '20px',
  },
  searchWrap: {
    position: 'relative' as const,
    display: 'inline-flex',
    alignItems: 'center',
    width: '100%',
    maxWidth: '320px',
  },
  searchIcon: {
    position: 'absolute' as const,
    left: '10px',
    color: 'var(--color-text-light)',
    pointerEvents: 'none' as const,
    flexShrink: 0,
  },
  searchInput: {
    width: '100%',
    paddingLeft: '32px',
    paddingRight: '12px',
    paddingTop: '7px',
    paddingBottom: '7px',
    fontSize: '13px',
    border: '1.5px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface)',
    color: 'var(--color-text)',
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
