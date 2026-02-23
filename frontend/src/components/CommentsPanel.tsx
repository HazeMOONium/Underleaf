import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { commentsApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import type { Comment, ProjectRole } from '../types'
import { canComment } from '../types'
import toast from 'react-hot-toast'

interface CommentsPanelProps {
  projectId: string
  currentFile: string
  focusLine: number | null
  role: ProjectRole
}

function timeAgo(dateStr: string) {
  const diff = (Date.now() - new Date(dateStr).getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return new Date(dateStr).toLocaleDateString()
}

interface ThreadProps {
  comment: Comment
  projectId: string
  currentUserId: string
  role: ProjectRole
}

function CommentThread({ comment, projectId, currentUserId, role }: ThreadProps) {
  const queryClient = useQueryClient()
  const [showReply, setShowReply] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editText, setEditText] = useState(comment.content)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['comments', projectId] })
  }

  const postReply = useMutation({
    mutationFn: () =>
      commentsApi.create(projectId, comment.file_path, comment.line, replyText, comment.id),
    onSuccess: () => {
      invalidate()
      setReplyText('')
      setShowReply(false)
    },
    onError: () => toast.error('Failed to post reply'),
  })

  const saveEdit = useMutation({
    mutationFn: () => commentsApi.update(projectId, comment.id, { content: editText }),
    onSuccess: () => { invalidate(); setEditMode(false) },
    onError: () => toast.error('Failed to update comment'),
  })

  const resolve = useMutation({
    mutationFn: (resolved: boolean) =>
      commentsApi.update(projectId, comment.id, { resolved }),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to update comment'),
  })

  const remove = useMutation({
    mutationFn: () => commentsApi.delete(projectId, comment.id),
    onSuccess: invalidate,
    onError: () => toast.error('Failed to delete comment'),
  })

  const isAuthor = comment.author_id === currentUserId
  const isPrivileged = role === 'owner' || role === 'editor'
  const isResolved = !!comment.resolved_at

  return (
    <div style={{ ...styles.thread, opacity: isResolved ? 0.6 : 1 }}>
      <div style={styles.threadHeader}>
        <span style={styles.lineTag}>Line {comment.line}</span>
        {isResolved && <span style={styles.resolvedBadge}>Resolved</span>}
      </div>

      {/* Top-level comment */}
      <CommentBubble
        comment={comment}
        isAuthor={isAuthor}
        isPrivileged={isPrivileged}
        editMode={editMode}
        editText={editText}
        onEditText={setEditText}
        onStartEdit={() => { setEditMode(true); setEditText(comment.content) }}
        onSaveEdit={() => saveEdit.mutate()}
        onCancelEdit={() => setEditMode(false)}
        onDelete={() => remove.mutate()}
      />

      {/* Replies */}
      {comment.replies.map((reply) => (
        <div key={reply.id} style={styles.replyIndent}>
          <ReplyBubble
            reply={reply}
            projectId={projectId}
            currentUserId={currentUserId}
            isPrivileged={isPrivileged}
          />
        </div>
      ))}

      {/* Actions row */}
      <div style={styles.actions}>
        {canComment(role) && !isResolved && (
          <button style={styles.actionBtn} onClick={() => setShowReply((v) => !v)}>
            Reply
          </button>
        )}
        {(isAuthor || isPrivileged) && !comment.parent_id && (
          <button
            style={styles.actionBtn}
            onClick={() => resolve.mutate(!isResolved)}
          >
            {isResolved ? 'Unresolve' : 'Resolve'}
          </button>
        )}
      </div>

      {/* Reply input */}
      {showReply && (
        <div style={styles.replyBox}>
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            placeholder="Write a reply…"
            style={styles.textarea}
            rows={2}
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button className="secondary" onClick={() => setShowReply(false)}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={!replyText.trim() || postReply.isPending}
              onClick={() => postReply.mutate()}
            >
              Reply
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function CommentBubble({
  comment,
  isAuthor,
  isPrivileged,
  editMode,
  editText,
  onEditText,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: {
  comment: Comment
  isAuthor: boolean
  isPrivileged: boolean
  editMode: boolean
  editText: string
  onEditText: (t: string) => void
  onStartEdit: () => void
  onSaveEdit: () => void
  onCancelEdit: () => void
  onDelete: () => void
}) {
  return (
    <div style={styles.bubble}>
      <div style={styles.bubbleHeader}>
        <span style={styles.author}>{comment.author_email}</span>
        <span style={styles.time}>{timeAgo(comment.created_at)}</span>
        <div style={styles.bubbleActions}>
          {isAuthor && !editMode && (
            <button style={styles.iconBtn} onClick={onStartEdit} title="Edit">✏️</button>
          )}
          {(isAuthor || isPrivileged) && (
            <button style={styles.iconBtn} onClick={onDelete} title="Delete">🗑</button>
          )}
        </div>
      </div>
      {editMode ? (
        <>
          <textarea
            value={editText}
            onChange={(e) => onEditText(e.target.value)}
            style={styles.textarea}
            rows={2}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
            <button className="secondary" onClick={onCancelEdit}>Cancel</button>
            <button className="primary" onClick={onSaveEdit} disabled={!editText.trim()}>Save</button>
          </div>
        </>
      ) : (
        <p style={styles.content}>{comment.content}</p>
      )}
    </div>
  )
}

function ReplyBubble({
  reply,
  projectId,
  currentUserId,
  isPrivileged,
}: {
  reply: Comment
  projectId: string
  currentUserId: string
  isPrivileged: boolean
}) {
  const queryClient = useQueryClient()
  const isAuthor = reply.author_id === currentUserId

  const remove = useMutation({
    mutationFn: () => commentsApi.delete(projectId, reply.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['comments', projectId] }),
    onError: () => toast.error('Failed to delete reply'),
  })

  return (
    <div style={styles.bubble}>
      <div style={styles.bubbleHeader}>
        <span style={styles.author}>{reply.author_email}</span>
        <span style={styles.time}>{timeAgo(reply.created_at)}</span>
        {(isAuthor || isPrivileged) && (
          <button style={styles.iconBtn} onClick={() => remove.mutate()} title="Delete">🗑</button>
        )}
      </div>
      <p style={styles.content}>{reply.content}</p>
    </div>
  )
}

export default function CommentsPanel({ projectId, currentFile, focusLine, role }: CommentsPanelProps) {
  const { user } = useAuthStore()
  const queryClient = useQueryClient()
  const [newContent, setNewContent] = useState('')
  const [newLine, setNewLine] = useState<number>(focusLine ?? 1)
  const [showResolved, setShowResolved] = useState(false)

  const { data: allComments = [], isLoading } = useQuery({
    queryKey: ['comments', projectId, currentFile],
    queryFn: () => commentsApi.list(projectId, currentFile).then((r) => r.data),
    refetchInterval: 5000,
  })

  const postComment = useMutation({
    mutationFn: () => commentsApi.create(projectId, currentFile, newLine, newContent),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', projectId] })
      setNewContent('')
      toast.success('Comment posted')
    },
    onError: () => toast.error('Failed to post comment'),
  })

  const visible = allComments.filter((c) => showResolved || !c.resolved_at)

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        <span style={styles.panelTitle}>Comments</span>
        <label style={styles.resolvedToggle}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            style={{ marginRight: 4 }}
          />
          Show resolved
        </label>
      </div>

      <div style={styles.scrollArea}>
        {isLoading ? (
          <p style={styles.empty}>Loading…</p>
        ) : visible.length === 0 ? (
          <p style={styles.empty}>No comments yet on this file.</p>
        ) : (
          visible.map((c) => (
            <CommentThread
              key={c.id}
              comment={c}
              projectId={projectId}
              currentUserId={user?.id ?? ''}
              role={role}
            />
          ))
        )}
      </div>

      {canComment(role) && (
        <div style={styles.newComment}>
          <div style={styles.lineRow}>
            <label style={styles.lineLabel}>Line:</label>
            <input
              type="number"
              min={1}
              value={newLine}
              onChange={(e) => setNewLine(Number(e.target.value))}
              style={styles.lineInput}
            />
          </div>
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Add a comment…"
            style={styles.textarea}
            rows={3}
          />
          <button
            className="primary"
            style={{ width: '100%', marginTop: 6 }}
            disabled={!newContent.trim() || postComment.isPending}
            onClick={() => postComment.mutate()}
          >
            {postComment.isPending ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    borderLeft: '1px solid var(--color-border)',
    backgroundColor: 'var(--color-surface)',
    width: 280,
    flexShrink: 0,
  },
  panelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '10px 14px',
    borderBottom: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  panelTitle: { fontWeight: 600, fontSize: 14 },
  resolvedToggle: { fontSize: 12, color: 'var(--color-text-muted)', cursor: 'pointer' },
  scrollArea: { flex: 1, overflowY: 'auto', padding: '8px 10px' },
  empty: { color: 'var(--color-text-muted)', fontSize: 13, textAlign: 'center', marginTop: 24 },
  newComment: {
    padding: '10px 12px',
    borderTop: '1px solid var(--color-border)',
    flexShrink: 0,
  },
  lineRow: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 },
  lineLabel: { fontSize: 13, color: 'var(--color-text-muted)' },
  lineInput: {
    width: 60,
    padding: '4px 6px',
    fontSize: 13,
    border: '1px solid var(--color-border)',
    borderRadius: 4,
  },
  textarea: {
    width: '100%',
    padding: '6px 8px',
    fontSize: 13,
    border: '1px solid var(--color-border)',
    borderRadius: 4,
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    boxSizing: 'border-box' as const,
  },
  thread: {
    marginBottom: 12,
    border: '1px solid var(--color-border)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  threadHeader: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    padding: '4px 10px',
    backgroundColor: 'var(--color-background)',
    borderBottom: '1px solid var(--color-border)',
  },
  lineTag: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-primary)',
  },
  resolvedBadge: {
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 8,
    backgroundColor: '#d1fae5',
    color: '#065f46',
  },
  replyIndent: { borderTop: '1px solid var(--color-border)', marginLeft: 8 },
  bubble: { padding: '8px 10px' },
  bubbleHeader: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 },
  author: { fontSize: 12, fontWeight: 600 },
  time: { fontSize: 11, color: 'var(--color-text-muted)', flex: 1 },
  bubbleActions: { display: 'flex', gap: 2 },
  iconBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    padding: '2px 4px',
    opacity: 0.6,
  },
  content: { fontSize: 13, margin: 0, lineHeight: 1.5, wordBreak: 'break-word' as const },
  actions: { display: 'flex', gap: 6, padding: '4px 10px', borderTop: '1px solid var(--color-border)' },
  actionBtn: {
    background: 'none',
    border: 'none',
    fontSize: 12,
    color: 'var(--color-primary)',
    cursor: 'pointer',
    padding: '2px 4px',
  },
  replyBox: { padding: '8px 10px', borderTop: '1px solid var(--color-border)' },
}
