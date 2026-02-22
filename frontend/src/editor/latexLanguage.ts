import type * as Monaco from 'monaco-editor'

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
