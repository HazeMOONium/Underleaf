const CONTEXT_LINES = 3
const MAX_LINES = 2000

export type DiffLine =
  | { kind: 'ctx'; text: string; oldLine: number; newLine: number }
  | { kind: 'add'; text: string; newLine: number }
  | { kind: 'del'; text: string; oldLine: number }
  | { kind: 'sep' }

export type FileDiffStatus = 'added' | 'deleted' | 'modified' | 'unchanged'

/**
 * Compute a line-level unified diff between oldText and newText.
 * Returns diff lines with 3-line context around each change, collapsed elsewhere.
 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText === '' ? [] : oldText.split('\n').slice(0, MAX_LINES)
  const b = newText === '' ? [] : newText.split('\n').slice(0, MAX_LINES)
  const m = a.length
  const n = b.length

  // Build LCS DP table
  const dp: Uint16Array[] = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  // Backtrack iteratively to produce edit ops (built in reverse, then flipped)
  const raw: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      raw.push({ kind: 'ctx', text: a[i - 1], oldLine: i, newLine: j })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ kind: 'add', text: b[j - 1], newLine: j })
      j--
    } else {
      raw.push({ kind: 'del', text: a[i - 1], oldLine: i })
      i--
    }
  }
  raw.reverse()

  // Collapse context: keep only CONTEXT_LINES around each changed line, insert separators
  const changedIndices = new Set<number>()
  raw.forEach((l, idx) => { if (l.kind !== 'ctx') changedIndices.add(idx) })

  if (changedIndices.size === 0) return []  // no changes

  const keep = new Set<number>()
  changedIndices.forEach((idx) => {
    for (let k = idx - CONTEXT_LINES; k <= idx + CONTEXT_LINES; k++) {
      if (k >= 0 && k < raw.length) keep.add(k)
    }
  })

  const result: DiffLine[] = []
  let lastKept = -2
  raw.forEach((line, idx) => {
    if (!keep.has(idx)) return
    if (idx > lastKept + 1) result.push({ kind: 'sep' })
    result.push(line)
    lastKept = idx
  })
  return result
}

/**
 * Compare two file sets and return the diff status for every unique path.
 * "old" = base (e.g. current project or previous snapshot)
 * "new" = this snapshot's files
 */
export function computeFileDiff(
  baseFiles: { path: string; content: string }[],
  snapFiles: { path: string; content: string }[],
): Map<string, FileDiffStatus> {
  const baseMap = new Map(baseFiles.map((f) => [f.path, f.content]))
  const snapMap = new Map(snapFiles.map((f) => [f.path, f.content]))
  const result = new Map<string, FileDiffStatus>()

  for (const [path, content] of snapMap) {
    if (!baseMap.has(path)) result.set(path, 'added')
    else if (baseMap.get(path) !== content) result.set(path, 'modified')
    else result.set(path, 'unchanged')
  }

  for (const path of baseMap.keys()) {
    if (!snapMap.has(path)) result.set(path, 'deleted')
  }

  return result
}

/** All unique paths from both sets, sorted. */
export function mergeFileLists(
  baseFiles: { path: string; content: string }[],
  snapFiles: { path: string; content: string }[],
): string[] {
  const all = new Set([...baseFiles.map((f) => f.path), ...snapFiles.map((f) => f.path)])
  return Array.from(all).sort()
}
