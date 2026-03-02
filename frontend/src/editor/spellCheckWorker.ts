import nspell from 'nspell'
import type { WordEntry } from './latexTextExtractor'

export type SpellLocale = 'en-us' | 'en-gb'

interface CheckResult {
  word: string
  lineNumber: number
  startColumn: number
  endColumn: number
  suggestions: string[]
}

let checker: ReturnType<typeof nspell> | null = null
let loadedLocale = ''

// Personal dictionary stored in worker memory (synced from main thread)
let personalWords = new Set<string>()

async function loadDictionary(locale: SpellLocale): Promise<void> {
  if (loadedLocale === locale && checker) return

  const base = `/dictionaries/${locale}`
  const [affRes, dicRes] = await Promise.all([
    fetch(`${base}.aff`),
    fetch(`${base}.dic`),
  ])

  if (!affRes.ok || !dicRes.ok) {
    console.warn(`[spell worker] Failed to fetch dictionaries for ${locale}`)
    return
  }

  const [aff, dic] = await Promise.all([affRes.text(), dicRes.text()])
  checker = nspell(aff, dic)

  // Re-add personal words to the new checker
  for (const w of personalWords) {
    checker.add(w)
  }

  loadedLocale = locale
}

self.addEventListener('message', async (e: MessageEvent) => {
  const msg = e.data

  if (msg.type === 'load') {
    await loadDictionary(msg.locale as SpellLocale)
    self.postMessage({ type: 'loaded', locale: msg.locale })
    return
  }

  if (msg.type === 'addWord') {
    personalWords.add((msg.word as string).toLowerCase())
    checker?.add(msg.word as string)
    self.postMessage({ type: 'wordAdded', word: msg.word })
    return
  }

  if (msg.type === 'check') {
    if (!checker) {
      self.postMessage({ type: 'result', id: msg.id, results: [] })
      return
    }

    const results: CheckResult[] = []
    const words = msg.words as WordEntry[]

    for (const entry of words) {
      const lc = entry.word.toLowerCase()
      // Skip personal dictionary words
      if (personalWords.has(lc)) continue
      if (!checker.correct(entry.word) && !checker.correct(lc)) {
        results.push({
          word: entry.word,
          lineNumber: entry.lineNumber,
          startColumn: entry.startColumn,
          endColumn: entry.endColumn,
          suggestions: checker.suggest(entry.word).slice(0, 6),
        })
      }
    }

    self.postMessage({ type: 'result', id: msg.id, results })
    return
  }
})
