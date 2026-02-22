export interface User {
  id: string
  email: string
  role: string
  created_at: string
}

export interface Project {
  id: string
  owner_id: string
  title: string
  visibility: 'private' | 'public'
  settings: string
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

export interface Token {
  access_token: string
  token_type: string
}
