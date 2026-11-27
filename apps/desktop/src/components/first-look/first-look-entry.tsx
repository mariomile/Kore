import { useEffect, useRef } from 'react'
import { useGraph } from '@/providers/graph-provider'
import { useRouter } from '@/routing/router'

/**
 * Takes a vault's first open in Kore to its first look (the Insights page in
 * arrival mode), once per open. Renders nothing; mounted inside the router
 * on the Mac and the iPhone alike.
 */
export function FirstLookEntry(): null {
  const { firstLook } = useGraph()
  const { navigate } = useRouter()
  const shownFor = useRef<number | null>(null)
  const startedAt = firstLook?.startedAt ?? null

  useEffect(() => {
    if (startedAt === null || shownFor.current === startedAt) {
      return
    }
    shownFor.current = startedAt
    navigate({ kind: 'insights' })
  }, [navigate, startedAt])

  return null
}
