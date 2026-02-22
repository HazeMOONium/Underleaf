import axios from 'axios'
import type { User, Project, ProjectFile, CompileJob, Token } from '../types'

const api = axios.create({
  baseURL: '/api/v1',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

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
}

export const compileApi = {
  createJob: (projectId: string) =>
    api.post<CompileJob>('/compile/jobs', { project_id: projectId }),

  getJob: (jobId: string) => api.get<CompileJob>(`/compile/jobs/${jobId}`),

  getJobStatus: (jobId: string) =>
    api.get(`/compile/jobs/${jobId}/status`),

  getArtifact: (jobId: string) =>
    api.get(`/compile/jobs/${jobId}/artifact`, { responseType: 'blob' }),

  getLogs: (jobId: string) =>
    api.get<string>(`/compile/jobs/${jobId}/logs`),
}

export default api
