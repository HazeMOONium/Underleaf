// Commands whose {argument} should NOT be spell-checked
const NON_PROSE_COMMANDS = new Set([
  'label', 'ref', 'eqref', 'pageref', 'cref', 'Cref', 'autoref',
  'cite', 'citep', 'citet', 'citealt', 'citealp', 'nocite', 'bibitem',
  'includegraphics', 'input', 'include', 'includeonly',
  'url', 'href', 'hyperref',
  'usepackage', 'documentclass', 'RequirePackage',
  'newcommand', 'renewcommand', 'providecommand', 'DeclareMathOperator',
  'setcounter', 'addtocounter', 'newcounter',
  'bibliographystyle', 'bibliography', 'addbibresource',
  'newenvironment', 'renewenvironment',
  'definecolor', 'colorlet',
  'lstset', 'lstdefinelanguage',
])

// Math environments (content should not be spell-checked)
const MATH_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'math',
  'displaymath', 'flalign', 'flalign*', 'alignat', 'alignat*',
  'subequations', 'array',
])

// Environments that are verbatim (skip entirely)
const VERBATIM_ENVIRONMENTS = new Set([
  'verbatim', 'verbatim*', 'lstlisting', 'minted', 'Verbatim',
  'alltt', 'code',
])

export interface WordEntry {
  word: string
  lineNumber: number  // 1-based
  startColumn: number // 1-based
  endColumn: number   // 1-based, exclusive
}

/**
 * Extracts spell-checkable plain-text words from an array of LaTeX source lines.
 * Strips commands, math, comments, and verbatim environments.
 * Returns word tokens with their original line/column positions.
 */
export function extractSpellableWords(lines: string[]): WordEntry[] {
  const words: WordEntry[] = []
  let inMathDisplay = false
  let inVerbatim = false
  let inMathEnv = false
  let mathEnvDepth = 0

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1
    const raw = lines[i]

    // ── Track verbatim environment boundaries ────────────────────────────────
    const beginVerbMatch = raw.match(/\\begin\{(\w+\*?)\}/)
    if (beginVerbMatch && VERBATIM_ENVIRONMENTS.has(beginVerbMatch[1])) {
      inVerbatim = true
      continue
    }
    const endVerbMatch = raw.match(/\\end\{(\w+\*?)\}/)
    if (endVerbMatch && VERBATIM_ENVIRONMENTS.has(endVerbMatch[1])) {
      inVerbatim = false
      continue
    }
    if (inVerbatim) continue

    // ── Track math environment boundaries ────────────────────────────────────
    const beginMathMatch = raw.match(/\\begin\{(\w+\*?)\}/)
    if (beginMathMatch && MATH_ENVIRONMENTS.has(beginMathMatch[1])) {
      inMathEnv = true
      mathEnvDepth++
    }
    const endMathMatch = raw.match(/\\end\{(\w+\*?)\}/)
    if (endMathMatch && MATH_ENVIRONMENTS.has(endMathMatch[1])) {
      mathEnvDepth = Math.max(0, mathEnvDepth - 1)
      if (mathEnvDepth === 0) inMathEnv = false
    }
    if (inMathEnv) continue

    // ── Pass 1: Strip % comments ─────────────────────────────────────────────
    let text = raw
    const commentIdx = text.search(/(?<!\\)%/)
    if (commentIdx >= 0) text = text.slice(0, commentIdx)

    // ── Pass 2: Track and mask $$ display math ───────────────────────────────
    const ddCount = (text.match(/\$\$/g) || []).length
    if (ddCount % 2 !== 0) inMathDisplay = !inMathDisplay
    if (inMathDisplay) continue

    // Mask out $...$ inline math (replace content with spaces, preserving length)
    text = text.replace(/(?<!\\)\$[^$]+?\$|\$\$[^$]*?\$\$/g, (m) => ' '.repeat(m.length))

    // Mask \(...\) and \[...\]
    text = text.replace(/\\\(.*?\\\)|\\\[.*?\\\]/gs, (m) => ' '.repeat(m.length))

    // ── Pass 3: Strip non-prose LaTeX commands ───────────────────────────────
    // Remove non-prose command + its {argument} (replace with spaces to preserve offsets)
    text = text.replace(/\\([a-zA-Z@]+)\*?\s*\{([^}]*)\}/g, (match, cmd: string) => {
      if (NON_PROSE_COMMANDS.has(cmd)) {
        return ' '.repeat(match.length)
      }
      // Prose commands (\textbf, \emph, etc.) — keep content, mask just the command token
      const cmdToken = '\\' + cmd
      return ' '.repeat(cmdToken.length) + match.slice(cmdToken.length)
    })

    // Remove optional arguments [...]
    text = text.replace(/\[[^\]]*\]/g, (m) => ' '.repeat(m.length))

    // Remove remaining bare command names
    text = text.replace(/\\[a-zA-Z@]+\*?/g, (m) => ' '.repeat(m.length))

    // Remove leftover braces and backslashes
    text = text.replace(/[{}\\]/g, ' ')

    // ── Pass 4: Tokenize remaining words ─────────────────────────────────────
    const wordRe = /[a-zA-Z''\u2019\-]+/g
    let m: RegExpExecArray | null
    while ((m = wordRe.exec(text)) !== null) {
      let token = m[0]

      // Normalize curly apostrophes to straight
      token = token.replace(/['\u2019]/g, "'")

      // Strip leading/trailing hyphens or apostrophes
      token = token.replace(/^[-']+|[-']+$/g, '')

      if (token.length < 2) continue
      if (/[0-9]/.test(token)) continue
      if (/^[A-Z]{2,}$/.test(token)) continue   // acronym: PDF, URL, HTTP
      if (/[A-Z]/.test(token.slice(1))) continue // CamelCase / internal capitals

      // Strip possessives: "word's" → "word"
      const clean = token.replace(/'s$/i, '')
      if (clean.length < 2) continue

      words.push({
        word: clean,
        lineNumber: lineNum,
        startColumn: m.index + 1,
        endColumn: m.index + token.length + 1,
      })
    }
  }

  return words
}
