import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { MonacoBinding } from 'y-monaco'
import { projectsApi, compileApi, commentsApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import { useProjectRole } from '../hooks/useProjectRole'
import FileTree from '../components/FileTree'
import DocumentOutline from '../components/DocumentOutline'
import PDFViewer from '../components/PDFViewer'
import AIPanel from '../components/AIPanel'
import CollabModal from '../components/CollabModal'
import CommentsPanel from '../components/CommentsPanel'
import { registerLatexLanguage, registerLatexDiagnostics } from '../editor/latexLanguage'
import { parseSyncTeX, findSourceFromClick } from '../utils/synctexParser'
import type { SyncTeXData } from '../utils/synctexParser'
import { userColor } from '../utils/userColor'
import { canEdit, canComment, canManageMembers } from '../types'
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
  // content state is kept in sync with the active ytext via observer
  // so AI panel, outline, and save always see current content
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [compiling, setCompiling] = useState(false)
  const [currentFile, setCurrentFile] = useState('main.tex')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [syncTeXData, setSyncTeXData] = useState<SyncTeXData | null>(null)
  const [previewWidth, setPreviewWidth] = useState(400)
  const [showNewFileModal, setShowNewFileModal] = useState(false)
  const [newFileName, setNewFileName] = useState('')
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderParent, setNewFolderParent] = useState('')
  const [newFolderName, setNewFolderName] = useState('')
  const [compileError, setCompileError] = useState<{
    message: string
    logs: string
  } | null>(null)
  const [connectedUsers, setConnectedUsers] = useState<AwarenessUser[]>([])
  const [showAIPanel, setShowAIPanel] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  // true once the Monaco editor has mounted and editorRef.current is set
  const [editorMounted, setEditorMounted] = useState(false)
  const [showCollabModal, setShowCollabModal] = useState(false)
  const [showCommentsPanel, setShowCommentsPanel] = useState(false)
  const [commentFocusLine, setCommentFocusLine] = useState<number | null>(null)

  // Role-based access control
  const myRole = useProjectRole(projectId)
  const editorRole = myRole ? canEdit(myRole) : false
  const commenterRole = myRole ? canComment(myRole) : false
  // ownerRole available for future use (e.g. member management UI guard)
  const _ownerRole = myRole ? canManageMembers(myRole) : false
  void _ownerRole

  const queryClient = useQueryClient()
  const mountedRef = useRef(true)
  const isDraggingRef = useRef(false)
  const saveRef = useRef<() => void>(() => {})
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const latexDiagnosticsCleanupRef = useRef<(() => void) | null>(null)

  // Yjs document and provider — live for the lifetime of the project page
  const ydocRef = useRef<Y.Doc | null>(null)
  const providerRef = useRef<WebsocketProvider | null>(null)
  // MonacoBinding — recreated on every file switch
  const bindingRef = useRef<MonacoBinding | null>(null)
  // Reference to the active ytext observer so we can unobserve on cleanup
  const ytextObserverRef = useRef<(() => void) | null>(null)
  const ytextRef = useRef<Y.Text | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (pdfUrl) URL.revokeObjectURL(pdfUrl)
      if (latexDiagnosticsCleanupRef.current) latexDiagnosticsCleanupRef.current()
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

  // ── Project-level Yjs setup ──────────────────────────────────────────────
  // Create one ydoc + WebSocket provider per project. They live until the
  // user navigates away. Per-file MonacoBindings are created separately.
  useEffect(() => {
    if (!projectId) return

    const ydoc = new Y.Doc()
    const provider = new WebsocketProvider(WS_URL, projectId, ydoc)
    ydocRef.current = ydoc
    providerRef.current = provider

    if (user) {
      provider.awareness.setLocalStateField('user', {
        name: user.email,
        color: userColor(user.id),
      })
    }

    const updateUsers = () => {
      const states = provider.awareness.getStates()
      const users: AwarenessUser[] = []
      states.forEach((state, clientId) => {
        if (clientId !== provider.awareness.clientID && state.user) {
          users.push(state.user as AwarenessUser)
        }
      })
      if (mountedRef.current) setConnectedUsers(users)
    }

    provider.awareness.on('change', updateUsers)
    updateUsers()

    return () => {
      provider.awareness.off('change', updateUsers)
      // Destroy the per-file binding first before tearing down the provider
      bindingRef.current?.destroy()
      bindingRef.current = null
      if (ytextObserverRef.current && ytextRef.current) {
        ytextRef.current.unobserve(ytextObserverRef.current)
        ytextObserverRef.current = null
      }
      provider.destroy()
      ydoc.destroy()
      ydocRef.current = null
      providerRef.current = null
      setConnectedUsers([])
    }
  }, [projectId, user])

  // ── Per-file MonacoBinding ───────────────────────────────────────────────
  // Recreated whenever the active file changes or the editor first mounts.
  // Uses a unique Y.Text key per file so each file has its own CRDT state.
  useEffect(() => {
    const editor = editorRef.current
    const ydoc = ydocRef.current
    const provider = providerRef.current
    if (!editor || !ydoc || !provider || !projectId || !currentFile) return

    // Clean up previous binding and observer
    bindingRef.current?.destroy()
    bindingRef.current = null
    if (ytextObserverRef.current && ytextRef.current) {
      ytextRef.current.unobserve(ytextObserverRef.current)
      ytextObserverRef.current = null
    }

    const ytext = ydoc.getText(currentFile)
    ytextRef.current = ytext

    let cancelled = false

    const setup = async () => {
      // If ytext is empty (first user to open this file), seed it from the backend
      if (ytext.length === 0) {
        try {
          const res = await projectsApi.getFile(projectId, currentFile)
          if (cancelled) return
          const fileContent =
            typeof res.data === 'string'
              ? res.data
              : ((res.data as { content?: string })?.content ?? '')
          // Guard: only insert if ytext is still empty (avoid race with another user)
          if (fileContent && ytext.length === 0) {
            ydoc.transact(() => {
              ytext.insert(0, fileContent)
            })
          }
        } catch {
          // File might not exist yet — start with empty ytext
        }
      }

      if (cancelled) return

      const model = editor.getModel()
      if (!model) return

      // MonacoBinding syncs ytext ↔ Monaco model bidirectionally.
      // On construction it also calls model.setValue(ytext.toString()) so the
      // editor immediately shows the correct file content.
      const binding = new MonacoBinding(ytext, model, new Set([editor]), provider.awareness)
      bindingRef.current = binding

      // Mirror ytext into the content state for AI panel / outline / save
      const syncContent = () => {
        if (mountedRef.current) setContent(ytext.toString())
      }
      ytext.observe(syncContent)
      ytextObserverRef.current = syncContent
      setContent(ytext.toString())
    }

    setup().catch(console.error)

    return () => {
      cancelled = true
      bindingRef.current?.destroy()
      bindingRef.current = null
      if (ytextObserverRef.current && ytextRef.current) {
        ytextRef.current.unobserve(ytextObserverRef.current)
        ytextObserverRef.current = null
      }
    }
  }, [currentFile, editorMounted, projectId])

  const saveFile = useMutation({
    // Always read from the editor to get the latest content (MonacoBinding
    // keeps the model in sync, so getValue() is always up-to-date)
    mutationFn: () =>
      projectsApi.createFile(projectId!, currentFile, editorRef.current?.getValue() ?? content),
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
    const text = editorRef.current?.getValue() ?? content
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = currentFile.split('/').pop() || 'file.tex'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleShare = () => setShowCollabModal(true)

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
          // Fetch synctex for inverse sync (best-effort)
          try {
            const syncRes = await compileApi.getSyncTeX(jobId)
            const stData = await parseSyncTeX(syncRes.data as ArrayBuffer)
            setSyncTeXData(stData)
          } catch {
            setSyncTeXData(null)
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

  const handleCreateFolder = (parentPath: string) => {
    setNewFolderParent(parentPath)
    setNewFolderName('')
    setShowNewFolderModal(true)
  }

  const submitCreateFolder = async () => {
    const trimmed = newFolderName.trim()
    if (!trimmed || !projectId) return
    const fullPath = newFolderParent ? `${newFolderParent}/${trimmed}/.gitkeep` : `${trimmed}/.gitkeep`
    try {
      await projectsApi.createFile(projectId, fullPath, '')
      queryClient.invalidateQueries({ queryKey: ['files', projectId] })
      setShowNewFolderModal(false)
      setNewFolderName('')
      toast.success(`Folder "${trimmed}" created`)
    } catch {
      toast.error('Failed to create folder')
    }
  }

  const handleDownloadFile = async (path: string) => {
    let text = editorRef.current?.getValue() ?? content
    if (path !== currentFile) {
      try {
        const res = await projectsApi.getFile(projectId!, path)
        text = typeof res.data === 'string' ? res.data : ((res.data as { content?: string })?.content ?? '')
      } catch {
        toast.error('Failed to download file')
        return
      }
    }
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = path.split('/').pop() || 'file.tex'
    a.click()
    URL.revokeObjectURL(url)
  }

  // Monaco setup
  const handleEditorBeforeMount: BeforeMount = (monaco) => {
    registerLatexLanguage(monaco)
  }

  // Monaco gutter decorations for commented lines
  const gutterDecorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)

  const { data: fileComments = [] } = useQuery({
    queryKey: ['comments', projectId, currentFile],
    queryFn: () => commentsApi.list(projectId!, currentFile).then((r) => r.data),
    enabled: !!projectId && !!currentFile && commenterRole,
    refetchInterval: 10_000,
  })

  const commentedLines = useMemo(() => {
    const lines = new Set<number>()
    fileComments.forEach((c) => lines.add(c.line))
    return lines
  }, [fileComments])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !editorMounted) return
    const monaco = (window as any).monaco
    if (!monaco) return

    const decorations = Array.from(commentedLines).map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        glyphMarginClassName: 'comment-gutter-icon',
        glyphMarginHoverMessage: { value: `Comments on line ${line}` },
      },
    }))

    if (gutterDecorationsRef.current) {
      gutterDecorationsRef.current.set(decorations)
    } else {
      gutterDecorationsRef.current = editor.createDecorationsCollection(decorations)
    }
  }, [commentedLines, editorMounted])

  const handleEditorMount: OnMount = (editor, monaco) => {
    // expose monaco on window for the gutter decoration effect above
    ;(window as any).monaco = monaco

    editorRef.current = editor
    // Clean up any previous diagnostics registration
    if (latexDiagnosticsCleanupRef.current) {
      latexDiagnosticsCleanupRef.current()
    }
    latexDiagnosticsCleanupRef.current = registerLatexDiagnostics(monaco, editor)

    // Track selection for AI rewrite mode
    editor.onDidChangeCursorSelection(() => {
      const sel = editor.getSelection()
      if (sel && !sel.isEmpty()) {
        setSelectedText(editor.getModel()?.getValueInRange(sel) ?? '')
      } else {
        setSelectedText('')
      }
    })

    // Gutter click → open comments panel at that line
    editor.onMouseDown((e) => {
      if (
        e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN &&
        e.target.position
      ) {
        const line = e.target.position.lineNumber
        setCommentFocusLine(line)
        setShowCommentsPanel(true)
      }
    })

    // Signal that the editor is ready — triggers the per-file binding effect
    setEditorMounted(true)
  }

  const handleOutlineNavigate = (line: number) => {
    if (editorRef.current) {
      editorRef.current.revealLineInCenter(line)
      editorRef.current.setPosition({ lineNumber: line, column: 1 })
      editorRef.current.focus()
    }
  }

  const handlePDFDoubleClick = (page: number, yRatio: number) => {
    if (!syncTeXData) return
    const loc = findSourceFromClick(syncTeXData, page, yRatio)
    if (!loc) return
    const targetFile = files?.find((f) => f.path.endsWith(loc.file))?.path ?? loc.file
    if (targetFile !== currentFile) {
      setCurrentFile(targetFile)
    }
    setTimeout(() => handleOutlineNavigate(loc.line), 50)
    toast.success(`Jumped to ${loc.file}:${loc.line}`, { duration: 1500 })
  }

  // Memoized outline
  const outlineContent = useMemo(() => content, [content])

  const localUserColor = userColor(user?.id || '')
  const localUserInitial = (user?.email?.[0] ?? 'U').toUpperCase()

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <Link to="/" style={styles.backLink}>
            &larr; Back
          </Link>
          <h2>{project?.title || 'Loading...'}</h2>
          {/* Presence bar — always visible; shows local user + any remote users */}
          <div style={styles.presenceBar}>
            <div
              style={{ ...styles.presenceDot, backgroundColor: localUserColor }}
              title={`${user?.email ?? 'You'} (you)`}
            >
              {localUserInitial}
            </div>
            {connectedUsers.map((u, i) => (
              <div
                key={i}
                style={{ ...styles.presenceDot, backgroundColor: u.color }}
                title={u.name}
              >
                {u.name[0].toUpperCase()}
              </div>
            ))}
          </div>
        </div>
        <div style={styles.headerRight}>
          <button className="secondary" onClick={handleShare} title="Manage collaborators">
            Share
          </button>
          {commenterRole && (
            <button
              className="secondary"
              onClick={() => setShowCommentsPanel((v) => !v)}
              title="Comments"
              style={showCommentsPanel ? { outline: '2px solid var(--color-primary)' } : {}}
            >
              💬 Comments
            </button>
          )}
          <button
            className="secondary"
            onClick={() => setShowAIPanel((v) => !v)}
            title="AI Assistant"
            style={showAIPanel ? { outline: '2px solid var(--color-primary)' } : {}}
          >
            ✨ AI
          </button>
          <button className="secondary" onClick={handleDownload}>
            Download
          </button>
          {editorRole && (
            <button
              className="secondary"
              onClick={() => saveFile.mutate()}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
          {editorRole && (
            <button
              className="primary"
              onClick={() => compile.mutate()}
              disabled={compiling}
            >
              {compiling ? 'Compiling...' : 'Compile'}
            </button>
          )}
        </div>
      </header>

      <div style={styles.main}>
        <aside style={styles.sidebar}>
          <div style={styles.sidebarHeader}>
            <h3>Files</h3>
            {editorRole && (
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  className="secondary"
                  style={styles.iconBtn}
                  onClick={() => handleCreateFolder('')}
                  title="New folder"
                >
                  &#128193;
                </button>
                <button
                  className="secondary"
                  style={styles.iconBtn}
                  onClick={() => setShowNewFileModal(true)}
                  title="New file"
                >
                  +
                </button>
              </div>
            )}
          </div>
          <div style={styles.sidebarContent}>
            {files && (
              <FileTree
                files={files}
                currentFile={currentFile}
                onSelectFile={setCurrentFile}
                onDeleteFile={editorRole ? (path) => deleteFileMutation.mutate(path) : undefined}
                onRenameFile={editorRole ? (oldPath, newPath) =>
                  renameFileMutation.mutate({ oldPath, newPath }) : undefined}
                onNewFileInFolder={editorRole ? handleNewFileInFolder : undefined}
                onCreateFolder={editorRole ? handleCreateFolder : undefined}
                onDownloadFile={handleDownloadFile}
              />
            )}
            <DocumentOutline
              content={outlineContent}
              onNavigate={handleOutlineNavigate}
            />
            {showAIPanel && (
              <AIPanel
                errorLogs={compileError?.logs ?? null}
                fileContent={content}
                selectedText={selectedText}
              />
            )}
          </div>
        </aside>

        <div style={styles.editor}>
          {/* Monaco Editor in uncontrolled mode — MonacoBinding owns the content */}
          <Editor
            height="100%"
            defaultLanguage="latex"
            theme="vs-light"
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

        {/* Comments panel — inline between editor and splitter */}
        {showCommentsPanel && projectId && myRole && (
          <CommentsPanel
            projectId={projectId}
            currentFile={currentFile}
            focusLine={commentFocusLine}
            role={myRole}
          />
        )}

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
              <PDFViewer
                url={pdfUrl}
                onDoubleClick={syncTeXData ? handlePDFDoubleClick : undefined}
              />
            ) : (
              <p style={styles.previewPlaceholder}>
                Compile to see PDF preview
              </p>
            )}
          </div>
        </aside>
      </div>

      {/* New folder modal */}
      {showNewFolderModal && (
        <div
          style={styles.modalOverlay}
          onClick={() => setShowNewFolderModal(false)}
        >
          <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 16px 0' }}>
              New Folder{newFolderParent ? ` in ${newFolderParent}` : ''}
            </h3>
            <input
              type="text"
              placeholder="folder-name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitCreateFolder()
                if (e.key === 'Escape') setShowNewFolderModal(false)
              }}
              style={styles.modalInput}
              autoFocus
            />
            <div style={styles.modalButtons}>
              <button
                className="secondary"
                onClick={() => setShowNewFolderModal(false)}
              >
                Cancel
              </button>
              <button
                className="primary"
                onClick={submitCreateFolder}
                disabled={!newFolderName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

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
      {showCollabModal && projectId && (
        <CollabModal
          projectId={projectId}
          onClose={() => setShowCollabModal(false)}
        />
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
