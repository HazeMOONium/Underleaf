import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { projectsApi, compileApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import FileTree from '../components/FileTree'
import DocumentOutline from '../components/DocumentOutline'
import { registerLatexLanguage } from '../editor/latexLanguage'
import { userColor } from '../utils/userColor'
import toast from 'react-hot-toast'

const WS_URL =
  import.meta.env.VITE_COLLAB_WS_URL ||
  `ws://${window.location.hostname}:${window.location.port}/ws-collab`

interface AwarenessUser {
  name: string
  color: string
}

export default function EditorPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuthStore()
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
  const [connectedUsers, setConnectedUsers] = useState<AwarenessUser[]>([])
  const queryClient = useQueryClient()
  const mountedRef = useRef(true)
  const ytextRef = useRef<Y.Text | null>(null)
  const isDraggingRef = useRef(false)
  const saveRef = useRef<() => void>(() => {})
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)

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

  // Load file content from backend when currentFile changes
  useEffect(() => {
    if (!projectId || !currentFile) return
    let cancelled = false

    projectsApi
      .getFile(projectId, currentFile)
      .then((res) => {
        if (cancelled) return
        const fileContent =
          typeof res.data === 'string'
            ? res.data
            : ((res.data as any)?.content ?? '')
        setContent(fileContent)
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

  // Keep saveRef in sync for Ctrl+S
  saveRef.current = () => saveFile.mutate()

  // Ctrl+S keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveRef.current()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const deleteFileMutation = useMutation({
    mutationFn: (path: string) => projectsApi.deleteFile(projectId!, path),
    onSuccess: (_, deletedPath) => {
      queryClient.invalidateQueries({ queryKey: ['files', projectId] })
      toast.success('File deleted')
      if (currentFile === deletedPath) {
        setCurrentFile('main.tex')
      }
    },
    onError: () => toast.error('Failed to delete file'),
  })

  const renameFileMutation = useMutation({
    mutationFn: ({ oldPath, newPath }: { oldPath: string; newPath: string }) =>
      projectsApi.renameFile(projectId!, oldPath, newPath),
    onSuccess: (_, { oldPath, newPath }) => {
      queryClient.invalidateQueries({ queryKey: ['files', projectId] })
      toast.success('File renamed')
      if (currentFile === oldPath) {
        setCurrentFile(newPath)
      }
    },
    onError: () => toast.error('Failed to rename file'),
  })

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = currentFile.split('/').pop() || 'file.tex'
    a.click()
    URL.revokeObjectURL(url)
  }

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
          const errorMsg = data.error_message || 'Compilation failed'
          let logs = ''
          try {
            const logRes = await compileApi.getLogs(jobId)
            logs =
              typeof logRes.data === 'string'
                ? logRes.data
                : JSON.stringify(logRes.data, null, 2)
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

  // Yjs collaboration + presence
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

    // Set local awareness
    if (user) {
      provider.awareness.setLocalStateField('user', {
        name: user.email,
        color: userColor(user.id),
      })
    }

    // Track connected users
    const updateUsers = () => {
      const states = provider.awareness.getStates()
      const users: AwarenessUser[] = []
      states.forEach((state, clientId) => {
        if (clientId !== provider.awareness.clientID && state.user) {
          users.push(state.user)
        }
      })
      if (mountedRef.current) setConnectedUsers(users)
    }

    provider.awareness.on('change', updateUsers)
    updateUsers()

    return () => {
      ytextRef.current = null
      provider.awareness.off('change', updateUsers)
      provider.destroy()
      ydoc.destroy()
      setConnectedUsers([])
    }
  }, [projectId, user])

  // Draggable splitter
  const handleSplitterMouseDown = useCallback(
    (e: React.MouseEvent) => {
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
    },
    [previewWidth],
  )

  // Create file handler
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

  const handleNewFileInFolder = (folderPath: string) => {
    setNewFileName(`${folderPath}/`)
    setShowNewFileModal(true)
  }

  // Monaco setup
  const handleEditorBeforeMount: BeforeMount = (monaco) => {
    registerLatexLanguage(monaco)
  }

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor
  }

  const handleOutlineNavigate = (line: number) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line)
      editorRef.current.setPosition({ lineNumber: line, column: 1 })
      editorRef.current.focus()
    }
  }

  // Memoized outline
  const outlineContent = useMemo(() => content, [content])

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to="/" style={styles.backLink}>
            &larr; Back
          </Link>
          <h2>{project?.title || 'Loading...'}</h2>
          {connectedUsers.length > 0 && (
            <div style={styles.presenceBar}>
              {connectedUsers.map((u, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.presenceDot,
                    backgroundColor: u.color,
                  }}
                  title={u.name}
                >
                  {u.name[0].toUpperCase()}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={styles.headerRight}>
          <button className="secondary" onClick={handleDownload}>
            Download
          </button>
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
          <div style={styles.sidebarContent}>
            {files && (
              <FileTree
                files={files}
                currentFile={currentFile}
                onSelectFile={setCurrentFile}
                onDeleteFile={(path) => deleteFileMutation.mutate(path)}
                onRenameFile={(oldPath, newPath) =>
                  renameFileMutation.mutate({ oldPath, newPath })
                }
                onNewFileInFolder={handleNewFileInFolder}
              />
            )}
            <DocumentOutline
              content={outlineContent}
              onNavigate={handleOutlineNavigate}
            />
          </div>
        </aside>

        <div style={styles.editor}>
          <Editor
            height="100%"
            defaultLanguage="latex"
            theme="vs-light"
            value={content}
            onChange={handleEditorChange}
            beforeMount={handleEditorBeforeMount}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              wordWrap: 'on',
              lineNumbers: 'on',
              glyphMargin: true,
              folding: true,
              quickSuggestions: true,
              suggestOnTriggerCharacters: true,
              tabCompletion: 'on',
            }}
          />
        </div>

        {/* Draggable splitter handle */}
        <div style={styles.splitter} onMouseDown={handleSplitterMouseDown} />

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

      {/* New file modal */}
      {showNewFileModal && (
        <div
          style={styles.modalOverlay}
          onClick={() => setShowNewFileModal(false)}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0' }}>New File</h3>
            <input
              type="text"
              placeholder="path/to/filename.tex"
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
  presenceBar: {
    display: 'flex',
    gap: '4px',
    marginLeft: '8px',
  },
  presenceDot: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '11px',
    fontWeight: 700,
    color: 'white',
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
    flexShrink: 0,
  },
  sidebarContent: {
    flex: 1,
    overflow: 'auto',
  },
  iconBtn: {
    padding: '4px 8px',
    fontSize: '12px',
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
