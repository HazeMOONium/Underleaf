import { useState, useRef, useEffect } from 'react'

type AIMode = 'explain_error' | 'suggest' | 'rewrite'

interface AIPanelProps {
  /** Compile error logs — when provided, auto-populates explain_error mode */
  errorLogs?: string | null
  /** Current file content — used for suggest mode */
  fileContent?: string
  /** Currently selected text in editor — used for rewrite mode */
  selectedText?: string
}

const MODE_LABELS: Record<AIMode, string> = {
  explain_error: 'Explain Error',
  suggest: 'Suggest',
  rewrite: 'Rewrite',
}

export default function AIPanel({ errorLogs, fileContent, selectedText }: AIPanelProps) {
  const [mode, setMode] = useState<AIMode>('explain_error')
  const [instruction, setInstruction] = useState('')
  const [response, setResponse] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const responseEndRef = useRef<HTMLDivElement>(null)

  // Auto-switch to explain_error when error logs arrive
  useEffect(() => {
    if (errorLogs) {
      setMode('explain_error')
    }
  }, [errorLogs])

  // Auto-scroll response to bottom as it streams
  useEffect(() => {
    responseEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [response])

  const getContext = (): string => {
    if (mode === 'explain_error') return errorLogs || ''
    if (mode === 'suggest') return fileContent || ''
    return selectedText || fileContent || ''
  }

  const handleSubmit = async () => {
    const context = getContext()
    if (!context && mode !== 'suggest') {
      setError(
        mode === 'explain_error'
          ? 'No compile error logs available. Compile first.'
          : 'No text selected.',
      )
      return
    }

    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setStreaming(true)
    setResponse('')
    setError(null)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/v1/ai/assist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ mode, context, instruction }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `Request failed (${res.status})`)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const payload = JSON.parse(line.slice(6))
            if (payload.text) {
              setResponse((prev) => prev + payload.text)
            }
            if (payload.error) {
              setError(payload.error)
            }
          } catch {
            // skip malformed line
          }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setError(e.message || 'Request failed')
      }
    } finally {
      setStreaming(false)
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
    setStreaming(false)
  }

  const handleCopy = () => {
    if (response) navigator.clipboard.writeText(response)
  }

  const contextLabel = () => {
    if (mode === 'explain_error') return errorLogs ? 'Using compile error logs' : 'No error logs yet'
    if (mode === 'suggest') return 'Using current file content'
    return selectedText ? 'Using selected text' : 'Using file content (no selection)'
  }

  return (
    <div style={styles.container}>
      {/* Mode tabs */}
      <div style={styles.tabs}>
        {(Object.keys(MODE_LABELS) as AIMode[]).map((m) => (
          <button
            key={m}
            style={{ ...styles.tab, ...(mode === m ? styles.tabActive : {}) }}
            onClick={() => {
              setMode(m)
              setResponse('')
              setError(null)
            }}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Context hint */}
      <p style={styles.contextHint}>{contextLabel()}</p>

      {/* Instruction input (optional for suggest/rewrite) */}
      {(mode === 'suggest' || mode === 'rewrite') && (
        <input
          style={styles.instructionInput}
          type="text"
          placeholder={
            mode === 'suggest' ? 'Instruction (optional)…' : 'Rewrite instruction (optional)…'
          }
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !streaming) handleSubmit()
          }}
        />
      )}

      {/* Actions */}
      <div style={styles.actions}>
        <button
          style={{ ...styles.btn, ...styles.btnPrimary }}
          onClick={streaming ? handleStop : handleSubmit}
        >
          {streaming ? '⏹ Stop' : '✨ Ask AI'}
        </button>
        {response && !streaming && (
          <button style={{ ...styles.btn, ...styles.btnSecondary }} onClick={handleCopy}>
            Copy
          </button>
        )}
      </div>

      {/* Error */}
      {error && <p style={styles.errorText}>{error}</p>}

      {/* Streaming response */}
      {(response || streaming) && (
        <div style={styles.responseBox}>
          <pre style={styles.responsePre}>{response}</pre>
          {streaming && <span style={styles.cursor}>▌</span>}
          <div ref={responseEndRef} />
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    padding: '10px 12px',
    borderTop: '1px solid var(--color-border)',
  },
  tabs: {
    display: 'flex',
    gap: '4px',
  },
  tab: {
    flex: 1,
    padding: '4px 0',
    fontSize: '11px',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    cursor: 'pointer',
    background: 'none',
    color: 'var(--color-text-muted)',
  },
  tabActive: {
    backgroundColor: 'var(--color-primary)',
    color: 'white',
    borderColor: 'var(--color-primary)',
  },
  contextHint: {
    fontSize: '11px',
    color: 'var(--color-text-muted)',
    margin: 0,
  },
  instructionInput: {
    width: '100%',
    fontSize: '12px',
    padding: '5px 8px',
    border: '1px solid var(--color-border)',
    borderRadius: '4px',
    boxSizing: 'border-box' as const,
    outline: 'none',
  },
  actions: {
    display: 'flex',
    gap: '6px',
  },
  btn: {
    padding: '5px 12px',
    fontSize: '12px',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontWeight: 500,
  },
  btnPrimary: {
    backgroundColor: 'var(--color-primary)',
    color: 'white',
  },
  btnSecondary: {
    backgroundColor: 'var(--color-border)',
    color: 'var(--color-text)',
  },
  errorText: {
    fontSize: '12px',
    color: '#dc2626',
    margin: 0,
  },
  responseBox: {
    maxHeight: '220px',
    overflowY: 'auto',
    backgroundColor: '#1e1e1e',
    borderRadius: '4px',
    padding: '8px 10px',
    position: 'relative' as const,
  },
  responsePre: {
    margin: 0,
    fontSize: '12px',
    lineHeight: '1.5',
    color: '#d4d4d4',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    fontFamily: 'monospace',
  },
  cursor: {
    color: '#d4d4d4',
    animation: 'blink 1s step-end infinite',
    fontSize: '12px',
  },
}
