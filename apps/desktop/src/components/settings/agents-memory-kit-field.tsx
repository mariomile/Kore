import { useState, type ReactElement } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check } from '@/components/icons'
import { allowKitScript, errorMessage, kitScriptStatus } from '@kore/core'
import { SettingsField } from '@/components/settings/field'
import { Button } from '@/components/ui/button'
import { useBridgeReady } from '@/hooks/use-bridge-ready'

interface AgentsMemoryKitFieldProps {
  graphRoot: string
  generation: number
}

/**
 * The vault's cyber-brain kit (Plan 35), when it has one: Kore's chat and
 * `kore mcp` write memory by running the vault's own script, and only the
 * script content the user allowed here runs. A synced edit to the script
 * takes the permission back until it is allowed again.
 */
export function AgentsMemoryKitField({
  graphRoot,
  generation,
}: AgentsMemoryKitFieldProps): ReactElement | null {
  const queryClient = useQueryClient()
  const bridgeReady = useBridgeReady()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const queryKey = ['kit-script-status', graphRoot]
  const { data: status } = useQuery({
    queryKey,
    queryFn: kitScriptStatus,
    enabled: bridgeReady,
  })

  if (status == null) {
    return null
  }

  async function allow(digest: string): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      queryClient.setQueryData(queryKey, await allowKitScript(digest, generation))
    } catch (caught) {
      setError(errorMessage(caught))
      await queryClient.invalidateQueries({ queryKey })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsField
      legend="Memory (cyber-brain)"
      description={`This vault keeps memory with cyber-brain ${status.version}. Kore’s chat and kore mcp write facts, loops and decisions by running the vault’s own script, the same one every other agent uses.`}
    >
      <div className="mt-2 flex flex-col gap-2 text-xs">
        <p className="truncate font-mono text-text-muted" title={status.script}>
          {status.script} · {status.digest.slice(0, 12)}
        </p>
        {status.trust === 'trusted' ? (
          <span className="inline-flex items-center gap-1 text-text-secondary">
            <Check aria-hidden className="size-3.5" />
            Allowed to run
          </span>
        ) : (
          <div className="flex flex-col items-start gap-2">
            <p className="text-text-secondary">
              {status.trust === 'new'
                ? 'Kore hasn’t run this script on this Mac yet. Memory writes wait until you allow it.'
                : 'The script changed since you allowed it (a sync or an edit). Memory writes wait until you allow this version.'}
            </p>
            <Button size="xs" disabled={busy} onClick={() => void allow(status.digest)}>
              Allow this script
            </Button>
          </div>
        )}
        {error !== null ? <p className="text-destructive">{error}</p> : null}
      </div>
    </SettingsField>
  )
}
