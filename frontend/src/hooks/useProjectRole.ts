import { useQuery } from '@tanstack/react-query'
import { membersApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import type { ProjectRole } from '../types'

/**
 * Returns the current user's effective role in the given project,
 * or null while loading / when not a member.
 */
export function useProjectRole(projectId: string | undefined): ProjectRole | null {
  const { user } = useAuthStore()

  const { data: members } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => membersApi.list(projectId!).then((r) => r.data),
    enabled: !!projectId && !!user,
    staleTime: 30_000,
  })

  if (!members || !user) return null
  const me = members.find((m) => m.user_id === user.id)
  return (me?.role as ProjectRole) ?? null
}
