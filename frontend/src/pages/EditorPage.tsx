import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Editor from '@monaco-editor/react'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { projectsApi, compileApi } from '../services/api'
import toast from 'react-hot-toast'

const WS_URL =
  import.meta.env.VITE_COLLAB_WS_URL ||
  `ws://${window.location.hostname}:${window.location.port}/ws-collab`

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [currentFile, setCurrentFile] = useState('main.tex')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [previewWidth, setPreviewWidth] = useState(400)
  const [showNewFileModal, setShowNewFileModal] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [compileError, setCompileError] = useState<{
    message: string
    logs: string
  } | null>(null)
  const queryClient = useQueryClient()
  const mountedRef = useRef(true)
  const ytextRef = useRef<Y.Text | null>(null)
  const isDraggingRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
    }
  }, [])

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!).then((res) => res.data),
    enabled: !!projectId,
  })

  const { data: files } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => projectsApi.listFiles(projectId!).then((res) => res.data),
    enabled: !!projectId,
  })

  // Bug 1 fix: Load file content from backend when currentFile changes
  useEffect(() => {
    if (!projectId || !currentFile) return
    let cancelled = false

    projectsApi
      .getFile(projectId, currentFile)
      .then((res) => {
        if (cancelled) return
        const fileContent = typeof res.data === 'string' ? res.data : (res.data as any)?.content ?? ''
        setContent(fileContent)
        // Sync to Yjs doc if connected
        if (ytextRef.current) {
          const ytext = ytextRef.current
          if (ytext.toString() !== fileContent) {
            ytext.doc?.transact(() => {
              ytext.delete(0, ytext.length)
              ytext.insert(0, fileContent)
            })
          }
        }
      })
      .catch(() => {
        // File might not exist yet (e.g. new project), start with empty content
        if (!cancelled) setContent('')
      })

    return () => {
      cancelled = true
    }
  }, [projectId, currentFile, files])

  const saveFile = useMutation({
    mutationFn: () => projectsApi.createFile(projectId!, currentFile, content),
    onMutate: () => setSaving(true),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['files', projectId] })
      toast.success('Saved')
    },
    onError: () => toast.error('Save failed'),
    onSettled: () => setSaving(false),
  })

  const compile = useMutation({
    mutationFn: () => compileApi.createJob(projectId!),
    onMutate: () => {
      setCompiling(true)
      setCompileError(null)
    },
    onSuccess: (res) => {
      toast.success('Compile job started')
      pollJobStatus(res.data.id)
    },
    onError: () => {
      toast.error('Compile failed')
      setCompiling(false)
    },
  })

  const pollJobStatus = (jobId: string) => {
    const interval = setInterval(async () => {
      if (!mountedRef.current) {
        clearInterval(interval)
        return
      }
      try {
        const { data } = await compileApi.getJobStatus(jobId)
        if (data.status === 'completed') {
          clearInterval(interval)
          setCompiling(false)
          setCompileError(null)
          toast.success('Compilation complete')
          try {
            const res = await compileApi.getArtifact(jobId)
            const blob = new Blob([res.data], { type: 'application/pdf' })
            const url = URL.createObjectURL(blob)
            setPdfUrl((prev) => {
              if (prev) URL.revokeObjectURL(prev)
              return url
            })
          } catch {
            toast.error('Failed to load PDF preview')
          }
        } else if (data.status === 'failed') {
          clearInterval(interval)
          setCompiling(false)
          // Bug 5 fix: Fetch logs and show detailed error in preview
          const errorMsg = data.error_message || 'Compilation failed'
          let logs = ''
          try {
            const logRes = await compileApi.getLogs(jobId)
            logs = typeof logRes.data === 'string' ? logRes.data : JSON.stringify(logRes.data, null, 2)
          } catch {
            logs = 'Could not retrieve compilation logs.'
          }
          setCompileError({ message: errorMsg, logs })
          setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return null
          })
        }
      } catch {
        clearInterval(interval)
        setCompiling(false)
      }
    }, 2000)
  }

  const handleEditorChange = (value: string | undefined) => {
    setContent(value || '')
  }

  useEffect(() => {
    if (!projectId) return

    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(WS_URL, projectId, ydoc)

    const ytext = ydoc.getText('content')
    ytextRef.current = ytext

    ytext.observe(() => {
      if (mountedRef.current) {
        setContent(ytext.toString())
      }
    })

    return () => {
      ytextRef.current = null
      provider.destroy()
      ydoc.destroy()
    }
  }, [projectId])

  // Bug 2 fix: Draggable splitter
  const handleSplitterMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isDraggingRef.current = true

    const startX = e.clientX
    const startWidth = previewWidth

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return
      const delta = startX - moveEvent.clientX
      const newWidth = Math.max(200, Math.min(800, startWidth + delta))
      setPreviewWidth(newWidth)
    }

    const onMouseUp = () => {
      isDraggingRef.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [previewWidth])

  // Bug 3 fix: Create file handler
  const handleCreateFile = async () => {
    const trimmed = newFileName.trim()
    if (!trimmed || !projectId) return
    try {
      await projectsApi.createFile(projectId, trimmed, '')
      queryClient.invalidateQueries({ queryKey: ['files', projectId] })
      setCurrentFile(trimmed)
      setContent('')
      setShowNewFileModal(false)
      setNewFileName('')
      toast.success(`Created ${trimmed}`)
    } catch {
      toast.error('Failed to create file')
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to="/" style={styles.backLink}>
            &larr; Back
          </Link>
          <h2>{project?.title || 'Loading...'}</h2>
        </div>
        <div style={styles.headerRight}>
          <button
            className="secondary"
            onClick={() => saveFile.mutate()}
            disabled={saving}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button
            className="primary"
            onClick={() => compile.mutate()}
            disabled={compiling}
          >
            {compiling ? 'Compiling...' : 'Compile'}
          </button>
        </div>
      </header>

      <div style={styles.main}>
        <aside style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <h3>Files</h3>
            <button
              className="secondary"
              style={styles.iconBtn}
              onClick={() => setShowNewFileModal(true)}
            >
              +
            </button>
          </div>
          <ul style={styles.fileList}>
            <li
              style={{
                ...styles.fileItem,
                ...(currentFile === 'main.tex' ? styles.fileItemActive : {}),
              }}
              onClick={() => setCurrentFile('main.tex')}
            >
              main.tex
            </li>
            {files?.filter((file) => file.path !== 'main.tex').map((file) => (
              <li
                key={file.id}
                style={{
                  ...styles.fileItem,
                  ...(currentFile === file.path ? styles.fileItemActive : {}),
                }}
                onClick={() => setCurrentFile(file.path)}
              >
                {file.path}
              </li>
            ))}
          </ul>
        </aside>

        <div style={styles.editor}>
          <Editor
            height="100%"
            defaultLanguage="latex"
            theme="vs-light"
            value={content}
            onChange={handleEditorChange}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              lineNumbers: 'on',
              glyphMargin: true,
              folding: true,
            }}
          />
        </div>

        {/* Bug 2 fix: Draggable splitter handle */}
        <div
          style={styles.splitter}
          onMouseDown={handleSplitterMouseDown}
        />

        <aside style={{ ...styles.preview, width: `${previewWidth}px` }}>
          <div style={styles.previewHeader}>
            <h3>PDF Preview</h3>
          </div>
          <div style={styles.previewContent}>
            {compiling ? (
              <p style={styles.previewPlaceholder}>Compiling...</p>
            ) : compileError ? (
              <div style={styles.errorContainer}>
                <div style={styles.errorMessage}>{compileError.message}</div>
                <pre style={styles.errorLogs}>{compileError.logs}</pre>
              </div>
            ) : pdfUrl ? (
              <iframe
                src={pdfUrl}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="PDF Preview"
              />
            ) : (
              <p style={styles.previewPlaceholder}>
                Compile to see PDF preview
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* Bug 3 fix: New file modal */}
      {showNewFileModal && (
        <div style={styles.modalOverlay} onClick={() => setShowNewFileModal(false)}>
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0' }}>New File</h3>
            <input
              type="text"
              placeholder="filename.tex"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFile()
              }}
              style={styles.modalInput}
              autoFocus
            />
            <div style={styles.modalButtons}>
              <button
                className="secondary"
                onClick={() => {
                  setShowNewFileModal(false)
                  setNewFileName('')
                }}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={handleCreateFile}
                disabled={!newFileName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    height: '100vh',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: 'var(--color-background)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 20px',
    backgroundColor: 'var(--color-surface)',
    borderBottom: '1px solid var(--color-border)',
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  backLink: {
    fontSize: '14px',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  sidebar: {
    width: '220px',
    backgroundColor: 'var(--color-surface)',
    borderRight: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
  },
  sidebarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border)',
  },
  iconBtn: {
    padding: '4px 8px',
    fontSize: '12px',
  },
  fileList: {
    listStyle: 'none',
    padding: '8px 0',
    margin: 0,
    overflow: 'auto',
  },
  fileItem: {
    padding: '8px 16px',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'background-color 0.15s',
  },
  fileItemActive: {
    backgroundColor: 'var(--color-secondary)',
    color: 'white',
  },
  editor: {
    flex: 1,
    overflow: 'hidden',
  },
  splitter: {
    width: '6px',
    cursor: 'col-resize',
    backgroundColor: 'var(--color-border)',
    flexShrink: 0,
    transition: 'background-color 0.15s',
  },
  preview: {
    backgroundColor: 'var(--color-surface)',
    borderLeft: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
  },
  previewHeader: {
    padding: '12px 16px',
    borderBottom: '1px solid var(--color-border)',
  },
  previewContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  previewPlaceholder: {
    color: 'var(--color-text-muted)',
    textAlign: 'center',
    padding: '20px',
    alignSelf: 'center',
    marginTop: 'auto',
    marginBottom: 'auto',
  },
  errorContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  errorMessage: {
    padding: '12px 16px',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    fontWeight: 600,
    fontSize: '14px',
    borderBottom: '1px solid #fecaca',
    flexShrink: 0,
  },
  errorLogs: {
    flex: 1,
    margin: 0,
    padding: '12px 16px',
    fontSize: '12px',
    lineHeight: '1.5',
    overflow: 'auto',
    backgroundColor: '#1e1e1e',
    color: '#d4d4d4',
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  modalOverlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: '8px',
    padding: '24px',
    width: '400px',
    maxWidth: '90vw',
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.15)',
  },
  modalInput: {
    width: '100%',
    padding: '8px 12px',
    fontSize: '14px',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    boxSizing: 'border-box' as const,
    marginBottom: '16px',
  },
  modalButtons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
}
