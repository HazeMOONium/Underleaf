import type * as Monaco from 'monaco-editor'

/**
 * Registers LaTeX diagnostics (squiggle warnings/errors) on a Monaco editor instance.
 * Call this after the editor mounts. Returns a cleanup function.
 */
export function registerLatexDiagnostics(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
): () => void {
  const OWNER = 'latex-lint'

  const analyze = () => {
    const model = editor.getModel()
    if (!model) return

    const lines = model.getLinesContent()
    const markers: Monaco.editor.IMarkerData[] = []

    // Track \begin{env} stack: { env, line (1-based), col (1-based) }
    const beginStack: Array<{ env: string; line: number; col: number }> = []
    // Track \label{key} definitions for duplicate detection
    const labelDefs = new Map<string, Array<{ line: number; col: number }>>()
    let hasEndDocument = false
    let inMathDisplay = false // $$ ... $$
    let mathDisplayStartLine = -1

    for (let i = 0; i < lines.length; i++) {
      const lineNum = i + 1
      const raw = lines[i]

      // Strip comments (% not preceded by \)
      const commentIdx = raw.search(/(?<!\\)%/)
      const line = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw

      // Check for \end{document}
      if (/\\end\{document\}/.test(line)) hasEndDocument = true

      // Track $$ math display blocks
      const ddMatches = line.match(/\$\$/g)
      if (ddMatches) {
        for (const _ of ddMatches) {
          if (!inMathDisplay) {
            inMathDisplay = true
            mathDisplayStartLine = lineNum
          } else {
            inMathDisplay = false
            mathDisplayStartLine = -1
          }
        }
      }

      // Check unclosed inline $ (odd number of unescaped $ that aren't $$)
      const singleDollar = line.replace(/\$\$/g, '').match(/(?<!\\)\$/g)
      if (singleDollar && singleDollar.length % 2 !== 0) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: 'Unclosed inline math: $ has no matching $',
          startLineNumber: lineNum,
          endLineNumber: lineNum,
          startColumn: 1,
          endColumn: line.length + 1,
        })
      }

      // Track \label{key} occurrences for duplicate detection
      const labelRe = /\\label\{([^}]+)\}/g
      let lm: RegExpExecArray | null
      while ((lm = labelRe.exec(line)) !== null) {
        const key = lm[1]
        const col = lm.index + 1
        const existing = labelDefs.get(key)
        if (existing) {
          existing.push({ line: lineNum, col })
        } else {
          labelDefs.set(key, [{ line: lineNum, col }])
        }
      }

      // Check \begin{env}
      const beginRe = /\\begin\{([^}]+)\}/g
      let m: RegExpExecArray | null
      while ((m = beginRe.exec(line)) !== null) {
        beginStack.push({ env: m[1], line: lineNum, col: m.index + 1 })
      }

      // Check \end{env}
      const endRe = /\\end\{([^}]+)\}/g
      while ((m = endRe.exec(line)) !== null) {
        const env = m[1]
        // Find last matching \begin
        let found = -1
        for (let k = beginStack.length - 1; k >= 0; k--) {
          if (beginStack[k].env === env) {
            found = k
            break
          }
        }
        if (found >= 0) {
          beginStack.splice(found, 1)
        } else {
          markers.push({
            severity: monaco.MarkerSeverity.Error,
            message: `\\end{${env}} without matching \\begin{${env}}`,
            startLineNumber: lineNum,
            endLineNumber: lineNum,
            startColumn: m.index + 1,
            endColumn: m.index + m[0].length + 1,
          })
        }
      }
    }

    // Unclosed $$ block
    if (inMathDisplay) {
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: 'Unclosed display math: $$ has no matching $$',
        startLineNumber: mathDisplayStartLine,
        endLineNumber: mathDisplayStartLine,
        startColumn: 1,
        endColumn: 3,
      })
    }

    // Unmatched \begin{env} (skip 'document' which is special)
    for (const unclosed of beginStack) {
      if (unclosed.env === 'document') continue
      markers.push({
        severity: monaco.MarkerSeverity.Error,
        message: `\\begin{${unclosed.env}} has no matching \\end{${unclosed.env}}`,
        startLineNumber: unclosed.line,
        endLineNumber: unclosed.line,
        startColumn: unclosed.col,
        endColumn: unclosed.col + `\\begin{${unclosed.env}}`.length,
      })
    }

    // Duplicate \label definitions
    labelDefs.forEach((occurrences, key) => {
      if (occurrences.length < 2) return
      for (const occ of occurrences) {
        markers.push({
          severity: monaco.MarkerSeverity.Warning,
          message: `Duplicate \\label{${key}} — defined ${occurrences.length} times`,
          startLineNumber: occ.line,
          endLineNumber: occ.line,
          startColumn: occ.col,
          endColumn: occ.col + `\\label{${key}}`.length,
        })
      }
    })

    // Missing \end{document}
    if (!hasEndDocument && lines.some((l) => /\\begin\{document\}/.test(l))) {
      markers.push({
        severity: monaco.MarkerSeverity.Warning,
        message: 'Missing \\end{document}',
        startLineNumber: lines.length,
        endLineNumber: lines.length,
        startColumn: 1,
        endColumn: (lines[lines.length - 1] || '').length + 1,
      })
    }

    monaco.editor.setModelMarkers(model, OWNER, markers)
  }

  // Run on mount and on every content/model change
  analyze()
  const contentDisposable = editor.onDidChangeModelContent(() => analyze())
  const modelDisposable = editor.onDidChangeModel((e) => {
    // Clear markers on old model then re-analyze new model
    if (e.oldModelUrl) {
      const oldModel = monaco.editor.getModel(e.oldModelUrl)
      if (oldModel) monaco.editor.setModelMarkers(oldModel, OWNER, [])
    }
    analyze()
  })

  return () => {
    contentDisposable.dispose()
    modelDisposable.dispose()
    const model = editor.getModel()
    if (model) monaco.editor.setModelMarkers(model, OWNER, [])
  }
}

export function registerLatexLanguage(monaco: typeof Monaco) {
  const langId = 'latex'

  // Only register once
  if (monaco.languages.getLanguages().some((l) => l.id === langId)) return

  monaco.languages.register({ id: langId, extensions: ['.tex', '.sty', '.cls'] })

  monaco.languages.setMonarchTokensProvider(langId, {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/\$\$/, { token: 'string', next: '@mathDisplay' }],
        [/\$/, { token: 'string', next: '@mathInline' }],
        [/\\begin\{/, { token: 'keyword', next: '@environment' }],
        [/\\end\{/, { token: 'keyword', next: '@environment' }],
        [/\\[a-zA-Z@]+\*?/, 'keyword'],
        [/[{}]/, 'delimiter.curly'],
        [/[[\]]/, 'delimiter.square'],
      ],
      mathInline: [
        [/\$/, { token: 'string', next: '@pop' }],
        [/\\[a-zA-Z]+/, 'keyword'],
        [/./, 'string'],
      ],
      mathDisplay: [
        [/\$\$/, { token: 'string', next: '@pop' }],
        [/\\[a-zA-Z]+/, 'keyword'],
        [/./, 'string'],
      ],
      environment: [
        [/[^}]+/, 'type.identifier'],
        [/\}/, { token: 'keyword', next: '@pop' }],
      ],
    },
  })

  const commands = [
    'documentclass',
    'usepackage',
    'begin',
    'end',
    'section',
    'subsection',
    'subsubsection',
    'chapter',
    'part',
    'paragraph',
    'textbf',
    'textit',
    'underline',
    'emph',
    'cite',
    'ref',
    'label',
    'caption',
    'includegraphics',
    'input',
    'include',
    'newcommand',
    'renewcommand',
    'title',
    'author',
    'date',
    'maketitle',
    'tableofcontents',
    'footnote',
    'href',
    'url',
    'item',
    'centering',
    'hspace',
    'vspace',
    'newpage',
    'clearpage',
    'noindent',
    'frac',
    'sqrt',
    'sum',
    'int',
    'prod',
    'lim',
    'infty',
    'partial',
    'nabla',
    'left',
    'right',
    'text',
    'mathbf',
    'mathrm',
    'mathbb',
    'mathcal',
  ]

  const environments = [
    'document',
    'figure',
    'table',
    'tabular',
    'itemize',
    'enumerate',
    'description',
    'equation',
    'align',
    'gather',
    'multline',
    'array',
    'matrix',
    'bmatrix',
    'pmatrix',
    'verbatim',
    'lstlisting',
    'abstract',
    'theorem',
    'proof',
    'lemma',
    'definition',
    'minipage',
    'center',
    'flushleft',
    'flushright',
  ]

  const greekLetters = [
    'alpha',
    'beta',
    'gamma',
    'delta',
    'epsilon',
    'zeta',
    'eta',
    'theta',
    'iota',
    'kappa',
    'lambda',
    'mu',
    'nu',
    'xi',
    'pi',
    'rho',
    'sigma',
    'tau',
    'upsilon',
    'phi',
    'chi',
    'psi',
    'omega',
    'Gamma',
    'Delta',
    'Theta',
    'Lambda',
    'Xi',
    'Pi',
    'Sigma',
    'Phi',
    'Psi',
    'Omega',
  ]

  monaco.languages.registerCompletionItemProvider(langId, {
    triggerCharacters: ['\\'],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }

      // Check if preceded by backslash
      const lineContent = model.getLineContent(position.lineNumber)
      const charBefore = lineContent[word.startColumn - 2]
      if (charBefore !== '\\') return { suggestions: [] }

      const suggestions: Monaco.languages.CompletionItem[] = [
        ...commands.map((cmd) => ({
          label: cmd,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: cmd.match(/^(begin|end)$/)
            ? `${cmd}{\${1:environment}}`
            : `${cmd}`,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
        ...environments.map((env) => ({
          label: `begin{${env}}`,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: `begin{${env}}\n\t$0\n\\end{${env}}`,
          insertTextRules:
            monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        })),
        ...greekLetters.map((letter) => ({
          label: letter,
          kind: monaco.languages.CompletionItemKind.Constant,
          insertText: letter,
          range,
        })),
      ]

      return { suggestions }
    },
  })
}
