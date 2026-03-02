import axios from 'axios'
import type { User, Project, ProjectFile, CompileJob, Snapshot, Token, Member, ProjectInvite, InvitePreview, Comment } from '../types'

const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true, // send httpOnly refresh_token cookie on every request
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Silent token refresh — on 401 attempt one refresh, then retry
let _isRefreshing = false
let _refreshQueue: Array<(token: string) => void> = []

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config
    // Skip retry for auth endpoints and already-retried requests
    if (
      error.response?.status !== 401 ||
      original._retry ||
      original.url?.includes('/auth/')
    ) {
      return Promise.reject(error)
    }

    original._retry = true

    if (_isRefreshing) {
      // Queue this request until the ongoing refresh completes
      return new Promise((resolve) => {
        _refreshQueue.push((newToken) => {
          original.headers.Authorization = `Bearer ${newToken}`
          resolve(api(original))
        })
      })
    }

    _isRefreshing = true
    try {
      const { data } = await api.post<Token>('/auth/refresh')
      const newToken = data.access_token
      localStorage.setItem('token', newToken)

      _refreshQueue.forEach((cb) => cb(newToken))
      _refreshQueue = []

      original.headers.Authorization = `Bearer ${newToken}`
      return api(original)
    } catch {
      // Refresh failed — clear local state and redirect to login
      localStorage.removeItem('token')
      _refreshQueue = []
      window.location.href = '/login'
      return Promise.reject(error)
    } finally {
      _isRefreshing = false
    }
  },
)

export const authApi = {
  register: (email: string, password: string) =>
    api.post<User>('/auth/register', { email, password }),

  login: (email: string, password: string) => {
    const formData = new URLSearchParams()
    formData.append('username', email)
    formData.append('password', password)
    return api.post<Token>('/auth/login', formData, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
  },

  me: () => api.get<User>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/auth/me/password', { current_password: currentPassword, new_password: newPassword }),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (token: string, newPassword: string) =>
    api.post('/auth/reset-password', { token, new_password: newPassword }),

  verifyEmail: (token: string) =>
    api.post('/auth/verify-email', { token }),

  refresh: () => api.post<Token>('/auth/refresh'),

  logout: () => api.post('/auth/logout'),
}

export const projectsApi = {
  list: () => api.get<Project[]>('/projects'),

  get: (id: string) => api.get<Project>(`/projects/${id}`),

  create: (title: string, visibility: string = 'private') =>
    api.post<Project>('/projects', { title, visibility }),

  update: (id: string, data: Partial<Project>) =>
    api.patch<Project>(`/projects/${id}`, data),

  delete: (id: string) => api.delete(`/projects/${id}`),

  listFiles: (projectId: string) =>
    api.get<ProjectFile[]>(`/projects/${projectId}/files`),

  getFile: (projectId: string, path: string) =>
    api.get<string>(`/projects/${projectId}/files/${path}`),

  createFile: (projectId: string, path: string, content: string) =>
    api.post<ProjectFile>(`/projects/${projectId}/files`, { path, content }),

  deleteFile: (projectId: string, path: string) =>
    api.delete(`/projects/${projectId}/files/${path}`),

  renameFile: (projectId: string, oldPath: string, newPath: string) =>
    api.patch<ProjectFile>(`/projects/${projectId}/files/${oldPath}`, {
      new_path: newPath,
    }),

  uploadBinaryFile: (projectId: string, path: string, contentBase64: string) =>
    api.post(`/projects/${projectId}/files/upload`, { path, content_base64: contentBase64 }),

  /** Stream-upload a raw File object via multipart/form-data (no base64 overhead). */
  uploadFile: (projectId: string, path: string, file: File) => {
    const form = new FormData()
    form.append('path', path)
    form.append('file', file)
    return api.post(`/projects/${projectId}/files/stream`, form)
  },

  exportZip: (projectId: string) =>
    api.get(`/projects/${projectId}/export/zip`, { responseType: 'blob' }),
}

export const compileApi = {
  createJob: (projectId: string, draft = false) =>
    api.post<CompileJob>('/compile/jobs', { project_id: projectId, draft }),

  getJob: (jobId: string) => api.get<CompileJob>(`/compile/jobs/${jobId}`),

  getJobStatus: (jobId: string) =>
    api.get(`/compile/jobs/${jobId}/status`),

  getArtifact: (jobId: string) =>
    api.get(`/compile/jobs/${jobId}/artifact`, { responseType: 'blob' }),

  getLogs: (jobId: string) =>
    api.get<string>(`/compile/jobs/${jobId}/logs`),

  getSyncTeX: (jobId: string) =>
    api.get(`/compile/jobs/${jobId}/synctex`, { responseType: 'arraybuffer' }),
}

export const membersApi = {
  list: (projectId: string) =>
    api.get<Member[]>(`/projects/${projectId}/members`),

  add: (projectId: string, email: string, role: string) =>
    api.post<Member>(`/projects/${projectId}/members`, { email, role }),

  update: (projectId: string, userId: string, role: string) =>
    api.patch<Member>(`/projects/${projectId}/members/${userId}`, { role }),

  remove: (projectId: string, userId: string) =>
    api.delete(`/projects/${projectId}/members/${userId}`),
}

export const invitesApi = {
  list: (projectId: string) =>
    api.get<ProjectInvite[]>(`/projects/${projectId}/invites`),

  create: (projectId: string, role: string, maxUses?: number, expiresHours?: number) =>
    api.post<ProjectInvite>(`/projects/${projectId}/invites`, {
      role,
      max_uses: maxUses ?? null,
      expires_hours: expiresHours ?? null,
    }),

  revoke: (projectId: string, inviteId: string) =>
    api.delete(`/projects/${projectId}/invites/${inviteId}`),

  preview: (token: string) =>
    api.get<InvitePreview>(`/invites/${token}`),

  accept: (token: string) =>
    api.post<Member>(`/invites/${token}/accept`),
}

export const snapshotsApi = {
  list: (projectId: string) =>
    api.get<Snapshot[]>(`/projects/${projectId}/snapshots`),

  getArtifact: (projectId: string, snapshotId: string) =>
    api.get(`/projects/${projectId}/snapshots/${snapshotId}/artifact`, { responseType: 'blob' }),

  updateLabel: (projectId: string, snapshotId: string, label: string) =>
    api.patch<Snapshot>(`/projects/${projectId}/snapshots/${snapshotId}`, { label }),

  delete: (projectId: string, snapshotId: string) =>
    api.delete(`/projects/${projectId}/snapshots/${snapshotId}`),
}

export const commentsApi = {
  list: (projectId: string, filePath?: string) =>
    api.get<Comment[]>(`/projects/${projectId}/comments`, {
      params: filePath ? { file_path: filePath } : {},
    }),

  create: (
    projectId: string,
    filePath: string,
    line: number,
    content: string,
    parentId?: string,
  ) =>
    api.post<Comment>(`/projects/${projectId}/comments`, {
      file_path: filePath,
      line,
      content,
      parent_id: parentId ?? null,
    }),

  update: (
    projectId: string,
    commentId: string,
    patch: { content?: string; resolved?: boolean },
  ) => api.patch<Comment>(`/projects/${projectId}/comments/${commentId}`, patch),

  delete: (projectId: string, commentId: string) =>
    api.delete(`/projects/${projectId}/comments/${commentId}`),
}

export default api
