import { useEffect } from 'react'
import { getVaultLayout, type GraphInfo } from '@reflect/core'
import { toast } from '@/components/ui/toast'
import { useVaultCompatReport } from '@/hooks/use-vault-compat-report'
import { settingsRoute } from '@/routing/route'
import { useRouter } from '@/routing/router'

function offeredKey(root: string): string {
  return `kore.vault-compat.offered:${root}`
}

function wasOffered(root: string): boolean {
  try {
    return localStorage.getItem(offeredKey(root)) === '1'
  } catch {
    return false
  }
}

function markOffered(root: string): void {
  try {
    localStorage.setItem(offeredKey(root), '1')
  } catch {
    // Storage is unavailable: the notice may show again next launch.
  }
}

/**
 * The first time an Obsidian vault opens in Kore, scan it once and, when it
 * holds things Kore can't render, say so in a toast that opens the report
 * (Settings → Sync & data → Obsidian compatibility). Once per vault, found
 * or not, so later launches never pay for a scan nobody asked for.
 */
interface VaultCompatNoticeProps {
  readonly graph: GraphInfo
}

export function VaultCompatNotice({ graph }: VaultCompatNoticeProps): null {
  const { navigate } = useRouter()
  const root = graph.root
  const eligible = getVaultLayout().obsidian && !wasOffered(root)
  const { report } = useVaultCompatReport(graph, eligible)

  useEffect(() => {
    if (!eligible || report === null) {
      return
    }
    markOffered(root)
    if (report.groups.length === 0) {
      return
    }
    const notes = report.affectedNotes === 1 ? '1 note uses' : `${report.affectedNotes} notes use`
    const id = toast.add({
      title: 'Some of this vault looks different in Kore',
      description: `${notes} Obsidian plugins or formats Kore doesn't render yet.`,
      timeout: 15_000,
      actionProps: {
        children: 'View report',
        onClick: () => {
          toast.close(id)
          navigate(settingsRoute('data'))
        },
      },
    })
  }, [eligible, root, report, navigate])

  return null
}
