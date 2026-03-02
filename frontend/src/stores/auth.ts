import { create } from 'zustand'
import { authApi } from '../services/api'
import type { User } from '../types'

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  fetchUser: () => Promise<void>
  setToken: (token: string) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: false,

  login: async (email: string, password: string) => {
    set({ loading: true })
    try {
      const { data } = await authApi.login(email, password)
      localStorage.setItem('token', data.access_token)
      set({ token: data.access_token })
      await authApi.me().then((res) => set({ user: res.data }))
    } finally {
      set({ loading: false })
    }
  },

  register: async (email: string, password: string) => {
    set({ loading: true })
    try {
      await authApi.register(email, password)
      await authApi.login(email, password).then((res) => {
        localStorage.setItem('token', res.data.access_token)
        set({ token: res.data.access_token })
      })
      await authApi.me().then((res) => set({ user: res.data }))
    } finally {
      set({ loading: false })
    }
  },

  logout: () => {
    authApi.logout().catch(() => {})
    localStorage.removeItem('token')
    set({ user: null, token: null })
  },

  fetchUser: async () => {
    const token = localStorage.getItem('token')
    if (!token) return
    set({ token })
    try {
      const { data } = await authApi.me()
      set({ user: data })
    } catch {
      localStorage.removeItem('token')
      set({ user: null, token: null })
    }
  },

  setToken: (token: string) => {
    localStorage.setItem('token', token)
    set({ token })
  },
}))
