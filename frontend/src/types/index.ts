export interface User {
  id: string
  email: string
  role: string
  email_verified: boolean
  totp_enabled: boolean
  created_at: string
}

export interface Project {
  id: string
  owner_id: string
  title: string
  visibility: 'private' | 'public'
  settings: string
  engine: string
  created_at: string
  updated_at: string
}

export interface ProjectFile {
  id: string
  project_id: string
  path: string
  blob_ref: string | null
  size: number
  updated_at: string
}

export interface CompileJob {
  id: string
  project_id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  logs_ref: string | null
  artifact_ref: string | null
  error_message: string | null
  created_at: string
  finished_at: string | null
}

export interface Snapshot {
  id: string
  project_id: string
  compile_job_id: string
  label: string | null
  artifact_ref: string | null
  created_at: string
}

export interface Token {
  access_token: string
  token_type: string
}

export interface LoginResponse {
  access_token?: string
  token_type: string
  requires_2fa: boolean
  session_token?: string
}

// ── Collaboration ─────────────────────────────────────────────────────────

export type ProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer'

export const ROLE_ORDER: Record<ProjectRole, number> = {
  viewer: 0,
  commenter: 1,
  editor: 2,
  owner: 3,
}

export function roleGte(a: ProjectRole, b: ProjectRole): boolean {
  return ROLE_ORDER[a] >= ROLE_ORDER[b]
}

export function canEdit(role: ProjectRole): boolean {
  return roleGte(role, 'editor')
}

export function canComment(role: ProjectRole): boolean {
  return roleGte(role, 'commenter')
}

export function canManageMembers(role: ProjectRole): boolean {
  return role === 'owner'
}

export interface Member {
  user_id: string
  email: string
  role: ProjectRole
  granted_at: string | null
}

export interface ProjectInvite {
  id: string
  token: string
  role: ProjectRole
  use_count: number
  max_uses: number | null
  expires_at: string | null
  created_at: string
}

export interface InvitePreview {
  project_id: string
  project_title: string
  role: ProjectRole
  created_by_email: string
}

export interface Comment {
  id: string
  project_id: string
  file_path: string
  line: number
  author_id: string
  author_email: string
  content: string
  parent_id: string | null
  created_at: string
  resolved_at: string | null
  replies: Comment[]
}
