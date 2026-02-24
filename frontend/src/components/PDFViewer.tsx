import { useEffect, useRef, useState, useCallback } from 'react'
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
  // renderScale: what the canvases are actually rendered at (triggers re-render)
  // displayScale: what's shown in the toolbar (updates immediately during gesture)
  const [renderScale, setRenderScale] = useState(1.0)
  const [displayScale, setDisplayScale] = useState(1.0)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([])
  const textLayerRefs = useRef<(HTMLDivElement | null)[]>([])
  const pageWrapperRefs = useRef<(HTMLDivElement | null)[]>([])
  const renderTasksRef = useRef<pdfjsLib.RenderTask[]>([])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const pagesRef = useRef<HTMLDivElement | null>(null)
  // Inner wrapper that receives CSS transform during gesture (no canvas re-render)
  const pagesInnerRef = useRef<HTMLDivElement | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // Refs so wheel handler closures always see the latest values
  const renderScaleRef = useRef(1.0)
  const cssZoomRef = useRef(1.0)    // accumulated gesture factor, reset after commit
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Commit a new scale immediately (used by +/− buttons).
  // Cancels any pending gesture-debounce and triggers a canvas re-render.
  const applyScale = useCallback((newScale: number) => {
    const clamped = Math.min(4, Math.max(0.25, newScale))
    if (debounceRef.current) clearTimeout(debounceRef.current)
    cssZoomRef.current = 1
    if (pagesInnerRef.current) pagesInnerRef.current.style.transform = 'none'
    renderScaleRef.current = clamped
    setRenderScale(clamped)
    setDisplayScale(clamped)
  }, [])

  // Ctrl+scroll: CSS transform for instant visual feedback, debounced re-render.
  // This prevents the canvas-clear flicker that happens when every wheel event
  // changes renderScale and forces an immediate re-render of all pages.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()

      // Normalize: deltaMode 1 = lines → approx pixels
      const rawDelta = e.deltaMode === 1 ? e.deltaY * 10 : e.deltaY
      const factor = Math.exp(-rawDelta / 1000)

      // Keep the overall clamped in [0.25, 4]
      const newCssZoom = Math.min(
        4 / renderScaleRef.current,
        Math.max(0.25 / renderScaleRef.current, cssZoomRef.current * factor),
      )
      cssZoomRef.current = newCssZoom

      // Toolbar shows committed × visual
      setDisplayScale(renderScaleRef.current * newCssZoom)

      // Instant visual feedback: scale the page wrapper via CSS (no canvas touched)
      if (pagesInnerRef.current) {
        pagesInnerRef.current.style.transform = `scale(${newCssZoom})`
        pagesInnerRef.current.style.transformOrigin = 'top center'
      }

      // After gesture settles, commit and trigger one high-quality re-render
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const committed = Math.min(4, Math.max(0.25, renderScaleRef.current * cssZoomRef.current))
        cssZoomRef.current = 1
        if (pagesInnerRef.current) pagesInnerRef.current.style.transform = 'none'
        renderScaleRef.current = committed
        setRenderScale(committed)
        setDisplayScale(committed)
      }, 300)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Load PDF document
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      for (const t of renderTasksRef.current) t.cancel()
      renderTasksRef.current = []
      pdfDocRef.current?.destroy()
      pdfDocRef.current = null

      const pdf = await pdfjsLib.getDocument(url).promise
      if (cancelled) {
        pdf.destroy()
        return
      }
      pdfDocRef.current = pdf
      setNumPages(pdf.numPages)
      setCurrentPage(1)
      setPageInput('1')
    }

    load().catch(console.error)

    return () => {
      cancelled = true
      for (const t of renderTasksRef.current) t.cancel()
    }
  }, [url])

  // Render pages whenever the PDF or the committed renderScale changes.
  // NOT triggered by displayScale — that's purely visual during gestures.
  useEffect(() => {
    if (!numPages || !pdfDocRef.current) return

    for (const t of renderTasksRef.current) t.cancel()
    renderTasksRef.current = []

    const renderAll = async () => {
      const pdf = pdfDocRef.current!
      for (let i = 1; i <= numPages; i++) {
        const canvas = canvasRefs.current[i - 1]
        const textDiv = textLayerRefs.current[i - 1]
        if (!canvas) continue

        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: renderScale })
        canvas.width = viewport.width
        canvas.height = viewport.height

        const ctx = canvas.getContext('2d')!
        const task = page.render({ canvasContext: ctx, viewport } as Parameters<typeof page.render>[0])
        renderTasksRef.current.push(task)
        try {
          await task.promise
        } catch {
          continue
        }

        // Text layer for text selection
        if (textDiv) {
          textDiv.innerHTML = ''
          textDiv.style.width = `${viewport.width}px`
          textDiv.style.height = `${viewport.height}px`
          try {
            const textContent = await page.getTextContent()
            const pdfjs = pdfjsLib as any
            if (pdfjs.TextLayer) {
              const tl = new pdfjs.TextLayer({ textContentSource: textContent, container: textDiv, viewport })
              await tl.render()
            } else if (pdfjs.renderTextLayer) {
              const rt = pdfjs.renderTextLayer({ textContentSource: textContent, container: textDiv, viewport, textDivs: [] })
              if (rt?.promise) await rt.promise
            }
          } catch {
            // Text layer failed — canvas-only fallback
          }
        }
      }
    }

    renderAll().catch(console.error)
  }, [numPages, renderScale])

  // Track current page via IntersectionObserver
  useEffect(() => {
    observerRef.current?.disconnect()
    if (!numPages) return

    const observer = new IntersectionObserver(
      (entries) => {
        let bestRatio = 0
        let bestPage = -1
        entries.forEach((entry) => {
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio
            const idx = pageWrapperRefs.current.findIndex((el) => el === entry.target)
            if (idx !== -1) bestPage = idx + 1
          }
        })
        if (bestPage !== -1) {
          setCurrentPage(bestPage)
          setPageInput(String(bestPage))
        }
      },
      {
        root: pagesRef.current,
        threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      },
    )
    observerRef.current = observer
    pageWrapperRefs.current.forEach((el) => { if (el) observer.observe(el) })
    return () => observer.disconnect()
  }, [numPages])

  const scrollToPage = useCallback((page: number) => {
    pageWrapperRefs.current[page - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const commitPageInput = () => {
    const n = parseInt(pageInput, 10)
    if (!isNaN(n) && n >= 1 && n <= numPages) {
      scrollToPage(n)
    } else {
      setPageInput(String(currentPage))
    }
  }

  const handleDoubleClick = (pageIndex: number, e: React.MouseEvent<HTMLDivElement>) => {
    if (!onDoubleClick) return
    const canvas = canvasRefs.current[pageIndex]
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const yRatio = (e.clientY - rect.top) / rect.height
    onDoubleClick(pageIndex + 1, Math.max(0, Math.min(1, yRatio)))
  }

  return (
    <div style={styles.container} ref={containerRef}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button
          style={styles.toolBtn}
          onClick={() => applyScale(renderScaleRef.current - 0.25)}
          title="Zoom out (Ctrl+scroll)"
        >
          −
        </button>
        <span style={styles.scaleLabel}>{Math.round(displayScale * 100)}%</span>
        <button
          style={styles.toolBtn}
          onClick={() => applyScale(renderScaleRef.current + 0.25)}
          title="Zoom in (Ctrl+scroll)"
        >
          +
        </button>

        {numPages > 0 && (
          <>
            <div style={styles.divider} />
            <button
              style={styles.toolBtn}
              onClick={() => scrollToPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
              title="Previous page"
            >
              ‹
            </button>
            <input
              style={styles.pageInput}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPageInput() }}
              onBlur={commitPageInput}
              title="Page number (Enter to jump)"
            />
            <span style={styles.pageTotal}>/ {numPages}</span>
            <button
              style={styles.toolBtn}
              onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))}
              disabled={currentPage >= numPages}
              title="Next page"
            >
              ›
            </button>
          </>
        )}

        {onDoubleClick && (
          <span style={styles.hint}>Double-click to jump to source</span>
        )}
      </div>

      {/* Scroll container */}
      <div style={styles.pages} ref={pagesRef}>
        {/* Inner wrapper: receives CSS transform during gesture so canvases
            are never touched mid-gesture (prevents dark/flipped-page glitch) */}
        <div ref={pagesInnerRef} style={styles.pagesInner}>
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              style={styles.pageWrapper}
              ref={(el) => { pageWrapperRefs.current[i] = el }}
              onDoubleClick={(e) => handleDoubleClick(i, e)}
            >
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <canvas
                  ref={(el) => { canvasRefs.current[i] = el }}
                  style={styles.canvas}
                />
                <div
                  ref={(el) => { textLayerRefs.current[i] = el }}
                  className="pdf-text-layer"
                  style={styles.textLayer}
                />
              </div>
            </div>
          ))}
          {numPages === 0 && <p style={styles.loading}>Loading PDF…</p>}
        </div>
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
    gap: '4px',
    padding: '4px 10px',
    backgroundColor: '#3a3c3e',
    borderBottom: '1px solid #222',
    flexShrink: 0,
  },
  toolBtn: {
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    color: '#ddd',
    borderRadius: '3px',
    cursor: 'pointer',
    padding: '2px 8px',
    fontSize: '14px',
    lineHeight: 1.4,
  },
  scaleLabel: {
    color: '#ccc',
    fontSize: '12px',
    minWidth: '42px',
    textAlign: 'center',
  },
  divider: {
    width: '1px',
    height: '16px',
    backgroundColor: 'rgba(255,255,255,0.2)',
    margin: '0 4px',
    flexShrink: 0,
  },
  pageInput: {
    width: '36px',
    padding: '2px 4px',
    fontSize: '12px',
    textAlign: 'center',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '3px',
    color: '#ddd',
    outline: 'none',
  },
  pageTotal: {
    color: '#aaa',
    fontSize: '12px',
  },
  hint: {
    color: '#888',
    fontSize: '11px',
    marginLeft: '8px',
  },
  pages: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'hidden',
  },
  pagesInner: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '12px',
    minHeight: '100%',
    // transformOrigin is set imperatively during gesture
  },
  pageWrapper: {
    boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
    cursor: 'crosshair',
    flexShrink: 0,
  },
  canvas: {
    display: 'block',
  },
  textLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    overflow: 'hidden',
    lineHeight: 1,
  },
  loading: {
    color: '#aaa',
    marginTop: '40px',
  },
}
