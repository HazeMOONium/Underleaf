import { useQuery } from '@tanstack/react-query'
import { membersApi } from '../services/api'
import { useAuthStore } from '../stores/auth'
import type { ProjectRole } from '../types'

/**
 * Returns the current user's effective role in the given project.
 *  null  — still loading (query not yet resolved)
 *  false — loaded, user is NOT a member (access revoked / never had access)
 *  role  — loaded, user's current role
 */
export function useProjectRole(projectId: string | undefined): ProjectRole | null | false {
  const { user } = useAuthStore()

  const { data: members, isFetched, isError } = useQuery({
    queryKey: ['members', projectId],
    queryFn: () => membersApi.list(projectId!).then((r) => r.data),
    enabled: !!projectId && !!user,
    staleTime: 10_000,
    refetchInterval: 10_000,
    // Don't retry 403s — they are deterministic (access denied), not transient
    retry: (_count, err: any) => err?.response?.status !== 403,
  })

  if (!user) return null
  if (isError) return false                      // 403 = access denied; ignore stale cache
  if (!isFetched || !members) return null        // still loading
  const me = members.find((m) => m.user_id === user.id)
  if (!me) return false                          // loaded — user not in list
  return me.role as ProjectRole
}
