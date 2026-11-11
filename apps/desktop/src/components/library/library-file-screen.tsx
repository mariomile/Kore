import type { ReactElement } from 'react'
import { libraryFileTitle, splitFrontmatter } from '@kore/core'
import { Lock } from '@/components/icons'
import { MarkdownPreview } from '@/editor/markdown-preview'
import { useLibraryFile, useLibraryRoots } from '@/hooks/use-library'
import { ScrollRestored } from '@/routing/scroll-restore'

interface LibraryFileScreenProps {
  root: string
  path: string
}

/**
 * One Library file (a coding agent's skill, agent definition or memory file
 * from `~/.claude` and friends), rendered read-only. Kore never writes these
 * folders: their own tools own them. The frontmatter stays visible, since for
 * a skill or an agent it is the part that decides when it runs.
 */
export function LibraryFileScreen({ root, path }: LibraryFileScreenProps): ReactElement {
  const roots = useLibraryRoots()
  const file = useLibraryFile(root, path)
  const folder = roots.find((entry) => entry.id === root)
  const location = folder === undefined ? path : `${folder.path}/${path}`
  const split = file.data === undefined ? null : splitFrontmatter(file.data)

  return (
    <ScrollRestored className="h-full overflow-auto">
      <article className="kore-content-gutter mx-auto flex w-full flex-col pt-14 pb-8">
        <header className="mb-6 flex flex-col gap-1">
          <h1 className="text-2xl font-semibold text-text">{libraryFileTitle(path)}</h1>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
            <Lock aria-hidden className="size-3 flex-none" />
            <span className="flex-none">Read-only</span>
            <span aria-hidden>·</span>
            <span className="min-w-0 truncate" title={location}>
              {location}
            </span>
          </p>
        </header>
        {file.isError ? (
          <p className="text-sm text-danger">This file couldn’t be read.</p>
        ) : split === null ? null : (
          <>
            {split.raw === null ? null : (
              <pre className="mb-6 overflow-x-auto rounded-md bg-surface-hover px-3 py-2 text-xs leading-relaxed text-text-secondary">
                {split.raw.trim()}
              </pre>
            )}
            <MarkdownPreview content={split.body} />
          </>
        )}
      </article>
    </ScrollRestored>
  )
}
