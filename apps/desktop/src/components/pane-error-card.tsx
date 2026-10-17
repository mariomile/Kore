import { use, useState, type ReactElement } from 'react'
import { revealAsset } from '@reflect/core'
import { AlertTriangle, Check, Copy, Locate, Refresh } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { isNativeShell } from '@/lib/platform'
import { GraphContext } from '@/providers/graph-context'

interface PaneErrorCardProps {
  error: Error
  /** Graph-relative file behind the pane, when it shows one. */
  path: string | null
  onReload: () => void
}

/**
 * What a pane shows after {@link PaneErrorBoundary} catches its crash: a calm
 * card that names the problem and offers the ways out — retry the render, or
 * get at the file itself (reveal it, copy its path) so the note stays
 * reachable in another editor while the bug is fixed.
 */
export function PaneErrorCard({ error, path, onReload }: PaneErrorCardProps): ReactElement {
  // Read the context directly: the card must render even where no graph
  // provider is mounted, since it is the last thing standing in that pane.
  const graph = use(GraphContext)?.graph ?? null
  const [copied, setCopied] = useState(false)

  const copyPath = async (): Promise<void> => {
    if (path === null) {
      return
    }
    try {
      await navigator.clipboard.writeText(path)
      setCopied(true)
    } catch (cause) {
      console.warn('copy note path failed:', cause)
    }
  }

  return (
    <div className="flex h-full items-center justify-center p-8">
      <div
        role="alert"
        className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-background p-5"
      >
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle aria-hidden className="size-4 shrink-0 text-text-muted" />
          {path === null ? 'This view couldn’t be shown' : 'This note couldn’t be shown'}
        </div>
        {path === null ? null : (
          <p className="truncate font-mono text-xs text-text-muted" title={path}>
            {path}
          </p>
        )}
        <p className="text-xs break-words text-text-muted">{error.message}</p>
        <p className="text-xs text-text-muted">
          The rest of Kore keeps working. The file on disk is untouched.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" onClick={onReload}>
            <Refresh aria-hidden />
            Reload pane
          </Button>
          {path !== null && graph !== null && isNativeShell() ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                revealAsset(path, graph.generation).catch((cause: unknown) => {
                  console.warn('reveal note failed:', cause)
                })
              }}
            >
              <Locate aria-hidden />
              Reveal in Finder
            </Button>
          ) : null}
          {path === null ? null : (
            <Button size="sm" variant="outline" onClick={() => void copyPath()}>
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              {copied ? 'Copied' : 'Copy path'}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
