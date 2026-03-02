import type * as Monaco from 'monaco-editor'
import { extractSpellableWords } from './latexTextExtractor'

export type SpellLocale = 'en-us' | 'en-gb'

const OWNER = 'spell-check'
const DEBOUNCE_MS = 700

// Side map: "lineNumber:startColumn" → suggestions for CodeAction provider
const suggestionMap = new Map<string, string[]>()

function markerKey(lineNumber: number, startColumn: number): string {
  return `${lineNumber}:${startColumn}`
}

export function registerSpellChecker(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  locale: SpellLocale,
): {
  cleanup: () => void
  setLocale: (locale: SpellLocale) => void
} {
  const worker = new Worker(
    new URL('./spellCheckWorker.ts', import.meta.url),
    { type: 'module' },
  )

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let checkId = 0

  worker.postMessage({ type: 'load', locale })

  // ── Worker message handler ────────────────────────────────────────────────
  worker.addEventListener('message', (e: MessageEvent) => {
    const msg = e.data

    if (msg.type === 'loaded') {
      scheduleCheck()
      return
    }

    if (msg.type === 'wordAdded') {
      scheduleCheck()
      return
    }

    if (msg.type === 'result') {
      const model = editor.getModel()
      if (!model) return

      suggestionMap.clear()
      const markers: Monaco.editor.IMarkerData[] = msg.results.map(
        (r: { word: string; lineNumber: number; startColumn: number; endColumn: number; suggestions: string[] }) => {
          const suggs: string[] = r.suggestions
          const marker: Monaco.editor.IMarkerData = {
            severity: monaco.MarkerSeverity.Info,
            message:
              suggs.length > 0
                ? `"${r.word}" — did you mean: ${suggs.slice(0, 3).join(', ')}?`
                : `Unknown word: "${r.word}"`,
            startLineNumber: r.lineNumber,
            endLineNumber: r.lineNumber,
            startColumn: r.startColumn,
            endColumn: r.endColumn,
            source: OWNER,
          }
          suggestionMap.set(markerKey(r.lineNumber, r.startColumn), suggs)
          return marker
        },
      )

      monaco.editor.setModelMarkers(model, OWNER, markers)
    }
  })

  // ── Debounced spell check ─────────────────────────────────────────────────
  function scheduleCheck() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      const model = editor.getModel()
      if (!model) return
      const words = extractSpellableWords(model.getLinesContent())
      checkId++
      worker.postMessage({ type: 'check', id: checkId, words })
    }, DEBOUNCE_MS)
  }

  // ── CodeAction provider: quick-fix suggestions + ignore ───────────────────
  const codeActionDisposable = monaco.languages.registerCodeActionProvider('latex', {
    provideCodeActions(model, _range, context) {
      const actions: Monaco.languages.CodeAction[] = []

      for (const marker of context.markers) {
        if (marker.source !== OWNER) continue

        const suggs = suggestionMap.get(markerKey(marker.startLineNumber, marker.startColumn)) ?? []

        for (const s of suggs.slice(0, 5)) {
          actions.push({
            title: `Replace with "${s}"`,
            kind: 'quickfix',
            diagnostics: [marker],
            isPreferred: s === suggs[0],
            edit: {
              edits: [
                {
                  resource: model.uri,
                  textEdit: {
                    range: {
                      startLineNumber: marker.startLineNumber,
                      startColumn: marker.startColumn,
                      endLineNumber: marker.endLineNumber,
                      endColumn: marker.endColumn,
                    },
                    text: s,
                  },
                  versionId: model.getVersionId(),
                },
              ],
            },
          })
        }

        // "Ignore word" — add to worker's personal dictionary via a text edit
        // that replaces the word with itself (no visible change), which causes
        // the worker's 'wordAdded' response to trigger a re-check.
        const misspelled = model.getValueInRange({
          startLineNumber: marker.startLineNumber,
          startColumn: marker.startColumn,
          endLineNumber: marker.endLineNumber,
          endColumn: marker.endColumn,
        })
        actions.push({
          title: `Ignore "${misspelled}"`,
          kind: 'quickfix',
          diagnostics: [marker],
          edit: {
            edits: [
              {
                resource: model.uri,
                textEdit: {
                  range: {
                    startLineNumber: marker.startLineNumber,
                    startColumn: marker.startColumn,
                    endLineNumber: marker.endLineNumber,
                    endColumn: marker.endColumn,
                  },
                  // Replace with itself so no visible change; the onDidChangeModelContent
                  // listener will re-check, but we also push to the worker so it
                  // remembers the word across future checks.
                  text: misspelled,
                },
                versionId: model.getVersionId(),
              },
            ],
          },
        })
        // Post to worker immediately so it's in the personal dictionary before the re-check
        worker.postMessage({ type: 'addWord', word: misspelled })
      }

      return { actions, dispose: () => {} }
    },
  })

  // ── Wire editor events ────────────────────────────────────────────────────
  const contentDisposable = editor.onDidChangeModelContent(() => scheduleCheck())
  const modelDisposable = editor.onDidChangeModel(() => {
    const model = editor.getModel()
    if (model) monaco.editor.setModelMarkers(model, OWNER, [])
    suggestionMap.clear()
    scheduleCheck()
  })

  scheduleCheck()

  // ── setLocale ─────────────────────────────────────────────────────────────
  function setLocale(newLocale: SpellLocale) {
    const model = editor.getModel()
    if (model) monaco.editor.setModelMarkers(model, OWNER, [])
    suggestionMap.clear()
    worker.postMessage({ type: 'load', locale: newLocale })
  }

  // ── cleanup ───────────────────────────────────────────────────────────────
  function cleanup() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    contentDisposable.dispose()
    modelDisposable.dispose()
    codeActionDisposable.dispose()
    worker.terminate()
    const model = editor.getModel()
    if (model) monaco.editor.setModelMarkers(model, OWNER, [])
    suggestionMap.clear()
  }

  return { cleanup, setLocale }
}
