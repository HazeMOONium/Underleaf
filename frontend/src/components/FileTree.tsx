import { useState, useRef, useEffect, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
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
    const isGitkeep = parts[parts.length - 1] === '.gitkeep'
    if (parts.length === 1) {
      if (!isGitkeep) root.push({ name: file.path, path: file.path, type: 'file', children: [], file })
    } else {
      // Always create the parent folder (so empty folders stay visible),
      // but skip adding .gitkeep itself as a child node.
      const folder = getOrCreateFolder(parts.slice(0, -1))
      if (!isGitkeep) {
        folder.children.push({
          name: parts[parts.length - 1],
          path: file.path,
          type: 'file',
          children: [],
          file,
        })
      }
    }
  }

  const sortNodes = (nodes: FileTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => { if (n.children.length) sortNodes(n.children) })
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
  const [draggingNode, setDraggingNode] = useState<FileTreeNode | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  useEffect(() => {
    if (!ctxMenu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtxMenu(null) }
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setCtxMenu(null)
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

  const handleDragStart = (event: DragStartEvent) => {
    const id = event.active.id as string
    // Find node by path
    const findNode = (nodes: FileTreeNode[]): FileTreeNode | null => {
      for (const n of nodes) {
        if (n.path === id) return n
        const found = findNode(n.children)
        if (found) return found
      }
      return null
    }
    setDraggingNode(findNode(tree))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingNode(null)
    const { active, over } = event
    if (!over || !onRenameFile) return

    const fromPath = active.id as string
    const toFolder = over.id as string // '' = root, or folder path

    // Don't drop onto itself or its own parent
    const fromParts = fromPath.split('/')
    const fileName = fromParts[fromParts.length - 1]
    const currentParent = fromParts.slice(0, -1).join('/')

    if (toFolder === currentParent) return // Already in this folder
    if (toFolder === fromPath) return // Dropping file onto itself

    const newPath = toFolder ? `${toFolder}/${fileName}` : fileName
    if (newPath !== fromPath) {
      onRenameFile(fromPath, newPath)
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <>
        <ul style={styles.list}>
          {/* Root drop zone */}
          <RootDropZone canDrop={!!onRenameFile} />
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
              canDragDrop={!!onRenameFile}
            />
          ))}
        </ul>

        {/* Context menu */}
        {ctxMenu && (
          <div
            ref={menuRef}
            style={{ ...styles.ctxMenu, top: ctxMenu.y, left: ctxMenu.x }}
          >
            {ctxMenu.node.type === 'file' ? (
              <>
                {onRenameFile && (
                  <button style={styles.ctxItem} onClick={() => { setRenamingPath(ctxMenu.node.path); closeMenu() }}>
                    ✎ Rename
                  </button>
                )}
                {onDownloadFile && (
                  <button style={styles.ctxItem} onClick={() => { onDownloadFile(ctxMenu.node.path); closeMenu() }}>
                    ↓ Download
                  </button>
                )}
                {onDeleteFile && ctxMenu.node.path !== 'main.tex' && (
                  <>
                    <div style={styles.ctxDivider} />
                    <button
                      style={{ ...styles.ctxItem, ...styles.ctxItemDanger }}
                      onClick={() => {
                        if (window.confirm(`Delete "${ctxMenu.node.path}"?`)) onDeleteFile(ctxMenu.node.path)
                        closeMenu()
                      }}
                    >
                      ✕ Delete
                    </button>
                  </>
                )}
              </>
            ) : (
              <>
                {onNewFileInFolder && (
                  <button style={styles.ctxItem} onClick={() => { onNewFileInFolder(ctxMenu.node.path); closeMenu() }}>
                    + New File Here
                  </button>
                )}
                {onCreateFolder && (
                  <button style={styles.ctxItem} onClick={() => { onCreateFolder(ctxMenu.node.path); closeMenu() }}>
                    📁 New Subfolder
                  </button>
                )}
                {onRenameFile && (
                  <>
                    <div style={styles.ctxDivider} />
                    <button style={styles.ctxItem} onClick={() => { setRenamingPath(ctxMenu.node.path); closeMenu() }}>
                      ✎ Rename
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* Drag overlay */}
        <DragOverlay dropAnimation={null}>
          {draggingNode ? (
            <div className="dnd-drag-overlay" style={styles.dragOverlayItem}>
              <span style={styles.fileIcon}>{draggingNode.type === 'folder' ? '📁' : '☰'}</span>
              <span>{draggingNode.name}</span>
            </div>
          ) : null}
        </DragOverlay>
      </>
    </DndContext>
  )
}

// Invisible root droppable
function RootDropZone({ canDrop }: { canDrop: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: '' })
  if (!canDrop) return null
  return (
    <div
      ref={setNodeRef}
      style={{
        height: '4px',
        borderRadius: '2px',
        margin: '0 8px',
        transition: 'background var(--transition-fast)',
        background: isOver ? 'var(--color-brand)' : 'transparent',
      }}
    />
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
  canDragDrop,
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
  canDragDrop: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const [renameName, setRenameName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isMainTex = node.path === 'main.tex'
  const isRenaming = renamingPath === node.path

  // Draggable (files only - folders can be dragged too)
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({
    id: node.path,
    disabled: !canDragDrop || isRenaming,
  })

  // Droppable (folders only)
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: node.path,
    disabled: !canDragDrop || node.type !== 'folder',
  })

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
    // Combine drag + drop refs for folder
    const setRef = (el: HTMLElement | null) => {
      setDragRef(el)
      setDropRef(el)
    }

    return (
      <li style={{ ...styles.treeItem, opacity: isDragging ? 0.4 : 1 }}>
        <div
          ref={setRef}
          style={{
            ...styles.row,
            paddingLeft: `${12 + depth * 16}px`,
            ...(isOver ? styles.dropTarget : {}),
          }}
          onClick={() => setExpanded(!expanded)}
          onContextMenu={handleContextMenu}
          {...attributes}
          {...listeners}
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
              <span style={styles.folderChevron}>{expanded ? '▾' : '▸'}</span>
              <span style={styles.folderIcon}>📁</span>
              <span style={styles.folderName}>{node.name}</span>
              {onNewFileInFolder && (
                <button
                  style={styles.treeActionBtn}
                  onClick={(e) => { e.stopPropagation(); onNewFileInFolder(node.path) }}
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
                canDragDrop={canDragDrop}
              />
            ))}
          </ul>
        )}
      </li>
    )
  }

  // File node
  const isActive = currentFile === node.path
  const ext = node.name.split('.').pop()?.toLowerCase() ?? ''
  const fileIcon = ext === 'tex' ? '𝑇' : ext === 'bib' ? '📚' : ext === 'pdf' ? '📄' : '☰'

  return (
    <li style={{ ...styles.treeItem, opacity: isDragging ? 0.4 : 1 }}>
      <div
        ref={setDragRef}
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
        {...attributes}
        {...listeners}
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
            <span style={styles.fileIcon}>{fileIcon}</span>
            <span style={styles.nodeFileName}>{node.name}</span>
            {!isMainTex && onDeleteFile && (
              <button
                style={styles.treeActionBtn}
                onClick={(e) => {
                  e.stopPropagation()
                  if (window.confirm(`Delete "${node.path}"?`)) onDeleteFile(node.path)
                }}
                title="Delete"
              >
                ×
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
    transition: 'opacity var(--transition-fast)',
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: '5px',
    padding: '5px 8px',
    cursor: 'pointer',
    fontSize: '12.5px',
    color: 'var(--color-sidebar-text)',
    borderRadius: '4px',
    margin: '1px 6px',
    transition: 'background var(--transition-fast)',
  },
  activeRow: {
    backgroundColor: 'var(--color-sidebar-active)',
    color: 'white',
  },
  dropTarget: {
    backgroundColor: 'rgba(26, 127, 75, 0.25)',
    outline: '1.5px dashed var(--color-brand)',
  },
  folderChevron: {
    width: '10px',
    fontSize: '9px',
    flexShrink: 0,
    color: 'var(--color-sidebar-text-muted)',
  },
  folderIcon: {
    width: '14px',
    fontSize: '12px',
    flexShrink: 0,
  },
  folderName: {
    fontWeight: 600,
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontSize: '12.5px',
  },
  fileIcon: {
    width: '14px',
    fontSize: '11px',
    flexShrink: 0,
    opacity: 0.7,
    textAlign: 'center' as const,
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
    padding: '0 3px',
    fontSize: '14px',
    lineHeight: 1,
    color: 'rgba(255,255,255,0.4)',
    opacity: 0,
    flexShrink: 0,
    transition: 'opacity var(--transition-fast)',
  },
  renameInput: {
    flex: 1,
    fontSize: '12.5px',
    padding: '1px 4px',
    border: '1px solid var(--color-brand)',
    borderRadius: '2px',
    outline: 'none',
    minWidth: 0,
    backgroundColor: 'var(--color-sidebar-bg)',
    color: 'white',
  },
  ctxMenu: {
    position: 'fixed' as const,
    zIndex: 9999,
    backgroundColor: '#ffffff',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    boxShadow: 'var(--shadow-xl)',
    padding: '6px',
    minWidth: '160px',
  },
  ctxItem: {
    display: 'block',
    width: '100%',
    padding: '8px 12px',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontSize: '13px',
    cursor: 'pointer',
    color: 'var(--color-text)',
    borderRadius: 'var(--radius-md)',
    transition: 'background var(--transition-fast)',
  },
  ctxItemDanger: {
    color: '#dc2626',
  },
  ctxDivider: {
    height: '1px',
    backgroundColor: 'var(--color-border)',
    margin: '4px 0',
  },
  dragOverlayItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 12px',
    backgroundColor: 'var(--color-sidebar-bg)',
    color: 'white',
    borderRadius: 'var(--radius-md)',
    fontSize: '13px',
    border: '1px solid rgba(255,255,255,0.15)',
  },
}
