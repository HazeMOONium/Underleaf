import { useState, useRef, useEffect } from 'react'
import type { ProjectFile } from '../types'

interface FileTreeNode {
  name: string
  path: string
  type: 'file' | 'folder'
  children: FileTreeNode[]
  file?: ProjectFile
}

interface FileTreeProps {
  files: ProjectFile[]
  currentFile: string
  onSelectFile: (path: string) => void
  onDeleteFile: (path: string) => void
  onRenameFile: (oldPath: string, newPath: string) => void
  onNewFileInFolder?: (folderPath: string) => void
}

function buildFileTree(files: ProjectFile[]): FileTreeNode[] {
  const root: FileTreeNode[] = []
  const folderMap = new Map<string, FileTreeNode>()

  const getOrCreateFolder = (parts: string[]): FileTreeNode => {
    const path = parts.join('/')
    if (folderMap.has(path)) return folderMap.get(path)!

    const node: FileTreeNode = {
      name: parts[parts.length - 1],
      path,
      type: 'folder',
      children: [],
    }
    folderMap.set(path, node)

    if (parts.length === 1) {
      root.push(node)
    } else {
      const parent = getOrCreateFolder(parts.slice(0, -1))
      parent.children.push(node)
    }

    return node
  }

  for (const file of files) {
    const parts = file.path.split('/')
    if (parts.length === 1) {
      root.push({
        name: file.path,
        path: file.path,
        type: 'file',
        children: [],
        file,
      })
    } else {
      const folder = getOrCreateFolder(parts.slice(0, -1))
      folder.children.push({
        name: parts[parts.length - 1],
        path: file.path,
        type: 'file',
        children: [],
        file,
      })
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => {
      if (n.children.length) sortNodes(n.children)
    })
  }
  sortNodes(root)

  return root
}

export default function FileTree({
  files,
  currentFile,
  onSelectFile,
  onDeleteFile,
  onRenameFile,
  onNewFileInFolder,
}: FileTreeProps) {
  const tree = buildFileTree(files)

  return (
    <ul style={styles.list}>
      {tree.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          currentFile={currentFile}
          onSelectFile={onSelectFile}
          onDeleteFile={onDeleteFile}
          onRenameFile={onRenameFile}
          onNewFileInFolder={onNewFileInFolder}
          depth={0}
        />
      ))}
    </ul>
  )
}

function TreeNode({
  node,
  currentFile,
  onSelectFile,
  onDeleteFile,
  onRenameFile,
  onNewFileInFolder,
  depth,
}: {
  node: FileTreeNode
  currentFile: string
  onSelectFile: (path: string) => void
  onDeleteFile: (path: string) => void
  onRenameFile: (oldPath: string, newPath: string) => void
  onNewFileInFolder?: (folderPath: string) => void
  depth: number
}) {
  const [expanded, setExpanded] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [renameName, setRenameName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isMainTex = node.path === 'main.tex'

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus()
      const dotIdx = renameName.lastIndexOf('.')
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : renameName.length)
    }
  }, [renaming])

  const startRename = () => {
    setRenameName(node.name)
    setRenaming(true)
  }

  const submitRename = () => {
    const trimmed = renameName.trim()
    if (trimmed && trimmed !== node.name) {
      const parts = node.path.split('/')
      parts[parts.length - 1] = trimmed
      onRenameFile(node.path, parts.join('/'))
    }
    setRenaming(false)
  }

  if (node.type === 'folder') {
    return (
      <li style={styles.treeItem}>
        <div
          style={{ ...styles.row, paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          <span style={styles.folderIcon}>{expanded ? '\u25BE' : '\u25B8'}</span>
          <span style={styles.folderName}>{node.name}</span>
          {onNewFileInFolder && (
            <button
              style={styles.treeActionBtn}
              onClick={(e) => {
                e.stopPropagation()
                onNewFileInFolder(node.path)
              }}
              title="New file here"
            >
              +
            </button>
          )}
        </div>
        {expanded && (
          <ul style={styles.list}>
            {node.children.map((child) => (
              <TreeNode
                key={child.path}
                node={child}
                currentFile={currentFile}
                onSelectFile={onSelectFile}
                onDeleteFile={onDeleteFile}
                onRenameFile={onRenameFile}
                onNewFileInFolder={onNewFileInFolder}
                depth={depth + 1}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  const isActive = currentFile === node.path

  return (
    <li style={styles.treeItem}>
      <div
        style={{
          ...styles.row,
          paddingLeft: `${12 + depth * 16}px`,
          ...(isActive ? styles.activeRow : {}),
        }}
        onClick={() => onSelectFile(node.path)}
        onDoubleClick={() => {
          if (!isMainTex) startRename()
        }}
      >
        {renaming ? (
          <input
            ref={inputRef}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') setRenaming(false)
            }}
            onBlur={submitRename}
            onClick={(e) => e.stopPropagation()}
            style={styles.renameInput}
          />
        ) : (
          <>
            <span style={styles.fileIcon}>{'\u2630'}</span>
            <span style={styles.nodeFileName}>{node.name}</span>
            {!isMainTex && (
              <button
                style={styles.treeActionBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`Delete "${node.path}"?`)) {
                    onDeleteFile(node.path)
                  }
                }}
                title="Delete"
              >
                &times;
              </button>
            )}
          </>
        )}
      </div>
    </li>
  )
}

const styles: Record<string, React.CSSProperties> = {
  list: {
    listStyle: 'none',
    padding: 0,
    margin: 0,
  },
  treeItem: {
    userSelect: 'none',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    padding: '4px 8px',
    cursor: 'pointer',
    fontSize: '13px',
    transition: 'background-color 0.1s',
  },
  activeRow: {
    backgroundColor: 'var(--color-secondary)',
    color: 'white',
  },
  folderIcon: {
    width: '12px',
    fontSize: '10px',
    flexShrink: 0,
  },
  folderName: {
    fontWeight: 600,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fileIcon: {
    width: '12px',
    fontSize: '10px',
    flexShrink: 0,
    opacity: 0.5,
  },
  nodeFileName: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  treeActionBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0 4px',
    fontSize: '14px',
    lineHeight: 1,
    color: 'inherit',
    opacity: 0.6,
    flexShrink: 0,
  },
  renameInput: {
    flex: 1,
    fontSize: '13px',
    padding: '1px 4px',
    border: '1px solid var(--color-primary)',
    borderRadius: '2px',
    outline: 'none',
    minWidth: 0,
  },
}
