import { useMemo } from 'react'

interface OutlineEntry {
  level: number
  title: string
  line: number
}

interface DocumentOutlineProps {
  content: string
  onNavigate: (line: number) => void
}

const HEADING_REGEX =
  /^\\(part|chapter|section|subsection|subsubsection)\*?\{([^}]*)\}/

const LEVEL_MAP: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
}

export function parseOutline(content: string): OutlineEntry[] {
  const entries: OutlineEntry[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADING_REGEX)
    if (match) {
      entries.push({
        level: LEVEL_MAP[match[1]] ?? 2,
        title: match[2],
        line: i + 1,
      })
    }
  }

  return entries
}

export default function DocumentOutline({
  content,
  onNavigate,
}: DocumentOutlineProps) {
  const entries = useMemo(() => parseOutline(content), [content])

  if (entries.length === 0) return null

  const minLevel = Math.min(...entries.map((e) => e.level))

  return (
    <div style={styles.container}>
      <div style={styles.header}>Outline</div>
      <ul style={styles.list}>
        {entries.map((entry, i) => (
          <li
            key={i}
            style={{
              ...styles.entry,
              paddingLeft: `${12 + (entry.level - minLevel) * 16}px`,
            }}
            onClick={() => onNavigate(entry.line)}
          >
            {entry.title}
          </li>
        ))}
      </ul>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {},
  header: {
    padding: '8px 16px',
    fontSize: '12px',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  entry: {
    padding: '4px 12px',
    fontSize: '12px',
    cursor: 'pointer',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    transition: 'background-color 0.1s',
  },
}
