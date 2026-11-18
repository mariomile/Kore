import { useState, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'
import { useOptionalRouter } from '@/routing/router'
import { settingsRoute } from '@/routing/route'
import { useSyncContext } from '@/providers/sync-provider'
import { CopyButton } from './copy-button'
import { SettingsField } from './field'

/**
 * Settings → Agents → Agent access → "With their own computer": agents that
 * run in their own sandbox (Claude Code on the web, Codex cloud) reach the
 * vault by cloning its GitHub repository, so the only setup is GitHub sync.
 * Shows that repository when sync is on, and the way to turn it on when not.
 */
export function AgentsRepoAccessField(): ReactElement {
  const sync = useSyncContext()
  const router = useOptionalRouter()
  const [error, setError] = useState<string | null>(null)
  const backup = sync?.backup ?? null
  const repo = backup?.phase === 'connected' ? backup.repo : null
  const repoUrl = repo === null ? null : `https://github.com/${repo.owner}/${repo.name}`

  return (
    <SettingsField
      legend="GitHub repository"
      description={
        repo !== null
          ? 'Give the agent access to this repository. It reads the notes as Markdown, even when this Mac is off.'
          : 'These agents read the vault from its GitHub repository. Turn on GitHub sync first.'
      }
    >
      {repo !== null && repoUrl !== null ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="truncate font-mono text-xs text-text-secondary select-text">
            {repo.owner}/{repo.name}
          </span>
          <CopyButton
            text={repoUrl}
            label="Copy repository URL"
            onError={(message) =>
              setError(message === null ? null : `Couldn’t copy. The address is ${repoUrl}`)
            }
          />
        </div>
      ) : router !== null ? (
        <div className="mt-3">
          <Button
            size="xs"
            variant="outline"
            disabled={backup?.phase === 'loading'}
            onClick={() => router.navigate(settingsRoute('data'))}
          >
            Set up GitHub sync
          </Button>
        </div>
      ) : null}
      {error !== null ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </SettingsField>
  )
}
