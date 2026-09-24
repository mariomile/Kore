import { Fragment, useState, type MouseEvent, type ReactElement, type ReactNode } from 'react'
import {
  CalendarDays,
  Globe,
  Hash,
  History,
  Layers,
  LayoutGrid,
  Note,
  Paperclip,
  Pencil,
  Search,
} from '@/components/icons'
import { openExternalUrl } from '@/editor/open-external-link'
import {
  isTagName,
  isToolPending,
  formatPropertyPreview,
  type AssistantPart,
  type ChatTurn,
  type NoteHitSummary,
  type NoteToolCall,
  type NoteToolResult,
} from '@reflect/core'
import { Button } from '@/components/ui/button'
import { useCommitNoteProperty } from '@/lib/tags/use-commit-note-property'
import { Marker, MarkerContent, MarkerIcon } from '@/components/ui/marker'
import { Spinner } from '@/components/ui/spinner'
import { useNoteLinkNavigation } from '@/hooks/use-note-link-navigation'
import { routeForPath } from '@/routing/route'
import { useRouter } from '@/routing/router'
import { isModEvent } from '@meowdown/core'
import { ChatNotePatchCard } from './chat-note-patch-card'
import { ChatNoteTypeCard } from './chat-note-type-card'
import { ChatTagIconCard } from './chat-tag-icon-card'
import { ChatTagSchemaCard } from './chat-tag-schema-card'

interface ChatToolChipProps {
  part: Extract<AssistantPart, { kind: 'tool' }>
  /** The owning turn's status; a proposed edit takes decisions only once it is done. */
  turnStatus?: ChatTurn['status']
}

/** ` · 3 notes` — the settled count suffix of a listing chip. */
function countSuffix(count: number, noun: string): string {
  return ` · ${count} ${noun}${count === 1 ? '' : 's'}`
}

/** An asset chip labels entries by filename — the path adds only noise. */
function assetName(path: string): string {
  return path.split('/').pop() ?? path
}

/** A browse chip labels the page by host — the full URL adds only noise. */
function pageHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** The clickable page label of a browse chip: reopens it in the built-in browser. */
function PageLink({ url, label }: { url: string; label: string }): ReactElement {
  return (
    <button
      type="button"
      onClick={() => {
        openExternalUrl(url)
      }}
      className="underline-offset-2 hover:text-text hover:underline"
    >
      {label}
    </button>
  )
}

interface ChipFrameProps {
  pending: boolean
  icon: ReactElement
  children: ReactNode
  /** When true, the label can wrap so an Apply button isn't clipped. */
  wrap?: boolean | undefined
}

/** The shared marker shell: a spinner while pending, the tool's icon after. */
function ChipFrame({ pending, icon, children, wrap = false }: ChipFrameProps): ReactElement {
  return (
    <Marker className="text-xs text-text-muted">
      <MarkerIcon>{pending ? <Spinner /> : icon}</MarkerIcon>
      <MarkerContent className={wrap ? 'flex flex-wrap items-center gap-1' : 'truncate'}>
        {children}
      </MarkerContent>
    </Marker>
  )
}

/** A `#tag` mention that routes to the tag's All Notes view when the text
 * is a real tag (a junk filter stays plain text). */
function TagRouteButton({ tag }: { tag: string }): ReactElement {
  const { navigate } = useRouter()
  if (!isTagName(tag)) {
    return <>#{tag}</>
  }
  return (
    <button
      type="button"
      onClick={() => navigate({ kind: 'allNotes', filter: { kind: 'tag', tag } })}
      className="underline-offset-2 hover:text-text hover:underline"
    >
      #{tag}
    </button>
  )
}

interface NoteLinksProps {
  notes: readonly NoteHitSummary[]
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void
}

function NoteLinks({ notes, onOpen }: NoteLinksProps): ReactElement | null {
  if (notes.length === 0) {
    return null
  }

  return (
    <>
      {': '}
      {notes.map((note, index) => (
        <Fragment key={`${note.path}-${index}`}>
          {index > 0 ? ', ' : ''}
          <button
            type="button"
            onClick={(event) => onOpen(note.path, event)}
            className="underline-offset-2 hover:text-text hover:underline"
          >
            {note.title}
          </button>
        </Fragment>
      ))}
    </>
  )
}

/**
 * The transparent-context chip for one tool call: what the assistant searched
 * for or listed (and how many notes came back), or which note it read.
 * Successful read chips click through to the note; a refused or failed read
 * shows the failure instead of pretending the note was used. This is the only
 * UI that knows tool names — new tools extend `tools.ts` and this switch.
 */

interface SetPropertyChipProps {
  call: Extract<NoteToolCall, { tool: 'setProperty' }>
  result: Extract<NoteToolResult, { tool: 'setProperty' }> | null
  error: string | null | undefined
  pending: boolean
  onOpen: (path: string, event: MouseEvent<HTMLButtonElement>) => void
}

function SetPropertyChip({
  call,
  result,
  error,
  pending,
  onOpen,
}: SetPropertyChipProps): ReactElement {
  const commitProperty = useCommitNoteProperty()
  const [applied, setApplied] = useState(false)
  const failed = error ?? null
  // Legacy persisted chips omit `value` (the tool used to write immediately).
  // `null` is a real proposal (clear); `undefined` is "no preview to apply".
  const proposed = result?.value
  const hasProposal = result !== null && proposed !== undefined
  const canApply = !pending && failed === null && hasProposal && !applied

  function apply(): void {
    commitProperty(call.path, call.key, proposed === null ? undefined : proposed)
    setApplied(true)
  }

  return (
    <ChipFrame pending={pending} icon={<Pencil aria-hidden className="size-3.5" />} wrap>
      {applied ? 'Applied' : 'Proposed'} {call.key}
      {proposed !== undefined && failed === null
        ? ` → ${formatPropertyPreview(proposed)}`
        : ''} on{' '}
      {failed === null ? (
        <button
          type="button"
          onClick={(event) => onOpen(call.path, event)}
          className="underline-offset-2 hover:text-text hover:underline"
        >
          {call.path}
        </button>
      ) : (
        <span>
          {call.path} — {failed}
        </span>
      )}
      {canApply ? (
        <>
          {' '}
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={(event) => {
              event.stopPropagation()
              apply()
            }}
          >
            Apply
          </Button>
        </>
      ) : null}
    </ChipFrame>
  )
}

export function ChatToolChip({ part, turnStatus = 'done' }: ChatToolChipProps): ReactElement {
  const navigateNoteLink = useNoteLinkNavigation()
  const openNote = (path: string, event: MouseEvent<HTMLButtonElement>): void => {
    navigateNoteLink({ target: routeForPath(path), openInSplit: isModEvent(event) })
  }
  const pending = isToolPending(part)
  const call = part.call

  if (call.tool === 'search') {
    const result = part.result?.tool === 'search' ? part.result : null
    return (
      <ChipFrame pending={pending} icon={<Search aria-hidden className="size-3.5" />}>
        Searched “{call.query}”{result !== null ? countSuffix(result.hits.length, 'note') : ''}
        {result !== null ? <NoteLinks notes={result.hits} onOpen={openNote} /> : null}
      </ChipFrame>
    )
  }

  if (call.tool === 'recents') {
    const result = part.result?.tool === 'recents' ? part.result : null
    const tagLabel = call.tag !== null ? <TagRouteButton tag={call.tag} /> : 'recent'
    return (
      <ChipFrame pending={pending} icon={<History aria-hidden className="size-3.5" />}>
        Listed {tagLabel} notes
        {result !== null
          ? result.error !== null
            ? ` — ${result.error}`
            : countSuffix(result.notes.length, 'note')
          : ''}
        {result !== null && result.error === null ? (
          <NoteLinks notes={result.notes} onOpen={openNote} />
        ) : null}
      </ChipFrame>
    )
  }

  if (call.tool === 'collection') {
    const result = part.result?.tool === 'collection' ? part.result : null
    return (
      <ChipFrame pending={pending} icon={<Layers aria-hidden className="size-3.5" />}>
        Listed the <TagRouteButton tag={call.tag} /> collection
        {result !== null
          ? result.error !== null
            ? ` — ${result.error}`
            : countSuffix(result.notes.length, 'note')
          : ''}
        {result !== null && result.error === null ? (
          <NoteLinks notes={result.notes} onOpen={openNote} />
        ) : null}
      </ChipFrame>
    )
  }

  if (call.tool === 'setProperty') {
    const result = part.result?.tool === 'setProperty' ? part.result : null
    return (
      <SetPropertyChip
        call={call}
        result={result}
        error={result?.error ?? part.error}
        pending={pending}
        onOpen={openNote}
      />
    )
  }

  // edit_note: a settled proposal is the review card; a pending call or a
  // refusal stays a compact chip, since there is nothing to accept.
  if (call.tool === 'editNote') {
    const result = part.result?.tool === 'editNote' ? part.result : null
    const failed = result?.error ?? part.error ?? null
    if (result !== null && failed === null) {
      return <ChatNotePatchCard result={result} turnStatus={turnStatus} onOpen={openNote} />
    }
    return (
      <ChipFrame pending={pending} icon={<Pencil aria-hidden className="size-3.5" />} wrap>
        {failed === null ? 'Proposing an edit to' : 'Couldn’t propose an edit to'}{' '}
        <button
          type="button"
          onClick={(event) => openNote(call.path, event)}
          className="underline-offset-2 hover:text-text hover:underline"
        >
          {call.path}
        </button>
        {failed !== null ? <span> — {failed}</span> : null}
      </ChipFrame>
    )
  }

  if (call.tool === 'tags') {
    const result = part.result?.tool === 'tags' ? part.result : null
    return (
      <ChipFrame pending={pending} icon={<Hash aria-hidden className="size-3.5" />}>
        Listed the types{result !== null ? countSuffix(result.count, 'type') : ''}
        {part.error !== null ? ` — ${part.error}` : ''}
      </ChipFrame>
    )
  }

  if (call.tool === 'tagIcons') {
    const result = part.result?.tool === 'tagIcons' ? part.result : null
    return (
      <ChipFrame pending={pending} icon={<LayoutGrid aria-hidden className="size-3.5" />}>
        Looked up the app’s icons{result !== null ? countSuffix(result.count, 'icon') : ''}
        {part.error !== null ? ` — ${part.error}` : ''}
      </ChipFrame>
    )
  }

  // set_tag_icon: a settled proposal is the review card; a pending call or a
  // refusal stays a compact chip, since there is nothing to accept.
  if (call.tool === 'setTagIcon') {
    const result = part.result?.tool === 'setTagIcon' ? part.result : null
    const failed = result?.error ?? part.error ?? null
    if (result !== null && failed === null) {
      return <ChatTagIconCard result={result} turnStatus={turnStatus} />
    }
    return (
      <ChipFrame pending={pending} icon={<Hash aria-hidden className="size-3.5" />} wrap>
        {failed === null ? 'Proposing an icon for' : 'Couldn’t propose an icon for'}{' '}
        <TagRouteButton tag={call.tag} />
        {failed !== null ? <span> — {failed}</span> : null}
      </ChipFrame>
    )
  }

  // set_tag_schema: a settled proposal is the review card; a pending call or
  // a refusal stays a compact chip, since there is nothing to accept.
  if (call.tool === 'setTagSchema') {
    const result = part.result?.tool === 'setTagSchema' ? part.result : null
    const failed = result?.error ?? part.error ?? null
    if (result !== null && failed === null) {
      return <ChatTagSchemaCard result={result} turnStatus={turnStatus} />
    }
    return (
      <ChipFrame pending={pending} icon={<Hash aria-hidden className="size-3.5" />} wrap>
        {failed === null ? 'Proposing properties for' : 'Couldn’t propose properties for'}{' '}
        <TagRouteButton tag={call.tag} />
        {failed !== null ? <span> — {failed}</span> : null}
      </ChipFrame>
    )
  }

  // set_note_type: a settled proposal is the review card; a pending call or
  // a refusal stays a compact chip, since there is nothing to accept.
  if (call.tool === 'setNoteType') {
    const result = part.result?.tool === 'setNoteType' ? part.result : null
    const failed = result?.error ?? part.error ?? null
    if (result !== null && failed === null) {
      return <ChatNoteTypeCard result={result} turnStatus={turnStatus} onOpen={openNote} />
    }
    return (
      <ChipFrame pending={pending} icon={<Hash aria-hidden className="size-3.5" />} wrap>
        {failed === null ? 'Proposing' : 'Couldn’t propose'} <TagRouteButton tag={call.tag} /> on{' '}
        <button
          type="button"
          onClick={(event) => openNote(call.path, event)}
          className="underline-offset-2 hover:text-text hover:underline"
        >
          {call.path}
        </button>
        {failed !== null ? <span> — {failed}</span> : null}
      </ChipFrame>
    )
  }

  if (call.tool === 'browse') {
    const result = part.result?.tool === 'browse' ? part.result : null
    const failed = result?.error ?? part.error ?? null
    const url = result?.url ?? call.url
    const label = result?.title ?? pageHost(url)
    return (
      <ChipFrame pending={pending} icon={<Globe aria-hidden className="size-3.5" />}>
        Browsed <PageLink url={url} label={label} />
        {failed !== null ? ` — ${failed}` : ''}
      </ChipFrame>
    )
  }

  if (call.tool === 'readPage') {
    const result = part.result?.tool === 'readPage' ? part.result : null
    const failed = result?.error ?? part.error ?? null
    return (
      <ChipFrame pending={pending} icon={<Globe aria-hidden className="size-3.5" />}>
        Read the open page
        {result?.url != null ? (
          <>
            {': '}
            <PageLink url={result.url} label={result.title ?? pageHost(result.url)} />
          </>
        ) : null}
        {failed !== null ? ` — ${failed}` : ''}
      </ChipFrame>
    )
  }

  if (call.tool === 'dailies') {
    const result = part.result?.tool === 'dailies' ? part.result : null
    return (
      <ChipFrame pending={pending} icon={<CalendarDays aria-hidden className="size-3.5" />}>
        Listed daily notes {call.start} – {call.end}
        {result !== null ? countSuffix(result.days.length, 'day') : ''}
        {result !== null ? <NoteLinks notes={result.days} onOpen={openNote} /> : null}
      </ChipFrame>
    )
  }

  // read_assets: one chip for the whole batch of attachment descriptions.
  // Assets have no note route, so entries stay plain text with per-asset
  // refusals inline.
  if (call.tool === 'assets') {
    const result = part.result?.tool === 'assets' ? part.result : null
    if (part.error !== null) {
      return (
        <ChipFrame pending={false} icon={<Paperclip aria-hidden className="size-3.5" />}>
          {call.paths.map(assetName).join(', ')} — {part.error}
        </ChipFrame>
      )
    }
    const assets = result?.assets ?? call.paths.map((path) => ({ path, error: null }))
    return (
      <ChipFrame pending={pending} icon={<Paperclip aria-hidden className="size-3.5" />}>
        Read{' '}
        {assets.map((asset, index) => (
          <Fragment key={`${asset.path}-${index}`}>
            {index > 0 ? ', ' : ''}
            <span>
              {assetName(asset.path)}
              {asset.error !== null ? ` — ${asset.error}` : ''}
            </span>
          </Fragment>
        ))}
      </ChipFrame>
    )
  }

  // read_notes: one chip for the whole batch. A tool-level error fails it as a
  // unit; otherwise each note links through on its own, or shows its refusal.
  const result = part.result?.tool === 'read' ? part.result : null
  if (part.error !== null) {
    return (
      <ChipFrame pending={false} icon={<Note aria-hidden className="size-3.5" />}>
        {call.paths.join(', ')} — {part.error}
      </ChipFrame>
    )
  }
  // Settled, we know each note's title/error; pending, only the requested paths.
  const notes = result?.notes ?? call.paths.map((path) => ({ path, title: null, error: null }))
  return (
    <ChipFrame pending={pending} icon={<Note aria-hidden className="size-3.5" />}>
      Read{' '}
      {notes.map((note, index) => {
        const label = note.title ?? note.path
        return (
          <Fragment key={`${note.path}-${index}`}>
            {index > 0 ? ', ' : ''}
            {!pending && note.error === null ? (
              <button
                type="button"
                onClick={(event) => openNote(note.path, event)}
                className="underline-offset-2 hover:text-text hover:underline"
              >
                {label}
              </button>
            ) : (
              <span>
                {label}
                {note.error !== null ? ` — ${note.error}` : ''}
              </span>
            )}
          </Fragment>
        )
      })}
    </ChipFrame>
  )
}
