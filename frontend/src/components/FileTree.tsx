import { useState, useRef, useEffect, useCallback } from 'react'
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
  onDeleteFile?: (path: string) => void
  onRenameFile?: (oldPath: string, newPath: string) => void
  onNewFileInFolder?: (folderPath: string) => void
  onCreateFolder?: (parentFolderPath: string) => void
  onDownloadFile?: (path: string) => void
}

interface CtxMenu {
  x: number
  y: number
  node: FileTreeNode
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
  onCreateFolder,
  onDownloadFile,
}: FileTreeProps) {
  const tree = buildFileTree(files)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!ctxMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [ctxMenu])

  const handleContextMenu = useCallback((x: number, y: number, node: FileTreeNode) => {
    setCtxMenu({ x, y, node })
  }, [])

  const closeMenu = () => setCtxMenu(null)

  return (
    <>
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
            onContextMenu={handleContextMenu}
            depth={0}
            renamingPath={renamingPath}
            setRenamingPath={setRenamingPath}
          />
        ))}
      </ul>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={menuRef}
          style={{
            ...styles.ctxMenu,
            top: ctxMenu.y,
            left: ctxMenu.x,
          }}
        >
          {ctxMenu.node.type === 'file' ? (
            <>
              {onRenameFile && (
                <button
                  style={styles.ctxItem}
                  onClick={() => {
                    setRenamingPath(ctxMenu.node.path)
                    closeMenu()
                  }}
                >
                  Rename
                </button>
              )}
              {onDownloadFile && (
                <button
                  style={styles.ctxItem}
                  onClick={() => {
                    onDownloadFile(ctxMenu.node.path)
                    closeMenu()
                  }}
                >
                  Download
                </button>
              )}
              {onDeleteFile && ctxMenu.node.path !== 'main.tex' && (
                <>
                  <div style={styles.ctxDivider} />
                  <button
                    style={{ ...styles.ctxItem, ...styles.ctxItemDanger }}
                    onClick={() => {
                      if (window.confirm(`Delete "${ctxMenu.node.path}"?`)) {
                        onDeleteFile(ctxMenu.node.path)
                      }
                      closeMenu()
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              {onNewFileInFolder && (
                <button
                  style={styles.ctxItem}
                  onClick={() => {
                    onNewFileInFolder(ctxMenu.node.path)
                    closeMenu()
                  }}
                >
                  New File Here
                </button>
              )}
              {onCreateFolder && (
                <button
                  style={styles.ctxItem}
                  onClick={() => {
                    onCreateFolder(ctxMenu.node.path)
                    closeMenu()
                  }}
                >
                  New Subfolder
                </button>
              )}
              {onRenameFile && (
                <>
                  <div style={styles.ctxDivider} />
                  <button
                    style={styles.ctxItem}
                    onClick={() => {
                      setRenamingPath(ctxMenu.node.path)
                      closeMenu()
                    }}
                  >
                    Rename
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </>
  )
}

function TreeNode({
  node,
  currentFile,
  onSelectFile,
  onDeleteFile,
  onRenameFile,
  onNewFileInFolder,
  onContextMenu,
  depth,
  renamingPath,
  setRenamingPath,
}: {
  node: FileTreeNode
  currentFile: string
  onSelectFile: (path: string) => void
  onDeleteFile?: (path: string) => void
  onRenameFile?: (oldPath: string, newPath: string) => void
  onNewFileInFolder?: (folderPath: string) => void
  onContextMenu: (x: number, y: number, node: FileTreeNode) => void
  depth: number
  renamingPath: string | null
  setRenamingPath: (path: string | null) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const [renameName, setRenameName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isMainTex = node.path === 'main.tex'
  const isRenaming = renamingPath === node.path

  // Autofocus rename input when this node enters rename mode
  useEffect(() => {
    if (isRenaming) {
      setRenameName(node.name)
      requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          const dotIdx = node.name.lastIndexOf('.')
          inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : node.name.length)
        }
      })
    }
  }, [isRenaming, node.name])

  const submitRename = () => {
    const trimmed = renameName.trim()
    if (trimmed && trimmed !== node.name && onRenameFile) {
      const parts = node.path.split('/')
      parts[parts.length - 1] = trimmed
      onRenameFile(node.path, parts.join('/'))
    }
    setRenamingPath(null)
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    onContextMenu(e.clientX, e.clientY, node)
  }

  if (node.type === 'folder') {
    return (
      <li style={styles.treeItem}>
        <div
          style={{ ...styles.row, paddingLeft: `${12 + depth * 16}px` }}
          onClick={() => setExpanded(!expanded)}
          onContextMenu={handleContextMenu}
        >
          {isRenaming ? (
            <input
              ref={inputRef}
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitRename()
                if (e.key === 'Escape') setRenamingPath(null)
              }}
              onBlur={submitRename}
              onClick={(e) => e.stopPropagation()}
              style={styles.renameInput}
            />
          ) : (
            <>
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
            </>
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
                onContextMenu={onContextMenu}
                depth={depth + 1}
                renamingPath={renamingPath}
                setRenamingPath={setRenamingPath}
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
          if (!isMainTex && onRenameFile) {
            setRenameName(node.name)
            setRenamingPath(node.path)
          }
        }}
        onContextMenu={handleContextMenu}
      >
        {isRenaming ? (
          <input
            ref={inputRef}
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitRename()
              if (e.key === 'Escape') setRenamingPath(null)
            }}
            onBlur={submitRename}
            onClick={(e) => e.stopPropagation()}
            style={styles.renameInput}
          />
        ) : (
          <>
            <span style={styles.fileIcon}>{'\u2630'}</span>
            <span style={styles.nodeFileName}>{node.name}</span>
            {!isMainTex && onDeleteFile && (
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
  ctxMenu: {
    position: 'fixed' as const,
    zIndex: 9999,
    backgroundColor: 'var(--color-surface)',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
    padding: '4px 0',
    minWidth: '140px',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    padding: '7px 14px',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontSize: '13px',
    cursor: 'pointer',
    color: 'var(--color-text)',
  },
  ctxItemDanger: {
    color: '#dc2626',
  },
  ctxDivider: {
    height: '1px',
    backgroundColor: 'var(--color-border)',
    margin: '4px 0',
  },
}
