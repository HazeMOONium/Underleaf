import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type * as Monaco from 'monaco-editor'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no bundled types
import { initVimMode } from 'monaco-vim'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — no bundled types
import { EmacsExtension } from 'monaco-emacs'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { MonacoBinding } from 'y-monaco'
import { projectsApi, compileApi, commentsApi, snapshotsApi } from '../services/api'
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
  clientId: number
  name: string
  color: string
  cursor?: { lineNumber: number; column: number }
  selection?: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
}

// ── Feature A: LaTeX log parser ────────────────────────────────────────────

interface LogIssue {
  type: 'error' | 'warning'
  file: string
  line: number
  message: string
}

/**
 * Resolves a file path from pdflatex log output (e.g. `./sections/intro.tex`)
 * to an actual project file path (e.g. `sections/intro.tex`).
 * Strategy: strip `./` → exact match → suffix match → basename match → raw.
 */
function resolveLogFilePath(logPath: string, projectFiles: { path: string }[]): string {
  const normalized = logPath.replace(/^\.\//, '')
  // Exact match
  if (projectFiles.find(f => f.path === normalized)) return normalized
  // Suffix match (e.g. log says `intro.tex`, project has `sections/intro.tex`)
  let best: string | null = null
  let bestLen = 0
  for (const f of projectFiles) {
    if (f.path === normalized || f.path.endsWith('/' + normalized)) {
      if (f.path.length > bestLen) { bestLen = f.path.length; best = f.path }
    }
  }
  if (best) return best
  // Basename match as last resort
  const base = normalized.split('/').pop() ?? normalized
  const byBase = projectFiles.find(f => f.path === base || f.path.endsWith('/' + base))
  return byBase?.path ?? normalized
}

function parseLatexLog(log: string): LogIssue[] {
  const lines = log.split('\n')
  const issues: LogIssue[] = []
  const fileStack: string[] = ['main.tex']

  const currentFile = () => fileStack[fileStack.length - 1] ?? 'main.tex'

  let lineIdx = 0
  while (lineIdx < lines.length) {
    const line = lines[lineIdx]

    // Track file context: `(./foo.tex` or `(sections/foo.tex` pushes a file
    const fileOpenMatch = line.match(/\(\.?\/?(?:\.\/)?([a-zA-Z0-9_/.-]+\.(?:tex|bib|cls|sty))/i)
    if (fileOpenMatch) {
      fileStack.push(fileOpenMatch[1].replace(/^\.\//, ''))
    }
    // Leading `)` may pop the stack (heuristic)
    if (/^\)/.test(line) && fileStack.length > 1) {
      fileStack.pop()
    }

    // Pattern: `./file.tex:N: message` or `file.tex:N: message`
    const fileLineMatch = line.match(/^\.?\/?([a-zA-Z0-9_/.-]+\.tex):(\d+):\s*(.+)/)
    if (fileLineMatch) {
      issues.push({
        type: 'error',
        file: fileLineMatch[1],
        line: parseInt(fileLineMatch[2], 10),
        message: fileLineMatch[3].trim(),
      })
      lineIdx++
      continue
    }

    // Pattern: `! LaTeX Error: ...` or `! ...`
    if (/^!/.test(line)) {
      const msg = line.replace(/^!\s*/, '').trim()
      // Look ahead for `l.N` line reference
      let refLine = 0
      for (let j = lineIdx + 1; j < Math.min(lineIdx + 8, lines.length); j++) {
        const lMatch = lines[j].match(/^l\.(\d+)\s/)
        if (lMatch) {
          refLine = parseInt(lMatch[1], 10)
          break
        }
      }
      issues.push({
        type: 'error',
        file: currentFile(),
        line: refLine,
        message: msg,
      })
      lineIdx++
      continue
    }

    // Pattern: `Package XYZ Warning: ...` or `LaTeX Warning: ...`
    const warnMatch = line.match(/^(?:Package\s+\S+\s+Warning|LaTeX\s+Warning|Class\s+\S+\s+Warning):\s*(.+)/i)
    if (warnMatch) {
      // Warnings may span multiple lines; grab the first line's content
      issues.push({
        type: 'warning',
        file: currentFile(),
        line: 0,
        message: warnMatch[1].trim(),
      })
      lineIdx++
      continue
    }

    lineIdx++
  }

  return issues.slice(0, 20)
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
  const [compileError, setCompileError] = useState<string | null>(null)
  const [compileLogs, setCompileLogs] = useState<string>('')
  const [compileDuration, setCompileDuration] = useState<number | null>(null)
  const [lastJobId, setLastJobId] = useState<string | null>(null)
  const compileStartRef = useRef<number>(0)
  const [previewTab, setPreviewTab] = useState<'pdf' | 'logs' | 'files' | 'history'>('pdf')
  const [historyPdfUrl, setHistoryPdfUrl] = useState<string | null>(null)
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null)
  const [editingLabelText, setEditingLabelText] = useState('')
  const [connectedUsers, setConnectedUsers] = useState<AwarenessUser[]>([])
  const [showAIPanel, setShowAIPanel] = useState(false)
  const [selectedText, setSelectedText] = useState('')
  // true once the Monaco editor has mounted and editorRef.current is set
  const [editorMounted, setEditorMounted] = useState(false)
  const [showCollabModal, setShowCollabModal] = useState(false)
  const [showCommentsPanel, setShowCommentsPanel] = useState(false)
  const [commentFocusLine, setCommentFocusLine] = useState<number | null>(null)

  // Engine selector — synced from project data
  const [engine, setEngine] = useState<string>('pdflatex')

  // Word / character count
  const [wordCount, setWordCount] = useState(0)
  const [charCount, setCharCount] = useState(0)

  // Keybinding mode selector
  type KeybindingMode = 'normal' | 'vim' | 'emacs'
  const [keybindingMode, setKeybindingMode] = useState<KeybindingMode>(
    () => (localStorage.getItem('keybindingMode') as KeybindingMode | null) ?? 'normal',
  )

  // Spell check
  type SpellLocale = 'en-us' | 'en-gb'
  const [spellEnabled, setSpellEnabled] = useState<boolean>(
    () => localStorage.getItem('spellCheckEnabled') !== 'false',
  )
  const [spellLocale, setSpellLocale] = useState<SpellLocale>(
    () => (localStorage.getItem('spellCheckLocale') as SpellLocale | null) ?? 'en-us',
  )
  const spellCheckerRef = useRef<{ cleanup: () => void; setLocale: (l: SpellLocale) => void } | null>(null)

  // Project-wide search panel
  interface SearchResult { file: string; line: number; col: number; preview: string }
  const [showSearchPanel, setShowSearchPanel] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchLoading, setSearchLoading] = useState(false)

  // Feature A: structured log parsing
  const [issuesExpanded, setIssuesExpanded] = useState(true)

  // Feature B: sidebar drag-and-drop upload
  const [sidebarDragOver, setSidebarDragOver] = useState(false)

  // Feature C: \ref / \cite completion labels
  const [projectLabels, setProjectLabels] = useState<string[]>([])
  const [projectCites, setProjectCites] = useState<string[]>([])
  const labelsRef = useRef<string[]>([])
  const citesRef = useRef<string[]>([])
  const completionProviderRef = useRef<{ dispose: () => void } | null>(null)

  // Role-based access control
  // null = still loading | false = loaded, not a member | ProjectRole = active role
  const myRole = useProjectRole(projectId)
  const accessRevoked = myRole === false
  const editorRole = myRole ? canEdit(myRole) : false
  const commenterRole = myRole ? canComment(myRole) : false
  // ownerRole available for future use (e.g. member management UI guard)
  const _ownerRole = myRole ? canManageMembers(myRole) : false
  void _ownerRole

  // Keep refs in sync with state so completion provider closure always reads fresh data
  labelsRef.current = projectLabels
  citesRef.current = projectCites

  const queryClient = useQueryClient()
  const mountedRef = useRef(true)
  const isDraggingRef = useRef(false)
  const saveRef = useRef<() => void>(() => {})
  const compileRef = useRef<() => void>(() => {})
  const newFileRef = useRef<() => void>(() => {})
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const latexDiagnosticsCleanupRef = useRef<(() => void) | null>(null)
  const remoteDecorationsRef = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null)
  const keybindingCleanupRef = useRef<() => void>(() => {})
  const vimStatusBarRef = useRef<HTMLDivElement | null>(null)

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
      if (historyPdfUrl) URL.revokeObjectURL(historyPdfUrl)
      if (latexDiagnosticsCleanupRef.current) latexDiagnosticsCleanupRef.current()
      spellCheckerRef.current?.cleanup()
    }
  }, [])

  // Keep Monaco readOnly in sync with the current role (options prop only applies on mount)
  useEffect(() => {
    editorRef.current?.updateOptions({ readOnly: !editorRole })
  }, [editorRole])

  // Wipe editor content the moment access is revoked so the file is never visible
  useEffect(() => {
    if (accessRevoked) {
      editorRef.current?.getModel()?.setValue('')
    }
  }, [accessRevoked])

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!).then((res) => res.data),
    enabled: !!projectId && myRole !== false,
  })

  const { data: files } = useQuery({
    queryKey: ['files', projectId],
    queryFn: () => projectsApi.listFiles(projectId!).then((res) => res.data),
    enabled: !!projectId && myRole !== false,
  })

  const { data: snapshots = [] } = useQuery({
    queryKey: ['snapshots', projectId],
    queryFn: () => snapshotsApi.list(projectId!).then((res) => res.data),
    enabled: !!projectId && myRole !== false,
  })

  // Sync engine from project data
  useEffect(() => {
    if (project?.engine) setEngine(project.engine)
  }, [project?.engine])

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
          const u = state.user as AwarenessUser
          users.push({
            clientId,
            name: u.name,
            color: u.color,
            cursor: u.cursor,
            selection: u.selection,
          })
        }
      })
      if (mountedRef.current) setConnectedUsers(users)
    }

    provider.awareness.on('change', updateUsers)
    updateUsers()

    // Track clientId → email so we can show "X left" with their name
    const peerNames = new Map<number, string>()

    // When peers join/leave: re-broadcast cursor AND show toasts
    const onPeerJoin = ({ added, removed }: { added: number[]; removed: number[] }) => {
      const states = provider.awareness.getStates()

      // Toast for newly joined peers
      added.forEach((clientId) => {
        if (clientId === provider.awareness.clientID) return
        const state = states.get(clientId) as { user?: { name?: string } } | undefined
        const email = state?.user?.name
        if (email) {
          peerNames.set(clientId, email)
          toast(`${email} joined`, { icon: '👋', duration: 3000, id: `join-${clientId}` })
        }
      })

      // Toast for peers who left
      removed.forEach((clientId) => {
        if (clientId === provider.awareness.clientID) return
        const name = peerNames.get(clientId)
        if (name) {
          peerNames.delete(clientId)
          toast(`${name} left`, { duration: 2000, id: `leave-${clientId}` })
        }
      })

      // Re-broadcast our own cursor when someone joins so they see it immediately
      if (added.length > 0 && user && editorRef.current) {
        const pos = editorRef.current.getPosition()
        provider.awareness.setLocalStateField('user', {
          name: user.email,
          color: userColor(user.id),
          cursor: pos ? { lineNumber: pos.lineNumber, column: pos.column } : undefined,
        })
      }
    }
    provider.awareness.on('change', onPeerJoin)

    return () => {
      provider.awareness.off('change', updateUsers)
      provider.awareness.off('change', onPeerJoin)
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

  // Broadcast cursor whenever the editor is ready or the user identity changes.
  // This covers the case where the Yjs provider is (re)created after
  // handleEditorMount has already fired, leaving the new provider without a cursor.
  useEffect(() => {
    const provider = providerRef.current
    if (!provider || !user || !editorMounted) return
    const pos = editorRef.current?.getPosition()
    provider.awareness.setLocalStateField('user', {
      name: user.email,
      color: userColor(user.id),
      cursor: pos ? { lineNumber: pos.lineNumber, column: pos.column } : undefined,
    })
  }, [editorMounted, user])

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
        if (!mountedRef.current) return
        const text = ytext.toString()
        setContent(text)
        setCharCount(text.length)
        setWordCount(text.trim() === '' ? 0 : text.trim().split(/\s+/).length)
      }
      ytext.observe(syncContent)
      ytextObserverRef.current = syncContent
      setContent(ytext.toString())
      // Initialise counts for the newly loaded file
      const initText = ytext.toString()
      setCharCount(initText.length)
      setWordCount(initText.trim() === '' ? 0 : initText.trim().split(/\s+/).length)
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
      // Auto-compile on save
      compileRef.current()
    },
    onError: () => toast.error('Save failed'),
    onSettled: () => setSaving(false),
  })

  // Keep saveRef in sync for Ctrl+S
  saveRef.current = () => saveFile.mutate()
  newFileRef.current = () => { if (editorRole) setShowNewFileModal(true) }

  // Ctrl+S / Ctrl+N keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        saveRef.current()
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        if (editorRole) setShowNewFileModal(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editorRole])

  // Inject per-user CSS for Monaco selection + line-highlight decorations.
  // Uses rgba() (not 8-digit hex) and .monaco-editor parent for specificity.
  useEffect(() => {
    let styleEl = document.getElementById('underleaf-remote-user-css') as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'underleaf-remote-user-css'
      document.head.appendChild(styleEl)
    }
    // u.color is hsl(...) — use clientId for valid CSS class names,
    // and convert hsl → hsla for semi-transparent backgrounds.
    const toHsla = (hsl: string, a: number) =>
      hsl.replace('hsl(', 'hsla(').replace(')', `, ${a})`)

    const css = connectedUsers
      .map((u) => {
        const cls = `uc${u.clientId}`
        const selBg  = toHsla(u.color, 0.35)
        const lineBg = toHsla(u.color, 0.10)
        return [
          // Selection overlay
          `.monaco-editor .view-overlays .${cls}-sel,`,
          `.monaco-editor .${cls}-sel { background-color: ${selBg} !important; }`,
          // Line highlight overlay
          `.monaco-editor .view-overlays .${cls}-line,`,
          `.monaco-editor .${cls}-line { background-color: ${lineBg} !important; }`,
          // Cursor bar: a 2px solid-color inline-block span injected into the text layer
          `.monaco-editor .${cls}-cursor {`,
          `  display: inline-block !important;`,
          `  width: 2px !important;`,
          `  height: 1em !important;`,
          `  background: ${u.color} !important;`,
          `  vertical-align: text-bottom !important;`,
          `  margin-left: -2px !important;`,
          `  pointer-events: none !important;`,
          `}`,
        ].join('\n')
      })
      .join('\n')
    styleEl.textContent = css
  }, [connectedUsers])

  // Decorations: className for both selection and line highlight.
  // className creates absolutely-positioned overlay divs (same as Monaco's own
  // selection highlight) — these are always visible above the text layer.
  // Cursor bars are handled separately via content widgets.
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !editorMounted) return
    const monaco = (window as any).monaco
    if (!monaco) return

    const decorations: Monaco.editor.IModelDeltaDecoration[] = []

    connectedUsers.forEach((u) => {
      // Use clientId for CSS class names — u.color is hsl(...) which has
      // characters invalid in CSS class names (parentheses, commas, %).
      const cls = `uc${u.clientId}`

      if (u.selection) {
        const { startLineNumber, startColumn, endLineNumber, endColumn } = u.selection
        const isEmpty = startLineNumber === endLineNumber && startColumn === endColumn
        if (!isEmpty) {
          decorations.push({
            range: new monaco.Range(startLineNumber, startColumn, endLineNumber, endColumn),
            options: {
              className: `${cls}-sel`,
              hoverMessage: { value: `**${u.name}**` },
            },
          })
        }
      }

      if (u.cursor) {
        // Line highlight
        decorations.push({
          range: new monaco.Range(u.cursor.lineNumber, 1, u.cursor.lineNumber, 1),
          options: { isWholeLine: true, className: `${cls}-line` },
        })
        // Cursor bar via beforeContentClassName — real <span> in the text layer,
        // no z-index conflicts with overlay decorations.
        decorations.push({
          range: new monaco.Range(u.cursor.lineNumber, u.cursor.column, u.cursor.lineNumber, u.cursor.column),
          options: {
            beforeContentClassName: `${cls}-cursor`,
            stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
          },
        })
      }
    })

    if (remoteDecorationsRef.current) {
      remoteDecorationsRef.current.set(decorations)
    } else {
      remoteDecorationsRef.current = editor.createDecorationsCollection(decorations)
    }
  }, [connectedUsers, editorMounted])

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
    mutationFn: (draft: boolean) => compileApi.createJob(projectId!, draft),
    onMutate: () => {
      setCompiling(true)
      setCompileError(null)
      setCompileLogs('')
      setCompileDuration(null)
      compileStartRef.current = Date.now()
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

  // Keep compileRef in sync so saveFile.onSuccess can trigger compile
  // without a circular dependency between the two mutations
  compileRef.current = () => {
    if (editorRole && !compiling) compile.mutate(false)
  }

  const fetchLogs = async (jobId: string): Promise<string> => {
    try {
      const res = await compileApi.getLogs(jobId)
      return typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2)
    } catch {
      return 'Could not retrieve compilation logs.'
    }
  }

  const pollJobStatus = (jobId: string) => {
    setLastJobId(jobId)
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
          const elapsed = (Date.now() - compileStartRef.current) / 1000
          setCompileDuration(elapsed)
          toast.success(`Compiled in ${elapsed.toFixed(1)}s`)
          // Refresh snapshot list after a short delay to allow auto-creation
          setTimeout(() => {
            queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] })
          }, 1500)
          // Fetch PDF
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
          // Fetch logs (best-effort, available for the Logs tab)
          fetchLogs(jobId).then(setCompileLogs)
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
          setCompileError(data.error_message || 'Compilation failed')
          setPdfUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev)
            return null
          })
          const logs = await fetchLogs(jobId)
          setCompileLogs(logs)
          // Auto-switch to logs tab so the user sees what went wrong
          setPreviewTab('logs')
        }
      } catch {
        clearInterval(interval)
        setCompiling(false)
      }
    }, 2000)
  }

  const downloadText = (text: string, filename: string) => {
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const downloadSyncTeX = async (jobId: string) => {
    try {
      const res = await compileApi.getSyncTeX(jobId)
      const blob = new Blob([res.data as BlobPart], { type: 'application/gzip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'output.synctex.gz'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Failed to download SyncTeX file')
    }
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

  // Duplicate file — copies content to "<name>-copy.<ext>"
  const handleDuplicateFile = useCallback(async (path: string) => {
    if (!projectId) return
    const parts = path.split('/')
    const name = parts[parts.length - 1]
    const dotIdx = name.lastIndexOf('.')
    const base = dotIdx > 0 ? name.slice(0, dotIdx) : name
    const ext = dotIdx > 0 ? name.slice(dotIdx) : ''
    const newName = `${base}-copy${ext}`
    const newPath = [...parts.slice(0, -1), newName].join('/')
    try {
      const res = await projectsApi.getFile(projectId, path)
      const text = typeof res.data === 'string' ? res.data : ((res.data as { content?: string })?.content ?? '')
      await projectsApi.createFile(projectId, newPath, text)
      queryClient.invalidateQueries({ queryKey: ['files', projectId] })
      toast.success(`Duplicated to ${newPath}`)
    } catch {
      toast.error('Failed to duplicate file')
    }
  }, [projectId, queryClient])

  // Delete entire folder — deletes all files whose path starts with folderPath/
  const handleDeleteFolder = useCallback((folderPath: string) => {
    if (!projectId || !files) return
    const toDelete = files.filter((f) => f.path.startsWith(folderPath + '/'))
    Promise.all(toDelete.map((f) => projectsApi.deleteFile(projectId, f.path)))
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['files', projectId] })
        toast.success(`Deleted folder "${folderPath}"`)
        if (toDelete.some((f) => f.path === currentFile)) setCurrentFile('main.tex')
      })
      .catch(() => toast.error('Failed to delete folder'))
  }, [projectId, files, queryClient, currentFile])

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

    // Spell checker — only for .tex files, loaded lazily
    spellCheckerRef.current?.cleanup()
    spellCheckerRef.current = null
    if (spellEnabled) {
      import('../editor/spellChecker').then(({ registerSpellChecker }) => {
        spellCheckerRef.current = registerSpellChecker(monaco, editor, spellLocale)
      })
    }

    // Track cursor/selection for AI panel and awareness broadcasting
    const broadcastPosition = () => {
      const provider = providerRef.current
      if (!provider || !user) return
      const pos = editor.getPosition()
      const sel = editor.getSelection()
      provider.awareness.setLocalStateField('user', {
        name: user.email,
        color: userColor(user.id),
        cursor: pos ? { lineNumber: pos.lineNumber, column: pos.column } : undefined,
        selection:
          sel && !sel.isEmpty()
            ? {
                startLineNumber: sel.startLineNumber,
                startColumn: sel.startColumn,
                endLineNumber: sel.endLineNumber,
                endColumn: sel.endColumn,
              }
            : undefined,
      })
    }

    editor.onDidChangeCursorPosition(broadcastPosition)

    editor.onDidChangeCursorSelection((e) => {
      broadcastPosition()
      const sel = e.selection
      if (sel && !sel.isEmpty()) {
        setSelectedText(editor.getModel()?.getValueInRange(sel) ?? '')
      } else {
        setSelectedText('')
      }
    })

    // Broadcast initial position so remote users see this cursor immediately
    // (without waiting for the user to move the cursor first).
    // Try now (provider may already be ready) and again after a short delay
    // in case the Yjs provider initializes asynchronously.
    broadcastPosition()
    setTimeout(broadcastPosition, 300)

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

    // Register Ctrl+N inside Monaco so it isn't swallowed by the editor's
    // own keybinding system before it can bubble to the window listener.
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyN, () => {
      newFileRef.current()
    })

    // Ctrl+Shift+F — project-wide search panel
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyF, () => {
      setShowSearchPanel((v) => !v)
    })

    // Signal that the editor is ready — triggers the per-file binding effect
    setEditorMounted(true)
  }

  // ── Feature C: Scan project files for \label and \bibitem/@ keys ──────────
  useEffect(() => {
    if (!editorMounted || !files || !projectId) return

    let cancelled = false

    const scan = async () => {
      const labels: string[] = []
      const cites: string[] = []

      const texFiles = files.filter((f) => f.path.endsWith('.tex'))
      const bibFiles = files.filter((f) => f.path.endsWith('.bib'))

      await Promise.all([
        ...texFiles.map(async (f) => {
          try {
            const res = await projectsApi.getFile(projectId, f.path)
            const text = typeof res.data === 'string'
              ? res.data
              : ((res.data as { content?: string })?.content ?? '')
            const matches = text.matchAll(/\\label\{([^}]+)\}/g)
            for (const m of matches) labels.push(m[1])
          } catch {
            // Ignore missing/inaccessible files
          }
        }),
        ...bibFiles.map(async (f) => {
          try {
            const res = await projectsApi.getFile(projectId, f.path)
            const text = typeof res.data === 'string'
              ? res.data
              : ((res.data as { content?: string })?.content ?? '')
            // @article{key, / @book{key, / \bibitem{key}
            const atMatches = text.matchAll(/@\w+\{([^,\s}]+)/g)
            for (const m of atMatches) cites.push(m[1])
            const bibitems = text.matchAll(/\\bibitem(?:\[.*?\])?\{([^}]+)\}/g)
            for (const m of bibitems) cites.push(m[1])
          } catch {
            // Ignore
          }
        }),
      ])

      if (cancelled) return
      setProjectLabels([...new Set(labels)])
      setProjectCites([...new Set(cites)])
    }

    scan().catch(console.error)

    return () => {
      cancelled = true
    }
  }, [editorMounted, files, projectId])

  // ── Feature C: Register Monaco \ref/\cite completion provider ─────────────
  useEffect(() => {
    if (!editorMounted) return

    const monaco = (window as any).monaco
    if (!monaco) return

    // Dispose any previous provider
    completionProviderRef.current?.dispose()

    const provider = monaco.languages.registerCompletionItemProvider('latex', {
      triggerCharacters: ['{'],
      provideCompletionItems: (model: any, position: any) => {
        const lineText: string = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        })

        const refMatch = lineText.match(/\\(?:ref|eqref|cref|Cref|autoref|pageref)\{([^}]*)$/)
        const citeMatch = lineText.match(/\\(?:cite|citep|citet|citealt|citealp|nocite)\{([^}]*)$/)

        if (!refMatch && !citeMatch) return { suggestions: [] }

        const typedPrefix = (refMatch ?? citeMatch)![1]
        const wordRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typedPrefix.length,
          endColumn: position.column,
        }

        if (refMatch) {
          return {
            suggestions: labelsRef.current.map((lbl) => ({
              label: lbl,
              kind: monaco.languages.CompletionItemKind.Reference,
              insertText: lbl,
              range: wordRange,
              documentation: `\\label{${lbl}}`,
            })),
          }
        }

        return {
          suggestions: citesRef.current.map((key) => ({
            label: key,
            kind: monaco.languages.CompletionItemKind.Value,
            insertText: key,
            range: wordRange,
            documentation: `BibTeX key: ${key}`,
          })),
        }
      },
    })

    completionProviderRef.current = provider

    return () => {
      provider.dispose()
      completionProviderRef.current = null
    }
  }, [editorMounted])

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

  // ── Spell check — locale changes ─────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('spellCheckLocale', spellLocale)
    spellCheckerRef.current?.setLocale(spellLocale)
  }, [spellLocale])

  // ── Keybinding mode — vim / emacs / normal ────────────────────────────────
  useEffect(() => {
    localStorage.setItem('keybindingMode', keybindingMode)
    if (!editorMounted || !editorRef.current) return

    // Dispose the previous mode
    keybindingCleanupRef.current()
    keybindingCleanupRef.current = () => {}

    const editor = editorRef.current
    if (keybindingMode === 'vim' && vimStatusBarRef.current) {
      const vim = initVimMode(editor, vimStatusBarRef.current)
      keybindingCleanupRef.current = () => vim.dispose()
    } else if (keybindingMode === 'emacs') {
      const emacs = new EmacsExtension(editor)
      emacs.start()
      keybindingCleanupRef.current = () => emacs.dispose()
    }
  }, [keybindingMode, editorMounted])

  // ── Project-wide search (Ctrl+Shift+F) ───────────────────────────────────
  const runProjectSearch = useCallback(async (query: string) => {
    if (!query.trim() || !files || !projectId) { setSearchResults([]); return }
    setSearchLoading(true)
    const results: SearchResult[] = []
    try {
      await Promise.all(
        files
          .filter((f) => f.path.match(/\.(tex|bib|sty|cls|txt|md)$/))
          .map(async (f) => {
            try {
              const res = await projectsApi.getFile(projectId, f.path)
              const text = typeof res.data === 'string'
                ? res.data
                : ((res.data as { content?: string })?.content ?? '')
              const fileLines = text.split('\n')
              const lq = query.toLowerCase()
              fileLines.forEach((line, idx) => {
                const col = line.toLowerCase().indexOf(lq)
                if (col !== -1) {
                  results.push({
                    file: f.path,
                    line: idx + 1,
                    col: col + 1,
                    preview: line.trim().slice(0, 80),
                  })
                }
              })
            } catch { /* skip inaccessible files */ }
          }),
      )
    } finally {
      setSearchLoading(false)
    }
    results.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    setSearchResults(results)
  }, [files, projectId])

  // ── Feature A: parsed log issues ─────────────────────────────────────────
  const logIssues = useMemo(() => (compileLogs ? parseLatexLog(compileLogs) : []), [compileLogs])
  const logErrorCount = logIssues.filter((i) => i.type === 'error').length
  const logWarningCount = logIssues.filter((i) => i.type === 'warning').length

  // ── Feature B: sidebar drag-and-drop upload handlers ─────────────────────
  const handleSidebarDragOver = useCallback((e: React.DragEvent) => {
    if (!editorRole) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    setSidebarDragOver(true)
  }, [editorRole])

  const handleSidebarDragLeave = useCallback((e: React.DragEvent) => {
    // Only clear if leaving the aside element itself (not a child)
    if (e.currentTarget.contains(e.relatedTarget as Node)) return
    setSidebarDragOver(false)
  }, [])

  const handleSidebarDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      setSidebarDragOver(false)
      if (!editorRole || !projectId) return

      const droppedFiles = Array.from(e.dataTransfer.files)
      if (droppedFiles.length === 0) return

      const textExts = ['.tex', '.bib', '.txt', '.md', '.cls', '.sty', '.cfg']
      const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.pdf']

      await Promise.all(
        droppedFiles.map((file) => {
          return new Promise<void>((resolve) => {
            const ext = '.' + (file.name.split('.').pop() ?? '').toLowerCase()
            const reader = new FileReader()

            if (textExts.includes(ext)) {
              reader.onload = async () => {
                try {
                  await projectsApi.createFile(projectId, file.name, reader.result as string)
                  toast.success(`Uploaded: ${file.name}`)
                } catch {
                  toast.error(`Failed to upload ${file.name}`)
                }
                resolve()
              }
              reader.readAsText(file)
            } else if (binaryExts.includes(ext)) {
              // Use streaming multipart upload — no base64 encoding overhead
              ;(async () => {
                try {
                  await projectsApi.uploadFile(projectId, file.name, file)
                  toast.success(`Uploaded: ${file.name}`)
                } catch {
                  toast.error(`Failed to upload ${file.name}`)
                }
                resolve()
              })()
            } else {
              toast.error(`Unsupported file type: ${file.name}`)
              resolve()
            }
          })
        }),
      )

      queryClient.invalidateQueries({ queryKey: ['files', projectId] })
    },
    [editorRole, projectId, queryClient],
  )

  const localUserColor = userColor(user?.id || '')
  const localUserInitial = (user?.email?.[0] ?? 'U').toUpperCase()

  return (
    <div style={styles.container}>
      {/* ── Access revoked overlay ──────────────────────────────────────── */}
      {accessRevoked && (
        <div style={styles.accessRevokedOverlay}>
          <div style={styles.accessRevokedCard}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
            <h2 style={{ margin: '0 0 8px', color: 'var(--color-text)', fontSize: 20 }}>
              Access Removed
            </h2>
            <p style={{ color: 'var(--color-text-muted)', marginBottom: 24, fontSize: 14, lineHeight: 1.6 }}>
              You no longer have access to this project. Contact the project owner if you think
              this is a mistake.
            </p>
            <Link to="/" style={styles.accessRevokedBtn}>
              Go to Dashboard
            </Link>
          </div>
        </div>
      )}
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          {/* Logo links back to dashboard */}
          <Link to="/" style={styles.logoLink} title="Back to Dashboard">
            <img src="/logo.svg" alt="Underleaf" style={{ height: '22px', width: 'auto' }} />
            <span style={styles.logoText}>Underleaf</span>
          </Link>
          <div style={styles.headerDivider} />
          <h2 style={styles.projectTitle}>{project?.title || 'Loading...'}</h2>
          {/* Presence avatars — you + up to 3 peers + overflow count */}
          <div style={styles.presenceBar}>
            <div
              style={{ ...styles.presenceDot, backgroundColor: localUserColor }}
              title={`${user?.email ?? 'You'} (you)`}
            >
              {localUserInitial}
            </div>
            {connectedUsers.slice(0, 3).map((u) => (
              <div
                key={u.clientId}
                style={{ ...styles.presenceDot, backgroundColor: u.color }}
                title={u.name}
              >
                {u.name[0].toUpperCase()}
              </div>
            ))}
            {connectedUsers.length > 3 && (
              <div
                style={{
                  ...styles.presenceDot,
                  background: 'rgba(255,255,255,0.18)',
                  fontSize: '9px',
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.85)',
                }}
                title={connectedUsers.slice(3).map((u) => u.name).join(', ')}
              >
                +{connectedUsers.length - 3}
              </div>
            )}
          </div>
        </div>
        <div style={styles.headerRight}>
          <Link to="/profile" style={styles.headerBtn} title="Profile & Settings">
            Profile
          </Link>
          <button style={styles.headerBtn} onClick={handleShare} title="Manage collaborators">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>Share
          </button>
          {commenterRole && (
            <button
              style={{
                ...styles.headerBtn,
                ...(showCommentsPanel ? styles.headerBtnActive : {}),
              }}
              onClick={() => setShowCommentsPanel((v) => !v)}
              title="Comments"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Comments
            </button>
          )}
          <button
            style={{
              ...styles.headerBtn,
              ...(showAIPanel ? styles.headerBtnActive : {}),
            }}
            onClick={() => setShowAIPanel((v) => !v)}
            title="AI Assistant"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}}><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>AI
          </button>
          <button style={styles.headerBtn} onClick={handleDownload}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>Download
          </button>
          {editorRole && (
            <button
              style={styles.headerBtn}
              onClick={() => saveFile.mutate()}
              disabled={saving}
            >
              {saving
                ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}} className="animate-spin"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>Saving…</>
                : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}}><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>Save</>}
            </button>
          )}
          {/* Keybinding mode selector */}
          <select
            value={keybindingMode}
            onChange={(e) => setKeybindingMode(e.target.value as KeybindingMode)}
            title="Editor keybinding mode"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 'var(--radius-md)',
              color: '#fff',
              fontSize: '12px',
              padding: '5px 8px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <option value="normal">Normal</option>
            <option value="vim">Vim</option>
            <option value="emacs">Emacs</option>
          </select>
          {editorRole && (
            <select
              value={engine}
              onChange={(e) => {
                const newEngine = e.target.value
                setEngine(newEngine)
                projectsApi.update(projectId!, { engine: newEngine }).catch(() => {})
              }}
              title="LaTeX engine"
              style={{
                background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 'var(--radius-md)',
                color: '#fff',
                fontSize: '12px',
                padding: '5px 8px',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="pdflatex">pdflatex</option>
              <option value="xelatex">xelatex</option>
              <option value="lualatex">lualatex</option>
            </select>
          )}
          {editorRole && (
            <div style={{ display: 'flex', gap: '4px' }}>
              <button
                style={{
                  fontSize: '12px',
                  padding: '6px 10px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 'var(--radius-md)',
                  color: 'rgba(255,255,255,0.75)',
                  cursor: compiling ? 'not-allowed' : 'pointer',
                  opacity: compiling ? 0.5 : 1,
                }}
                onClick={() => compile.mutate(true)}
                disabled={compiling}
                title="Fast syntax check — skips PDF generation"
              >
                Draft
              </button>
              <button
                className="primary"
                onClick={() => compile.mutate(false)}
                disabled={compiling}
                style={{ fontSize: '13px' }}
              >
                {compiling
                  ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}} className="animate-spin"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>Compiling…</>
                  : <><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{marginRight:5,verticalAlign:'middle'}}><polygon points="5 3 19 12 5 21 5 3"/></svg>Compile</>}
              </button>
            </div>
          )}
        </div>
      </header>

      <div style={styles.main}>
        {/* ── Sidebar ──────────────────────────────────────────────────── */}
        <aside
          style={styles.sidebar}
          className="dark-panel"
          onDragOver={handleSidebarDragOver}
          onDragLeave={handleSidebarDragLeave}
          onDrop={handleSidebarDrop}
        >
          {/* Drag-over overlay */}
          {sidebarDragOver && (
            <div style={styles.sidebarDropOverlay}>
              <div style={styles.sidebarDropLabel}>Drop files to upload</div>
            </div>
          )}
          <div style={styles.sidebarHeader}>
            <span style={styles.sidebarLabel}>FILES</span>
            {editorRole && (
              <div style={{ display: 'flex', gap: '2px' }}>
                <button
                  style={styles.sidebarIconBtn}
                  onClick={() => handleCreateFolder('')}
                  title="New folder"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  </svg>
                </button>
                <button
                  style={styles.sidebarIconBtn}
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
                onDuplicateFile={editorRole ? handleDuplicateFile : undefined}
                onDeleteFolder={editorRole ? handleDeleteFolder : undefined}
              />
            )}
            <DocumentOutline
              content={outlineContent}
              onNavigate={handleOutlineNavigate}
            />
            {showAIPanel && (
              <AIPanel
                errorLogs={compileError ? compileLogs || null : null}
                fileContent={content}
                selectedText={selectedText}
              />
            )}
          </div>
        </aside>

        {/* ── Editor ───────────────────────────────────────────────────── */}
        <div style={{ ...styles.editor, display: 'flex', flexDirection: 'column', position: 'relative' }}>
          {/* Project-wide search overlay (Ctrl+Shift+F) */}
          {showSearchPanel && (
            <div
              style={{
                position: 'absolute', top: 0, right: 0, zIndex: 50,
                width: '380px', maxHeight: '70%',
                background: 'var(--color-bg)', border: '1px solid var(--color-border)',
                borderRadius: '0 0 0 var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
                display: 'flex', flexDirection: 'column', overflow: 'hidden',
              }}
              onKeyDown={(e) => { if (e.key === 'Escape') { setShowSearchPanel(false); editorRef.current?.focus() } }}
            >
              <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--color-border)', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0, opacity: 0.5 }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input
                  autoFocus
                  placeholder="Search in project files…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runProjectSearch(searchQuery) }}
                  style={{
                    flex: 1, background: 'transparent', border: 'none', outline: 'none',
                    fontSize: '13px', color: 'var(--color-text)',
                  }}
                />
                {searchLoading && <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>}
                <button onClick={() => { setShowSearchPanel(false); editorRef.current?.focus() }} style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, padding: '2px', color: 'inherit' }}>✕</button>
              </div>
              {searchResults.length > 0 && (
                <div style={{ overflowY: 'auto', fontSize: '12px' }}>
                  {searchResults.map((r, i) => (
                    <div
                      key={i}
                      style={{ padding: '6px 12px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '2px' }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-hover)' }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '' }}
                      onClick={() => {
                        if (r.file !== currentFile) { setCurrentFile(r.file) }
                        setTimeout(() => handleOutlineNavigate(r.line), r.file !== currentFile ? 150 : 0)
                        setShowSearchPanel(false)
                        editorRef.current?.focus()
                      }}
                    >
                      <span style={{ color: 'var(--color-brand)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.file}:{r.line}</span>
                      <span style={{ opacity: 0.65, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.preview}</span>
                    </div>
                  ))}
                </div>
              )}
              {!searchLoading && searchQuery && searchResults.length === 0 && (
                <div style={{ padding: '16px 12px', fontSize: '12px', opacity: 0.5, textAlign: 'center' }}>No results for &ldquo;{searchQuery}&rdquo;</div>
              )}
              {!searchQuery && (
                <div style={{ padding: '12px', fontSize: '12px', opacity: 0.45, textAlign: 'center' }}>Press Enter to search</div>
              )}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            <Editor
              height="100%"
              defaultLanguage="latex"
              theme="vs-light"
              beforeMount={handleEditorBeforeMount}
              onMount={handleEditorMount}
              options={{
                readOnly: !editorRole,
                minimap: { enabled: false },
                fontSize: 14,
                wordWrap: 'on',
                lineNumbers: 'on',
                glyphMargin: true,
                folding: true,
                quickSuggestions: true,
                suggestOnTriggerCharacters: true,
                tabCompletion: 'on',
                renderLineHighlight: 'gutter',
              }}
            />
          </div>
          {/* Status bar — vim mode indicator + word / char count */}
          <div style={{
            height: '22px',
            background: 'var(--color-header-bg)',
            borderTop: '1px solid rgba(255,255,255,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingLeft: '8px',
            paddingRight: '16px',
            gap: '16px',
            fontSize: '11px',
            color: 'rgba(255,255,255,0.45)',
            fontFamily: 'var(--font-mono)',
            flexShrink: 0,
          }}>
            {/* vim status bar target — monaco-vim renders mode text here */}
            <div ref={vimStatusBarRef} style={{ color: 'rgba(255,255,255,0.7)', minWidth: 60 }} />
            <div style={{ display: 'flex', gap: '12px', marginLeft: 'auto', alignItems: 'center' }}>
              <span style={{ opacity: 0.3 }}>Ctrl+Shift+F to search</span>
              {/* Spell check controls */}
              <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={spellEnabled}
                  onChange={(e) => {
                    const enabled = e.target.checked
                    localStorage.setItem('spellCheckEnabled', String(enabled))
                    setSpellEnabled(enabled)
                    if (!enabled) {
                      spellCheckerRef.current?.cleanup()
                      spellCheckerRef.current = null
                    } else if (editorRef.current) {
                      const monacoInst = (window as any).monaco
                      if (monacoInst) {
                        import('../editor/spellChecker').then(({ registerSpellChecker }) => {
                          spellCheckerRef.current = registerSpellChecker(monacoInst, editorRef.current!, spellLocale)
                        })
                      }
                    }
                  }}
                  style={{ accentColor: 'var(--color-brand)', cursor: 'pointer', width: 11, height: 11 }}
                />
                Spell
              </label>
              {spellEnabled && (
                <select
                  value={spellLocale}
                  onChange={(e) => setSpellLocale(e.target.value as SpellLocale)}
                  title="Spell check language"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(255,255,255,0.45)',
                    fontSize: '11px',
                    cursor: 'pointer',
                    outline: 'none',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  <option value="en-us">en-US</option>
                  <option value="en-gb">en-GB</option>
                </select>
              )}
              <span>{wordCount.toLocaleString()} words</span>
              <span>{charCount.toLocaleString()} chars</span>
            </div>
          </div>
        </div>

        {/* Comments panel */}
        {showCommentsPanel && projectId && myRole && (
          <CommentsPanel
            projectId={projectId}
            currentFile={currentFile}
            focusLine={commentFocusLine}
            role={myRole}
          />
        )}

        {/* Splitter */}
        <div style={styles.splitter} onMouseDown={handleSplitterMouseDown} />

        {/* ── Output Panel (PDF / Logs / Files) ────────────────────────── */}
        <aside style={{ ...styles.preview, width: `${previewWidth}px` }}>
          {/* Tab bar */}
          <div style={styles.previewHeader}>
            <div style={styles.tabBar}>
              {(['pdf', 'logs', 'files', 'history'] as const).map((tab) => (
                <button
                  key={tab}
                  style={{
                    ...styles.tab,
                    ...(previewTab === tab ? styles.tabActive : {}),
                  }}
                  onClick={() => setPreviewTab(tab)}
                >
                  {tab === 'pdf' ? 'PDF' : tab === 'logs' ? 'Logs' : tab === 'files' ? 'Files' : 'History'}
                  {tab === 'logs' && compileLogs && (logErrorCount > 0 || logWarningCount > 0) && (
                    <span style={styles.logsBadge}>
                      {logErrorCount > 0 && (
                        <span style={styles.logsBadgeError}>{logErrorCount}E</span>
                      )}
                      {logWarningCount > 0 && (
                        <span style={styles.logsBadgeWarn}>{logWarningCount}W</span>
                      )}
                    </span>
                  )}
                  {tab === 'logs' && compileError && logErrorCount === 0 && logWarningCount === 0 && (
                    <span style={styles.tabErrorDot} />
                  )}
                  {tab === 'history' && snapshots.length > 0 && (
                    <span style={{ marginLeft: 4, opacity: 0.6, fontSize: '10px' }}>
                      {snapshots.length}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {pdfUrl && (
              <a
                href={pdfUrl}
                download={`${project?.title ?? 'output'}.pdf`}
                title="Download PDF"
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '4px',
                  color: '#ccc',
                  textDecoration: 'none',
                  flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >
                ↓ PDF
              </a>
            )}
            {editorRole && (
              <button
                className="primary"
                style={{ fontSize: '11px', padding: '4px 10px', flexShrink: 0 }}
                onClick={() => compile.mutate(false)}
                disabled={compiling}
              >
                {compiling
                  ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin"><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                  : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
              </button>
            )}
          </div>

          {/* Tab content */}
          <div style={styles.previewContent}>
            {/* ── PDF tab ── */}
            {previewTab === 'pdf' && (
              compiling ? (
                <div style={styles.previewEmpty}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ marginBottom: '12px', color: 'var(--color-brand)' }}><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                  <p style={styles.previewEmptyText}>Compiling…</p>
                </div>
              ) : historyPdfUrl ? (
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{
                    padding: '6px 10px',
                    background: 'rgba(26,127,75,0.12)',
                    borderBottom: '1px solid var(--color-border)',
                    fontSize: '11px',
                    color: 'var(--color-brand)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                  }}>
                    <span>Historical build</span>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '11px', padding: 0 }}
                      onClick={() => {
                        URL.revokeObjectURL(historyPdfUrl)
                        setHistoryPdfUrl(null)
                      }}
                    >
                      ✕ Back to current
                    </button>
                  </div>
                  <PDFViewer url={historyPdfUrl} />
                </div>
              ) : pdfUrl ? (
                <PDFViewer
                  url={pdfUrl}
                  onDoubleClick={syncTeXData ? handlePDFDoubleClick : undefined}
                />
              ) : (
                <div style={styles.previewEmpty}>
                  <div style={styles.previewEmptyIcon}>
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                      <line x1="12" y1="18" x2="12" y2="12"/>
                      <line x1="9" y1="15" x2="15" y2="15"/>
                    </svg>
                  </div>
                  <p style={styles.previewEmptyText}>
                    {compileError
                      ? <><span style={{ color: 'var(--color-error)' }}>Compilation failed.</span> Check the Logs tab.</>
                      : <>Click <strong>▶ Compile</strong> to render your PDF</>}
                  </p>
                </div>
              )
            )}

            {/* ── Logs tab ── */}
            {previewTab === 'logs' && (
              compileLogs ? (
                <div style={styles.logsContainer}>
                  {compileError && (
                    <div style={styles.logsError}>
                      ✕ {compileError}
                    </div>
                  )}
                  {!compileError && (
                    <div style={styles.logsSuccess}>
                      ✓ Compilation succeeded
                      {compileDuration !== null && (
                        <span style={{ marginLeft: '8px', opacity: 0.7, fontSize: '11px' }}>
                          ({compileDuration.toFixed(1)}s)
                        </span>
                      )}
                    </div>
                  )}
                  {/* ── Issues list (Feature A) ── */}
                  {logIssues.length > 0 && (
                    <div style={styles.issuesPanel}>
                      <button
                        style={styles.issuesToggle}
                        onClick={() => setIssuesExpanded((v) => !v)}
                      >
                        <span style={styles.issuesToggleIcon}>{issuesExpanded ? '▾' : '▸'}</span>
                        Issues
                        <span style={styles.issuesSummary}>
                          {logErrorCount > 0 && (
                            <span style={styles.issuesBadgeError}>{logErrorCount} error{logErrorCount !== 1 ? 's' : ''}</span>
                          )}
                          {logWarningCount > 0 && (
                            <span style={styles.issuesBadgeWarn}>{logWarningCount} warning{logWarningCount !== 1 ? 's' : ''}</span>
                          )}
                        </span>
                      </button>
                      {issuesExpanded && (
                        <div style={styles.issuesList}>
                          {logIssues.map((issue, idx) => {
                            const shortFile = issue.file.split('/').pop() ?? issue.file
                            const shortMsg = issue.message.length > 80
                              ? issue.message.slice(0, 80) + '…'
                              : issue.message
                            return (
                              <button
                                key={idx}
                                style={styles.issueItem}
                                onClick={() => {
                                  if (issue.line > 0) {
                                    const resolvedFile = resolveLogFilePath(issue.file, files ?? [])
                                    if (resolvedFile !== currentFile) setCurrentFile(resolvedFile)
                                    setTimeout(() => {
                                      editorRef.current?.revealLineInCenter(issue.line)
                                      editorRef.current?.setPosition({ lineNumber: issue.line, column: 1 })
                                      editorRef.current?.focus()
                                    }, 50)
                                  }
                                }}
                                title={issue.message}
                              >
                                <span style={{
                                  ...styles.issueDot,
                                  backgroundColor: issue.type === 'error' ? '#ef4444' : '#f59e0b',
                                }} />
                                <span style={styles.issueFile}>
                                  {shortFile}{issue.line > 0 ? `:${issue.line}` : ''}
                                </span>
                                <span style={styles.issueMsg}>{shortMsg}</span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <pre style={styles.logsContent}>{compileLogs}</pre>
                </div>
              ) : (
                <div style={styles.previewEmpty}>
                  {compiling ? (
                    <>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin" style={{ marginBottom: '12px', color: 'var(--color-brand)' }}><circle cx="12" cy="12" r="10" strokeOpacity="0.25"/><path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/></svg>
                      <p style={styles.previewEmptyText}>Compiling — logs will appear here…</p>
                    </>
                  ) : (
                    <p style={styles.previewEmptyText}>No logs yet. Compile your project first.</p>
                  )}
                </div>
              )
            )}

            {/* ── History tab ── */}
            {previewTab === 'history' && (
              <div style={styles.filesList}>
                {historyPdfUrl && (
                  <div style={{
                    padding: '8px 10px',
                    background: 'rgba(26,127,75,0.12)',
                    borderBottom: '1px solid var(--color-border)',
                    fontSize: '11px',
                    color: 'var(--color-brand)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                  }}>
                    <span>Viewing historical build</span>
                    <button
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontSize: '11px', padding: 0 }}
                      onClick={() => {
                        URL.revokeObjectURL(historyPdfUrl)
                        setHistoryPdfUrl(null)
                        setPreviewTab('pdf')
                      }}
                    >
                      ✕ Back to current
                    </button>
                  </div>
                )}
                {snapshots.length === 0 ? (
                  <div style={styles.previewEmpty}>
                    <p style={styles.previewEmptyText}>
                      No snapshots yet. Each successful compile creates one automatically.
                    </p>
                  </div>
                ) : (
                  snapshots.map((snap) => {
                    const date = new Date(snap.created_at)
                    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
                    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
                    const isEditing = editingLabelId === snap.id
                    return (
                      <div key={snap.id} style={{
                        ...styles.fileItem,
                        flexDirection: 'column',
                        alignItems: 'stretch',
                        gap: '6px',
                        padding: '8px 10px',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span style={styles.fileItemIcon}>📸</span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            {isEditing ? (
                              <input
                                autoFocus
                                value={editingLabelText}
                                onChange={(e) => setEditingLabelText(e.target.value)}
                                onBlur={async () => {
                                  if (editingLabelText.trim() !== (snap.label ?? '')) {
                                    try {
                                      await snapshotsApi.updateLabel(projectId!, snap.id, editingLabelText.trim())
                                      queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] })
                                    } catch {
                                      toast.error('Failed to update label')
                                    }
                                  }
                                  setEditingLabelId(null)
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                                  if (e.key === 'Escape') setEditingLabelId(null)
                                }}
                                style={{
                                  width: '100%',
                                  background: 'var(--color-input-bg)',
                                  border: '1px solid var(--color-border)',
                                  borderRadius: '4px',
                                  color: 'var(--color-text)',
                                  fontSize: '12px',
                                  padding: '2px 6px',
                                  outline: 'none',
                                }}
                              />
                            ) : (
                              <div
                                style={{ fontSize: '12px', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: editorRole ? 'text' : 'default', color: 'var(--color-text)' }}
                                title={editorRole ? 'Click to rename' : undefined}
                                onClick={() => {
                                  if (!editorRole) return
                                  setEditingLabelId(snap.id)
                                  setEditingLabelText(snap.label ?? '')
                                }}
                              >
                                {snap.label || <span style={{ opacity: 0.45 }}>{dateStr} {timeStr}</span>}
                              </div>
                            )}
                            {snap.label && (
                              <div style={{ fontSize: '10px', opacity: 0.5 }}>{dateStr} {timeStr}</div>
                            )}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end' }}>
                          {snap.artifact_ref && (
                            <>
                              <button
                                style={{ fontSize: '11px', padding: '3px 8px', background: 'var(--color-brand)', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer' }}
                                onClick={async () => {
                                  try {
                                    const res = await snapshotsApi.getArtifact(projectId!, snap.id)
                                    const blob = new Blob([res.data], { type: 'application/pdf' })
                                    const url = URL.createObjectURL(blob)
                                    setHistoryPdfUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url })
                                    setPreviewTab('pdf')
                                  } catch {
                                    toast.error('Failed to load historical PDF')
                                  }
                                }}
                              >
                                View PDF
                              </button>
                              <a
                                href="#"
                                style={{ fontSize: '11px', padding: '3px 8px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#aaa', cursor: 'pointer', textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
                                onClick={async (e) => {
                                  e.preventDefault()
                                  try {
                                    const res = await snapshotsApi.getArtifact(projectId!, snap.id)
                                    const blob = new Blob([res.data], { type: 'application/pdf' })
                                    const url = URL.createObjectURL(blob)
                                    const a = document.createElement('a')
                                    a.href = url
                                    a.download = `${snap.label || dateStr}.pdf`
                                    a.click()
                                    URL.revokeObjectURL(url)
                                  } catch {
                                    toast.error('Failed to download')
                                  }
                                }}
                              >
                                ↓
                              </a>
                            </>
                          )}
                          {editorRole && (
                            <button
                              style={{ fontSize: '11px', padding: '3px 6px', background: 'none', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', color: '#888', cursor: 'pointer' }}
                              title="Delete snapshot"
                              onClick={async () => {
                                if (!confirm('Delete this snapshot?')) return
                                try {
                                  await snapshotsApi.delete(projectId!, snap.id)
                                  queryClient.invalidateQueries({ queryKey: ['snapshots', projectId] })
                                  toast.success('Snapshot deleted')
                                  if (historyPdfUrl) {
                                    URL.revokeObjectURL(historyPdfUrl)
                                    setHistoryPdfUrl(null)
                                  }
                                } catch {
                                  toast.error('Failed to delete snapshot')
                                }
                              }}
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {/* ── Files tab ── */}
            {previewTab === 'files' && (
              <div style={styles.filesList}>
                <button
                  style={{ ...styles.fileItem, cursor: 'pointer' }}
                  onClick={async () => {
                    try {
                      const res = await projectsApi.exportZip(projectId!)
                      const blob = new Blob([res.data], { type: 'application/zip' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a')
                      a.href = url
                      a.download = `${project?.title ?? 'project'}.zip`
                      a.click()
                      URL.revokeObjectURL(url)
                    } catch {
                      toast.error('Failed to export ZIP')
                    }
                  }}
                >
                  <span style={styles.fileItemIcon}>📦</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={styles.fileItemName}>{project?.title ?? 'project'}.zip</div>
                    <div style={styles.fileItemMeta}>Download all source files</div>
                  </div>
                  <span style={styles.fileItemDownload}>↓</span>
                </button>
                {lastJobId ? (
                  <>
                    {pdfUrl && (
                      <a
                        href={pdfUrl}
                        download={`${project?.title ?? 'output'}.pdf`}
                        style={styles.fileItem}
                      >
                        <span style={styles.fileItemIcon}>📄</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={styles.fileItemName}>{project?.title ?? 'output'}.pdf</div>
                          <div style={styles.fileItemMeta}>PDF document</div>
                        </div>
                        <span style={styles.fileItemDownload}>↓</span>
                      </a>
                    )}
                    {compileLogs && (
                      <button
                        style={styles.fileItem}
                        onClick={() => downloadText(compileLogs, 'output.log')}
                      >
                        <span style={styles.fileItemIcon}>📋</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={styles.fileItemName}>output.log</div>
                          <div style={styles.fileItemMeta}>Compilation log</div>
                        </div>
                        <span style={styles.fileItemDownload}>↓</span>
                      </button>
                    )}
                    {syncTeXData && (
                      <button
                        style={styles.fileItem}
                        onClick={() => downloadSyncTeX(lastJobId)}
                      >
                        <span style={styles.fileItemIcon}>🔗</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={styles.fileItemName}>output.synctex.gz</div>
                          <div style={styles.fileItemMeta}>SyncTeX source-link data</div>
                        </div>
                        <span style={styles.fileItemDownload}>↓</span>
                      </button>
                    )}
                  </>
                ) : null}
              </div>
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
    padding: '0 16px',
    height: '50px',
    backgroundColor: 'var(--color-header-bg)',
    borderBottom: '1px solid var(--color-header-border)',
    flexShrink: 0,
    zIndex: 10,
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    overflow: 'hidden',
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexShrink: 0,
  },
  logoLink: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    textDecoration: 'none',
    flexShrink: 0,
    opacity: 0.9,
    transition: 'opacity var(--transition-fast)',
  },
  logoText: {
    fontSize: '13px',
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: '0.02em',
  },
  headerDivider: {
    width: '1px',
    height: '18px',
    backgroundColor: 'rgba(255,255,255,0.15)',
    flexShrink: 0,
  },
  projectTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'rgba(255,255,255,0.9)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    maxWidth: '260px',
  },
  presenceBar: {
    display: 'flex',
    gap: '4px',
    marginLeft: '4px',
    flexShrink: 0,
  },
  presenceDot: {
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '10px',
    fontWeight: 700,
    color: 'white',
    flexShrink: 0,
    border: '2px solid rgba(255,255,255,0.2)',
  },
  headerBtn: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.8)',
    padding: '5px 10px',
    borderRadius: 'var(--radius-md)',
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'background var(--transition-fast)',
    whiteSpace: 'nowrap' as const,
  },
  headerBtnActive: {
    background: 'rgba(26, 127, 75, 0.35)',
    borderColor: 'rgba(26, 127, 75, 0.6)',
    color: '#4ade80',
  },
  main: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  sidebar: {
    width: '220px',
    backgroundColor: 'var(--color-sidebar-bg)',
    borderRight: '1px solid var(--color-sidebar-border)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
    position: 'relative' as const,
  },
  sidebarHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid var(--color-sidebar-border)',
    flexShrink: 0,
  },
  sidebarLabel: {
    fontSize: '10px',
    fontWeight: 700,
    letterSpacing: '0.08em',
    color: 'var(--color-sidebar-text-muted)',
    textTransform: 'uppercase' as const,
  },
  sidebarIconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '3px 5px',
    fontSize: '13px',
    borderRadius: '4px',
    color: 'var(--color-sidebar-text-muted)',
    transition: 'background var(--transition-fast), color var(--transition-fast)',
  },
  sidebarContent: {
    flex: 1,
    overflow: 'auto',
  },
  editor: {
    flex: 1,
    overflow: 'hidden',
  },
  splitter: {
    width: '4px',
    cursor: 'col-resize',
    backgroundColor: 'var(--color-border)',
    flexShrink: 0,
    transition: 'background var(--transition-fast)',
  },
  preview: {
    backgroundColor: 'var(--color-surface-alt)',
    borderLeft: '1px solid var(--color-border)',
    display: 'flex',
    flexDirection: 'column',
    flexShrink: 0,
  },
  previewHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '0 10px 0 0',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  tabBar: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
  },
  tab: {
    padding: '10px 14px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--color-text-muted)',
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    whiteSpace: 'nowrap' as const,
    transition: 'color 0.15s, border-color 0.15s',
  },
  tabActive: {
    color: 'var(--color-brand)',
    borderBottom: '2px solid var(--color-brand)',
    fontWeight: 600,
  },
  tabErrorDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: 'var(--color-error)',
    display: 'inline-block',
    flexShrink: 0,
  },
  previewContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  previewEmpty: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    padding: '24px',
    color: 'var(--color-text-light)',
  },
  previewEmptyIcon: {
    color: 'var(--color-border)',
    marginBottom: '4px',
  },
  previewEmptyText: {
    fontSize: '13px',
    color: 'var(--color-text-muted)',
    textAlign: 'center' as const,
    lineHeight: 1.6,
  },
  logsContainer: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    overflow: 'hidden',
  },
  logsError: {
    padding: '8px 14px',
    backgroundColor: '#fef2f2',
    color: '#dc2626',
    fontWeight: 600,
    fontSize: '12px',
    borderBottom: '1px solid #fecaca',
    flexShrink: 0,
  },
  logsSuccess: {
    padding: '8px 14px',
    backgroundColor: '#f0fdf4',
    color: '#16a34a',
    fontWeight: 600,
    fontSize: '12px',
    borderBottom: '1px solid #bbf7d0',
    flexShrink: 0,
  },
  logsContent: {
    flex: 1,
    margin: 0,
    padding: '12px 16px',
    fontSize: '11.5px',
    lineHeight: '1.5',
    overflow: 'auto',
    backgroundColor: '#0f1117',
    color: '#c9d1d9',
    fontFamily: '"Fira Code", "Cascadia Code", monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  filesList: {
    flex: 1,
    overflow: 'auto',
    padding: '10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  fileItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 12px',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    cursor: 'pointer',
    textDecoration: 'none',
    color: 'var(--color-text)',
    fontSize: '13px',
    transition: 'background 0.15s',
    textAlign: 'left' as const,
    width: '100%',
    boxSizing: 'border-box' as const,
  },
  fileItemIcon: {
    fontSize: '20px',
    flexShrink: 0,
  },
  fileItemName: {
    fontWeight: 600,
    fontSize: '13px',
    color: 'var(--color-text)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fileItemMeta: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    marginTop: '1px',
  },
  fileItemDownload: {
    fontSize: '16px',
    color: 'var(--color-brand)',
    flexShrink: 0,
    fontWeight: 700,
  },
  modalOverlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    backdropFilter: 'blur(4px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  },
  modal: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-xl)',
    padding: '24px',
    width: '400px',
    maxWidth: '90vw',
    boxShadow: 'var(--shadow-xl)',
  },
  modalInput: {
    width: '100%',
    padding: '9px 12px',
    fontSize: '14px',
    border: '1.5px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    boxSizing: 'border-box' as const,
    marginBottom: '16px',
  },
  modalButtons: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
  },
  accessRevokedOverlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.75)',
    backdropFilter: 'blur(6px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  accessRevokedCard: {
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-xl)',
    padding: '40px 48px',
    textAlign: 'center' as const,
    maxWidth: 420,
    boxShadow: 'var(--shadow-xl)',
    border: '1px solid var(--color-border)',
  },
  accessRevokedBtn: {
    display: 'inline-block',
    padding: '10px 28px',
    backgroundColor: 'var(--color-brand)',
    color: '#fff',
    borderRadius: 'var(--radius-md)',
    textDecoration: 'none',
    fontWeight: 600,
    fontSize: 14,
  },
  // ── Feature A: log issues panel ──────────────────────────────────────
  logsBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '3px',
    marginLeft: '4px',
  },
  logsBadgeError: {
    backgroundColor: '#ef4444',
    color: '#fff',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 700,
    padding: '1px 4px',
    lineHeight: 1.4,
  },
  logsBadgeWarn: {
    backgroundColor: '#f59e0b',
    color: '#fff',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 700,
    padding: '1px 4px',
    lineHeight: 1.4,
  },
  issuesPanel: {
    flexShrink: 0,
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    maxHeight: '220px',
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  issuesToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '7px 12px',
    fontSize: '11px',
    fontWeight: 600,
    color: '#c9d1d9',
    background: 'rgba(255,255,255,0.04)',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    cursor: 'pointer',
    textAlign: 'left' as const,
    flexShrink: 0,
    width: '100%',
  },
  issuesToggleIcon: {
    fontSize: '10px',
    width: '12px',
    display: 'inline-block',
  },
  issuesSummary: {
    display: 'flex',
    gap: '4px',
    marginLeft: 'auto',
  },
  issuesBadgeError: {
    backgroundColor: '#ef4444',
    color: '#fff',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 700,
    padding: '1px 5px',
  },
  issuesBadgeWarn: {
    backgroundColor: '#f59e0b',
    color: '#fff',
    borderRadius: '3px',
    fontSize: '9px',
    fontWeight: 700,
    padding: '1px 5px',
  },
  issuesList: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  issueItem: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    padding: '5px 12px',
    fontSize: '11px',
    background: 'none',
    border: 'none',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    cursor: 'pointer',
    width: '100%',
    textAlign: 'left' as const,
    color: '#c9d1d9',
    lineHeight: 1.4,
    transition: 'background 0.1s',
  },
  issueDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    display: 'inline-block',
    flexShrink: 0,
    marginTop: '3px',
  },
  issueFile: {
    flexShrink: 0,
    fontWeight: 600,
    color: '#94a3b8',
    fontSize: '10px',
  },
  issueMsg: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
    minWidth: 0,
  },
  // ── Feature B: sidebar drop overlay ──────────────────────────────────
  sidebarDropOverlay: {
    position: 'absolute' as const,
    inset: 0,
    zIndex: 50,
    border: '2px dashed rgba(26,127,75,0.7)',
    borderRadius: '4px',
    backgroundColor: 'rgba(26,127,75,0.12)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none' as const,
  },
  sidebarDropLabel: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#4ade80',
    textAlign: 'center' as const,
    padding: '8px',
  },
}
