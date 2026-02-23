/**
 * Minimal SyncTeX parser for inverse sync (PDF → source code).
 *
 * Parses a .synctex.gz file and lets callers find the source line
 * corresponding to a click position in the PDF.
 */

export interface SyncTeXRecord {
  page: number
  file: string // relative/base filename
  line: number
  h: number // horizontal position in sp
  v: number // vertical position in sp (from top of page)
}

export interface SyncTeXData {
  records: SyncTeXRecord[]
  pageStats: Map<number, { vMin: number; vMax: number }>
}

/** Decompress gzip ArrayBuffer and return text. */
async function decompressGzip(data: ArrayBuffer): Promise<string> {
  const ds = new DecompressionStream('gzip')
  const writer = ds.writable.getWriter()
  const reader = ds.readable.getReader()

  writer.write(new Uint8Array(data))
  writer.close()

  const chunks: Uint8Array[] = []
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value)
  }

  const total = chunks.reduce((s, c) => s + c.length, 0)
  const merged = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    merged.set(c, offset)
    offset += c.length
  }
  return new TextDecoder('utf-8').decode(merged)
}

/** Parse raw (uncompressed) SyncTeX text. */
function parseSyncTeXText(text: string): SyncTeXData {
  const inputMap = new Map<number, string>() // index → basename
  const records: SyncTeXRecord[] = []

  let currentPage = 0
  let inContent = false

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()

    // Input mapping: Input:index:/path/to/file
    if (line.startsWith('Input:')) {
      const m = /^Input:(\d+):(.+)$/.exec(line)
      if (m) {
        const idx = parseInt(m[1])
        const fullPath = m[2]
        // Strip everything up to and including the last slash
        const basename = fullPath.replace(/.*\//, '')
        inputMap.set(idx, basename)
      }
      continue
    }

    if (line === 'Content:') {
      inContent = true
      continue
    }

    if (!inContent) continue

    // Page start: {N
    if (/^\{\d+$/.test(line)) {
      currentPage = parseInt(line.slice(1))
      continue
    }

    // hbox record: (file,line:h,v,W,H...
    // glyph record: xfile,line:h,v  (less common but useful)
    if (line.startsWith('(') || line.startsWith('x')) {
      const m = /^[x(](\d+),(\d+):(-?\d+),(-?\d+)/.exec(line)
      if (m && currentPage > 0) {
        const fileIdx = parseInt(m[1])
        const srcLine = parseInt(m[2])
        const h = parseInt(m[3])
        const v = parseInt(m[4])
        const file = inputMap.get(fileIdx) || ''
        // Skip style/class files; keep .tex files
        if (file && (file.endsWith('.tex') || !file.includes('.'))) {
          records.push({ page: currentPage, file, line: srcLine, h, v })
        }
      }
      continue
    }
  }

  // Compute per-page vertical range for normalisation
  const pageStats = new Map<number, { vMin: number; vMax: number }>()
  for (const r of records) {
    const s = pageStats.get(r.page)
    if (!s) {
      pageStats.set(r.page, { vMin: r.v, vMax: r.v })
    } else {
      if (r.v < s.vMin) s.vMin = r.v
      if (r.v > s.vMax) s.vMax = r.v
    }
  }

  return { records, pageStats }
}

/** Parse a .synctex.gz ArrayBuffer into usable SyncTeX data. */
export async function parseSyncTeX(gzData: ArrayBuffer): Promise<SyncTeXData> {
  const text = await decompressGzip(gzData)
  return parseSyncTeXText(text)
}

/**
 * Given a click at (page, yRatio) in the PDF viewer, return the closest
 * source location. yRatio is in [0, 1] from top to bottom of the page.
 */
export function findSourceFromClick(
  data: SyncTeXData,
  page: number,
  yRatio: number,
): { file: string; line: number } | null {
  const stats = data.pageStats.get(page)
  if (!stats) return null

  const pageRecords = data.records.filter((r) => r.page === page)
  if (!pageRecords.length) return null

  const range = stats.vMax - stats.vMin

  let best: SyncTeXRecord | null = null
  let bestDist = Infinity

  for (const r of pageRecords) {
    const vNorm = range > 0 ? (r.v - stats.vMin) / range : 0.5
    const dist = Math.abs(vNorm - yRatio)
    if (dist < bestDist) {
      bestDist = dist
      best = r
    }
  }

  return best ? { file: best.file, line: best.line } : null
}
