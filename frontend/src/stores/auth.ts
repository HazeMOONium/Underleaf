import { create } from 'zustand'
import { authApi } from '../services/api'
import type { User } from '../types'

export interface TwoFAChallenge {
  requires2FA: true
  sessionToken: string
}

interface AuthState {
  user: User | null
  token: string | null
  loading: boolean
  /** Resolves normally on success; throws TwoFAChallenge if 2FA is required. */
  login: (email: string, password: string) => Promise<void>
  completeTotpLogin: (sessionToken: string, code: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => void
  fetchUser: () => Promise<void>
  setToken: (token: string) => void
}

async function _storeToken(token: string, set: (s: Partial<AuthState>) => void) {
  localStorage.setItem('token', token)
  set({ token })
  const { data } = await authApi.me()
  set({ user: data })
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: false,

  login: async (email: string, password: string) => {
    set({ loading: true })
    try {
      const { data } = await authApi.login(email, password)
      if (data.requires_2fa && data.session_token) {
        const challenge: TwoFAChallenge = { requires2FA: true, sessionToken: data.session_token }
        throw challenge
      }
      await _storeToken(data.access_token!, set)
    } finally {
      set({ loading: false })
    }
  },

  completeTotpLogin: async (sessionToken: string, code: string) => {
    set({ loading: true })
    try {
      const { data } = await authApi.totpLogin(sessionToken, code)
      await _storeToken(data.access_token!, set)
    } finally {
      set({ loading: false })
    }
  },

  register: async (email: string, password: string) => {
    set({ loading: true })
    try {
      await authApi.register(email, password)
      const { data } = await authApi.login(email, password)
      await _storeToken(data.access_token!, set)
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
