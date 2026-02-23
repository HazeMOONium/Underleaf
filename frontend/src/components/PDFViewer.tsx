import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// Set up worker for pdfjs-dist v5
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

interface PDFViewerProps {
  /** Object URL or data URL of the PDF to display */
  url: string
  /** Called when user double-clicks in the PDF; yRatio ∈ [0,1] top→bottom */
  onDoubleClick?: (page: number, yRatio: number) => void
}

export default function PDFViewer({ url, onDoubleClick }: PDFViewerProps) {
  const [numPages, setNumPages] = useState(0)
  const [scale, setScale] = useState(1.5)
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const renderTasksRef = useRef<pdfjsLib.RenderTask[]>([])

  // Load PDF document
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      // Cancel any in-progress render tasks
      for (const task of renderTasksRef.current) {
        task.cancel()
      }
      renderTasksRef.current = []

      pdfDocRef.current?.destroy()
      pdfDocRef.current = null

      const loadingTask = pdfjsLib.getDocument(url)
      const pdf = await loadingTask.promise
      if (cancelled) {
        pdf.destroy()
        return
      }
      pdfDocRef.current = pdf
      setNumPages(pdf.numPages)
    }

    load().catch(console.error)

    return () => {
      cancelled = true
      for (const task of renderTasksRef.current) {
        task.cancel()
      }
    }
  }, [url])

  // Render pages whenever numPages or scale changes
  useEffect(() => {
    if (!numPages || !pdfDocRef.current) return

    // Cancel any prior render tasks
    for (const task of renderTasksRef.current) {
      task.cancel()
    }
    renderTasksRef.current = []

    const renderAll = async () => {
      const pdf = pdfDocRef.current!
      for (let i = 1; i <= numPages; i++) {
        const canvas = canvasRefs.current[i - 1]
        if (!canvas) continue

        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale })
        canvas.width = viewport.width
        canvas.height = viewport.height

        const task = page.render({ canvas, viewport })
        renderTasksRef.current.push(task)
        try {
          await task.promise
        } catch {
          // Cancelled — ignore
        }
      }
    }

    renderAll().catch(console.error)
  }, [numPages, scale])

  const handleDoubleClick = (pageIndex: number, e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onDoubleClick) return
    const canvas = canvasRefs.current[pageIndex]
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const yRatio = (e.clientY - rect.top) / rect.height
    onDoubleClick(pageIndex + 1, Math.max(0, Math.min(1, yRatio)))
  }

  return (
    <div style={styles.container}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button
          style={styles.scaleBtn}
          onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))}
          title="Zoom out"
        >
          −
        </button>
        <span style={styles.scaleLabel}>{Math.round(scale * 100)}%</span>
        <button
          style={styles.scaleBtn}
          onClick={() => setScale((s) => Math.min(3, +(s + 0.25).toFixed(2)))}
          title="Zoom in"
        >
          +
        </button>
        {onDoubleClick && (
          <span style={styles.hint}>Double-click to jump to source</span>
        )}
      </div>

      {/* Pages */}
      <div style={styles.pages}>
        {Array.from({ length: numPages }, (_, i) => (
          <div key={i} style={styles.pageWrapper}>
            <canvas
              ref={(el) => {
                canvasRefs.current[i] = el
              }}
              onDoubleClick={(e) => handleDoubleClick(i, e)}
              style={styles.canvas}
            />
          </div>
        ))}
        {numPages === 0 && <p style={styles.loading}>Loading PDF…</p>}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    backgroundColor: '#525659',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    backgroundColor: '#3a3c3e',
    borderBottom: '1px solid #222',
    flexShrink: 0,
  },
  scaleBtn: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#ddd',
    borderRadius: '3px',
    cursor: 'pointer',
    padding: '2px 8px',
    fontSize: '16px',
    lineHeight: 1,
  },
  scaleLabel: {
    color: '#ccc',
    fontSize: '12px',
    minWidth: '42px',
    textAlign: 'center',
  },
  hint: {
    color: '#888',
    fontSize: '11px',
    marginLeft: '8px',
  },
  pages: {
    flex: 1,
    overflowY: 'auto',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
  },
  pageWrapper: {
    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
  },
  canvas: {
    display: 'block',
    cursor: 'crosshair',
  },
  loading: {
    color: '#aaa',
    marginTop: '40px',
  },
}
