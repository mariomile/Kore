import type { ReactElement } from 'react'
import { baseDisplayName, resolveAttachmentSource, type BaseEmbed } from '@reflect/core'
import { BaseViewContent } from '@/components/bases/base-view-content'
import { useBaseView } from '@/components/bases/use-base-view'
import { ExternalLink } from '@/components/icons'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'

interface EmbeddedBaseProps {
  embed: BaseEmbed
}

/**
 * Live view of one `![[Name.base#View]]` embed, rendered under the editor
 * like a note transclusion: an Obsidian Home dashboard keeps working when
 * the note is opened in Kore.
 */
export function EmbeddedBase({ embed }: EmbeddedBaseProps): ReactElement {
  const { navigate } = useRouter()
  const navigateNoteLink = useNoteLinkNavigation()
  const path = resolveAttachmentSource(embed.target)
  const state = useBaseView(path, embed.view)
  const commitProperty = useCommitNoteProperty()
  const label = `${baseDisplayName(embed.target)}${embed.view === null ? '' : ` · ${embed.view}`}`

  return (
    <section
      aria-label={`Base ${label}`}
      data-testid="base-embed"
      className="mt-6 overflow-hidden rounded-lg border border-border"
    >
      <header className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <p className="min-w-0 truncate text-sm font-medium text-text">
          {state.status === 'ready'
            ? `${baseDisplayName(embed.target)} · ${state.result.name}`
            : label}
        </p>
        {path !== null ? (
          <button
            type="button"
            aria-label={`Open ${label}`}
            className="flex size-7 items-center justify-center rounded-full text-text-muted transition-colors hover:text-text"
            onClick={() => {
              navigate({ kind: 'base', path, view: embed.view })
            }}
          >
            <ExternalLink aria-hidden className="size-3.5" />
          </button>
        ) : null}
      </header>
      <div className="max-h-[min(28rem,70vh)] min-h-24 overflow-auto px-3 py-3">
        {path === null ? (
          <p className="py-3 text-sm text-text-muted">
            {embed.target} doesn’t match a base in this vault.
          </p>
        ) : state.status === 'loading' ? (
          <p className="py-3 text-sm text-text-muted">Loading base…</p>
        ) : state.status === 'error' ? (
          <p className="py-3 text-sm text-text-muted">Couldn’t open {embed.target}.</p>
        ) : embed.view !== null && state.result.name !== embed.view ? (
          <p className="py-3 text-sm text-text-muted">
            No view “{embed.view}” in {baseDisplayName(embed.target)}.
          </p>
        ) : (
          <BaseViewContent
            compact
            result={state.result}
            onEdit={commitProperty}
            onOpenNote={(target) => {
              navigateNoteLink({ target: routeForPath(target), openInSplit: false })
            }}
          />
        )}
      </div>
    </section>
  )
}
