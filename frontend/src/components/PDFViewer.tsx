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

/** One find match: the overlay divs covering that match's visual area. */
interface FindMatch {
  divs: HTMLElement[]
}

/**
 * Find occurrences of `query` in the text layer `el` using Range.getClientRects().
 * Creates absolutely-positioned overlay divs (no DOM mutation of pdfjs text nodes).
 * Returns one FindMatch per occurrence. Clears previous overlays first.
 */
function applyFindHighlight(el: HTMLElement, query: string): FindMatch[] {
  // Remove previous overlay divs
  el.querySelectorAll('.pdf-hl').forEach((d) => d.remove())
  if (!query.trim()) return []

  const lq = query.toLowerCase()
  const matches: FindMatch[] = []
  const containerRect = el.getBoundingClientRect()

  // Walk all text nodes inside the text layer
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  let node: Text | null
  while ((node = walker.nextNode() as Text | null)) {
    const text = node.textContent ?? ''
    const lower = text.toLowerCase()
    let idx = lower.indexOf(lq)
    while (idx !== -1) {
      const range = document.createRange()
      range.setStart(node, idx)
      range.setEnd(node, Math.min(idx + query.length, text.length))

      // getClientRects accounts for pdfjs transforms — positions are in viewport coords
      const rects = range.getClientRects()
      const divs: HTMLElement[] = []
      for (const rect of rects) {
        if (rect.width < 1 || rect.height < 1) continue
        const div = document.createElement('div')
        div.className = 'pdf-hl'
        div.style.cssText = [
          'position:absolute',
          `left:${rect.left - containerRect.left}px`,
          `top:${rect.top - containerRect.top}px`,
          `width:${rect.width}px`,
          `height:${rect.height}px`,
          'pointer-events:none',
          'border-radius:2px',
        ].join(';')
        el.appendChild(div)
        divs.push(div)
      }
      if (divs.length) matches.push({ divs })
      idx = lower.indexOf(lq, idx + 1)
    }
  }

  return matches
}

export default function PDFViewer({ url, onDoubleClick }: PDFViewerProps) {
  // renderScale: what the canvases are actually rendered at (triggers re-render)
  // displayScale: what's shown in the toolbar (updates immediately during gesture)
  const [renderScale, setRenderScale] = useState(1.0)
  const [displayScale, setDisplayScale] = useState(1.0)
  const [numPages, setNumPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageInput, setPageInput] = useState('1')

  // Find-in-PDF state
  const [showFindBar, setShowFindBar] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [, setFindMatchPages] = useState<number[]>([])  // pages with matches (unused in render, kept for future)
  const [findMatchIdx, setFindMatchIdx] = useState(0)              // index into findMatchPages
  const [findTotalCount, setFindTotalCount] = useState(0)           // total mark count across all pages
  const findInputRef = useRef<HTMLInputElement>(null)
  const findQueryRef = useRef('')   // stable ref used inside renderAll
  const allMarkEls = useRef<FindMatch[]>([])  // all match groups for navigation

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
  // Scroll preservation across URL changes
  const savedScrollTopRef = useRef<number>(0)
  const isUrlChangeRef = useRef(false)
  const isFirstLoadRef = useRef(true)
  // Natural page dimensions for fit-width / fit-page
  const page1NaturalWidthRef = useRef(0)
  const page1NaturalHeightRef = useRef(0)

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

  const applyFitWidth = useCallback(() => {
    if (!pagesRef.current || !page1NaturalWidthRef.current) return
    const available = pagesRef.current.clientWidth - 24
    applyScale(available / page1NaturalWidthRef.current)
  }, [applyScale])

  const applyFitPage = useCallback(() => {
    if (!pagesRef.current || !page1NaturalWidthRef.current || !page1NaturalHeightRef.current) return
    const aw = pagesRef.current.clientWidth - 24
    const ah = pagesRef.current.clientHeight - 24
    applyScale(Math.min(aw / page1NaturalWidthRef.current, ah / page1NaturalHeightRef.current))
  }, [applyScale])

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
      const factor = Math.exp(-rawDelta / 400)

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

  // Ctrl+F: open find bar (captured on container so it works when PDF is focused)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        e.stopPropagation()
        setShowFindBar(true)
        setTimeout(() => findInputRef.current?.select(), 50)
      }
      if (e.key === 'Escape' && showFindBar) {
        setShowFindBar(false)
        setFindQuery('')
      }
    }
    el.addEventListener('keydown', handler)
    return () => el.removeEventListener('keydown', handler)
  }, [showFindBar])

  // Load PDF document
  useEffect(() => {
    let cancelled = false

    // Save scroll position before loading new URL (for reload preservation)
    if (pagesRef.current && !isFirstLoadRef.current) {
      savedScrollTopRef.current = pagesRef.current.scrollTop
      isUrlChangeRef.current = true
    }

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
      // Only reset to page 1 on very first load
      if (isFirstLoadRef.current) {
        setCurrentPage(1)
        setPageInput('1')
        isFirstLoadRef.current = false
      }
    }

    load().catch(console.error)

    return () => {
      cancelled = true
      for (const t of renderTasksRef.current) t.cancel()
    }
  }, [url])

  // Keep a stable ref to onDoubleClick so capture-phase handlers always
  // call the latest callback without needing to re-attach on every render.
  const onDoubleClickRef = useRef(onDoubleClick)
  onDoubleClickRef.current = onDoubleClick

  // Ref to track cleanup functions for capture-phase dblclick handlers.
  // These are attached after renderAll() completes (inside the render effect)
  // so they work even though text layers are built asynchronously.
  const synctexCleanupRef = useRef<(() => void)[]>([])

  const attachSynctexHandlers = useCallback(() => {
    // Clean up previous handlers
    synctexCleanupRef.current.forEach((h) => h())
    synctexCleanupRef.current = []

    if (!onDoubleClickRef.current || !numPages) return

    for (let i = 0; i < numPages; i++) {
      const textDiv = textLayerRefs.current[i]
      if (!textDiv) continue
      textDiv.classList.add('synctex-active')
      const handler = (e: MouseEvent) => {
        if (!onDoubleClickRef.current) return
        const canvas = canvasRefs.current[i]
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const yRatio = (e.clientY - rect.top) / rect.height
        onDoubleClickRef.current(i + 1, Math.max(0, Math.min(1, yRatio)))
        e.preventDefault()
        e.stopPropagation()
      }
      textDiv.addEventListener('dblclick', handler, true)
      synctexCleanupRef.current.push(() => {
        textDiv.removeEventListener('dblclick', handler, true)
        textDiv.classList.remove('synctex-active')
      })
    }
  }, [numPages])

  // Render pages whenever the PDF or the committed renderScale changes.
  // NOT triggered by displayScale — that's purely visual during gestures.
  useEffect(() => {
    if (!numPages || !pdfDocRef.current) return

    for (const t of renderTasksRef.current) t.cancel()
    renderTasksRef.current = []

    const renderAll = async () => {
      const pdf = pdfDocRef.current!
      const newMarks: FindMatch[] = []
      const matchPages: number[] = []

      for (let i = 1; i <= numPages; i++) {
        const canvas = canvasRefs.current[i - 1]
        const textDiv = textLayerRefs.current[i - 1]
        if (!canvas) continue

        const page = await pdf.getPage(i)

        // Capture natural dimensions from page 1 for fit-width / fit-page
        if (i === 1) {
          const nat = page.getViewport({ scale: 1 })
          page1NaturalWidthRef.current = nat.width
          page1NaturalHeightRef.current = nat.height
        }

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

        // Text layer for text selection + find highlighting
        if (textDiv) {
          textDiv.innerHTML = ''
          try {
            const textContent = await page.getTextContent()
            const pdfjs = pdfjsLib as any
            if (pdfjs.TextLayer) {
              const tl = new pdfjs.TextLayer({ textContentSource: textContent, container: textDiv, viewport })
              // pdfjs v5 setLayerDimensions() writes calc(var(--total-scale-factor)*Xpx) which
              // requires a CSS variable our viewer doesn't set, leaving the layer 0px wide.
              // Override with explicit pixel values AFTER the constructor, BEFORE render.
              textDiv.style.width = `${viewport.width}px`
              textDiv.style.height = `${viewport.height}px`
              await tl.render()
            } else if (pdfjs.renderTextLayer) {
              const rt = pdfjs.renderTextLayer({ textContentSource: textContent, container: textDiv, viewport, textDivs: [] })
              if (rt?.promise) await rt.promise
              textDiv.style.width = `${viewport.width}px`
              textDiv.style.height = `${viewport.height}px`
            }
          } catch {
            // Text layer failed — canvas-only fallback
          }
          // Re-apply any active find highlight after text layer rebuild
          if (findQueryRef.current.trim()) {
            const marks = applyFindHighlight(textDiv, findQueryRef.current)
            if (marks.length > 0) {
              matchPages.push(i)
              newMarks.push(...marks)
            }
          }
        }
      }

      // Update find state if query was active
      if (findQueryRef.current.trim()) {
        allMarkEls.current = newMarks
        setFindMatchPages(matchPages)
        setFindTotalCount(newMarks.length)
        setFindMatchIdx(0)
      }
    }

    renderAll().then(() => {
      // Restore scroll position after URL change (recompile)
      if (isUrlChangeRef.current && pagesRef.current) {
        pagesRef.current.scrollTop = savedScrollTopRef.current
        isUrlChangeRef.current = false
      }
      // Attach SyncTeX capture-phase handlers after text layers are built
      attachSynctexHandlers()
    }).catch(console.error)

    return () => {
      synctexCleanupRef.current.forEach((h) => h())
      synctexCleanupRef.current = []
    }
  }, [numPages, renderScale, attachSynctexHandlers])

  // Apply find highlights when query changes
  useEffect(() => {
    findQueryRef.current = findQuery
    const marks: FindMatch[] = []
    const matchPages: number[] = []

    for (let i = 0; i < numPages; i++) {
      const textDiv = textLayerRefs.current[i]
      if (!textDiv) continue
      const m = applyFindHighlight(textDiv, findQuery)
      if (m.length > 0) {
        matchPages.push(i + 1)
        marks.push(...m)
      }
    }

    allMarkEls.current = marks
    setFindMatchPages(matchPages)
    setFindTotalCount(marks.length)
    setFindMatchIdx(0)

    if (marks.length > 0) {
      marks[0].divs.forEach((d) => d.classList.add('pdf-hl-current'))
      marks[0].divs[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [findQuery, numPages])

  // Navigate to a specific match group
  const goToMark = useCallback((idx: number) => {
    const marks = allMarkEls.current
    if (!marks.length) return
    // Remove 'current' highlight from all match divs
    marks.forEach((m) => m.divs.forEach((d) => d.classList.remove('pdf-hl-current')))
    const wrapped = ((idx % marks.length) + marks.length) % marks.length
    setFindMatchIdx(wrapped)
    marks[wrapped].divs.forEach((d) => d.classList.add('pdf-hl-current'))
    marks[wrapped].divs[0]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

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

  const synctexActive = !!onDoubleClick

  return (
    <div style={styles.container} ref={containerRef} tabIndex={-1}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <button style={styles.toolBtn} onClick={() => applyScale(renderScaleRef.current - 0.25)} title="Zoom out (Ctrl+scroll)">−</button>
        <span style={styles.scaleLabel}>{Math.round(displayScale * 100)}%</span>
        <button style={styles.toolBtn} onClick={() => applyScale(renderScaleRef.current + 0.25)} title="Zoom in (Ctrl+scroll)">+</button>
        <button style={styles.toolBtn} onClick={applyFitWidth} title="Fit width">⊡</button>
        <button style={styles.toolBtn} onClick={applyFitPage} title="Fit page">⊞</button>

        {numPages > 0 && (
          <>
            <div style={styles.divider} />
            <button style={styles.toolBtn} onClick={() => scrollToPage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} title="Previous page">‹</button>
            <input
              style={styles.pageInput}
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitPageInput() }}
              onBlur={commitPageInput}
              title="Page number (Enter to jump)"
            />
            <span style={styles.pageTotal}>/ {numPages}</span>
            <button style={styles.toolBtn} onClick={() => scrollToPage(Math.min(numPages, currentPage + 1))} disabled={currentPage >= numPages} title="Next page">›</button>
          </>
        )}

        <div style={styles.divider} />
        <button
          style={{ ...styles.toolBtn, ...(showFindBar ? styles.toolBtnActive : {}) }}
          onClick={() => { setShowFindBar((v) => !v); setTimeout(() => findInputRef.current?.select(), 50) }}
          title="Find in PDF (Ctrl+F)"
        >
          🔍
        </button>

        {synctexActive && (
          <span style={styles.hint}>Double-click → source</span>
        )}
      </div>

      {/* Find bar */}
      {showFindBar && (
        <div style={styles.findBar}>
          <input
            ref={findInputRef}
            style={styles.findInput}
            value={findQuery}
            placeholder="Find in PDF…"
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') goToMark(findMatchIdx + (e.shiftKey ? -1 : 1))
              if (e.key === 'Escape') { setShowFindBar(false); setFindQuery('') }
            }}
          />
          {findQuery && (
            <span style={styles.findCount}>
              {findTotalCount === 0
                ? 'No matches'
                : `${findMatchIdx + 1} / ${findTotalCount}`}
            </span>
          )}
          <button style={styles.toolBtn} onClick={() => goToMark(findMatchIdx - 1)} disabled={findTotalCount === 0} title="Previous match (Shift+Enter)">‹</button>
          <button style={styles.toolBtn} onClick={() => goToMark(findMatchIdx + 1)} disabled={findTotalCount === 0} title="Next match (Enter)">›</button>
          <button style={{ ...styles.toolBtn, marginLeft: '4px' }} onClick={() => { setShowFindBar(false); setFindQuery('') }} title="Close (Esc)">✕</button>
        </div>
      )}

      {/* Scroll container */}
      <div style={styles.pages} ref={pagesRef}>
        {/* Inner wrapper: receives CSS transform during gesture so canvases
            are never touched mid-gesture (prevents dark/flipped-page glitch) */}
        <div ref={pagesInnerRef} style={styles.pagesInner}>
          {Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              style={{ ...styles.pageWrapper, cursor: synctexActive ? 'crosshair' : 'auto' }}
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
                  className="textLayer"
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
    outline: 'none',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    backgroundColor: '#3a3c3e',
    borderBottom: '1px solid #222',
    flexShrink: 0,
    flexWrap: 'wrap' as const,
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
  toolBtnActive: {
    background: 'rgba(255,255,255,0.22)',
    borderColor: 'rgba(255,255,255,0.45)',
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
  findBar: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 10px',
    backgroundColor: '#2e3032',
    borderBottom: '1px solid #222',
    flexShrink: 0,
  },
  findInput: {
    flex: 1,
    padding: '3px 8px',
    fontSize: '12px',
    background: 'rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: '3px',
    color: '#ddd',
    outline: 'none',
    minWidth: 0,
  },
  findCount: {
    color: '#aaa',
    fontSize: '11px',
    whiteSpace: 'nowrap' as const,
    minWidth: '70px',
  },
  pages: {
    flex: 1,
    overflowY: 'auto',
    overflowX: 'auto',
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
    flexShrink: 0,
  },
  canvas: {
    display: 'block',
  },
  textLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    // overflow, z-index, cursor etc. are handled by the .textLayer CSS class (index.css).
    // width/height are set imperatively after TextLayer construction (see renderAll).
  },
  loading: {
    color: '#aaa',
    marginTop: '40px',
  },
}
