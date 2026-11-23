import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { foldTag, tagDisplayName } from '@kore/core'
import { Close, Info, Pencil, Plus, Settings } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isMobileSurface } from '@/lib/platform-surface'
import { TAG_SCHEMA_PRESETS } from '@/lib/tags/schema-presets'
import { FIELD_LABEL_CLASS } from './tag-config-drafts'
import { SaveBar } from './tag-config-save-bar'
import { TagConfigSheet } from './tag-config-sheet'
import { TagRenameDialog } from './tag-rename-dialog'
import { TagPresetIcon } from './tag-preset-icon'
import { TagSuggestRow } from './tag-suggest-row'
import { useSuggestTagSchema } from './use-suggest-tag-schema'
import { TagFolderField } from './tag-folder-field'
import { TagAdvancedSection } from './tag-parents-field'
import { TagIconPicker } from './tag-icon-picker'
import { PropertyPane } from './tag-property-pane'
import { RemovedPropertyNotice } from './removed-property-notice'
import { TagViewsStrip } from './tag-views-strip'
import { NavButton, PropertyNavList } from './tag-config-nav'
import { useDiscardGuard, type DiscardGuard } from './use-discard-guard'
import { useTagConfigDraft, type TagConfigDraft } from './use-tag-config-draft'
import { useTypeTagBinding } from './use-type-tag-binding'

interface TagConfigDialogProps {
  /** The tag being configured (display casing). */
  tag: string
  onClose: () => void
  /** The tag was renamed: a screen showing it follows to the new name. */
  onRenamed?: (tag: string) => void
}

/**
 * The per-tag type configuration (TDR 0005): the property list stored in the
 * tag's definition note (`tags/<key>.md`). Creates the definition on first
 * save; an existing unmarked note at that path is only written after the
 * explicit conversion notice below. A broken-YAML definition refuses the
 * write (`upsertFrontmatter`) and surfaces as a toast — never destroys.
 *
 * On the Mac it is two panes, like Notion's and Capacities' type settings:
 * the type itself and its properties as a sortable list on the left, the
 * selection's settings on the right (select options with their order,
 * colors and renames included). When the vault's notes carry the type under
 * another tag (`#type/project` for a `#project` type) a banner offers to
 * move the type there.
 *
 * On the phone every entry point opens the same configuration as a bottom
 * sheet ({@link TagConfigSheet}) instead: a centered dialog this dense does
 * not fit a 390pt screen.
 */
export function TagConfigDialog({
  tag: initialTag,
  onClose,
  onRenamed,
}: TagConfigDialogProps): ReactElement {
  // A rename or a rebind moves the type onto another tag; the settings reopen there.
  const [tag, setTag] = useState(initialTag)
  const [renaming, setRenaming] = useState(false)
  const finishRename = (renamedTo: string | null): void => {
    setRenaming(false)
    if (renamedTo !== null) {
      setTag(renamedTo)
      onRenamed?.(renamedTo)
    }
  }
  const rename = (): void => setRenaming(true)
  const renameDialog = renaming ? <TagRenameDialog tag={tag} onClose={finishRename} /> : null
  if (isMobileSurface()) {
    // One sheet at a time on the phone: the rename takes the settings' place.
    return (
      renameDialog ?? (
        <TagConfigSheet
          key={foldTag(tag)}
          tag={tag}
          onClose={onClose}
          onRename={rename}
          onRebound={setTag}
        />
      )
    )
  }
  return (
    <>
      <TagConfigDesktopDialog tag={tag} onClose={onClose} onRename={rename} onRebound={setTag} />
      {renameDialog}
    </>
  )
}

interface TagConfigSurfaceProps extends TagConfigDialogProps {
  /** Open the rename for the tag being configured. */
  onRename: () => void
  /** A rebind moved the type onto another tag. */
  onRebound: (tag: string) => void
}

function TagConfigDesktopDialog({
  tag,
  onClose,
  onRename,
  onRebound,
}: TagConfigSurfaceProps): ReactElement {
  // Escape, the backdrop and the close button all ask the settings first:
  // with unsaved edits they confirm instead of closing.
  const requestCloseRef = useRef<() => void>(onClose)
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) requestCloseRef.current()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(42rem,calc(100dvh-2rem))] w-[min(56rem,94vw)] flex-col gap-0 overflow-hidden p-0"
      >
        <TypeSettings
          key={foldTag(tag)}
          tag={tag}
          onClose={onClose}
          onRebound={onRebound}
          onRename={onRename}
          requestCloseRef={requestCloseRef}
        />
      </DialogContent>
    </Dialog>
  )
}

/** What the right pane shows: the type's own settings or one property. */
type Selection = { kind: 'type' } | { kind: 'property'; rowId: number }

function TypeSettings({
  tag,
  onClose,
  onRebound,
  onRename,
  requestCloseRef,
}: {
  tag: string
  onClose: () => void
  onRebound: (tag: string) => void
  onRename: () => void
  /** Receives the guarded close, for the dialog's own dismiss gestures. */
  requestCloseRef: RefObject<() => void>
}): ReactElement {
  const config = useTagConfigDraft(tag, onClose)
  const binding = useTypeTagBinding(tag)
  const key = foldTag(tag)
  const { discarding, requestClose, closeThen, keepEditing, discard } = useDiscardGuard(
    config.dirty,
    onClose,
  )
  useEffect(() => {
    requestCloseRef.current = requestClose
  })
  const [selection, setSelection] = useState<Selection>({ kind: 'type' })
  const selected =
    selection.kind === 'property'
      ? (config.drafts.find((draft) => draft.rowId === selection.rowId) ?? null)
      : null
  const name = tagDisplayName(key.slice(key.lastIndexOf('/') + 1))

  return (
    <>
      <header className="flex items-center gap-3 px-5 pb-3 pt-4">
        <TagIconPicker value={config.icon} onChange={config.setIcon} />
        <div className="flex min-w-0 flex-1 flex-col">
          <DialogTitle className="truncate text-base font-semibold text-text">{name}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5 truncate text-xs text-text-muted">
            <span className="font-mono">#{key}</span>
            <span aria-hidden>·</span>
            <span>
              {binding.count === null
                ? 'Counting notes…'
                : `${binding.count} ${binding.count === 1 ? 'note' : 'notes'}`}
            </span>
          </DialogDescription>
        </div>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={onRename}>
          <Pencil aria-hidden className="size-4" />
          Rename
        </Button>
        <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label="Close" />}>
          <Close aria-hidden />
        </DialogClose>
      </header>

      {binding.suggestion !== null && !config.loading ? (
        <div className="mx-5 mb-3 flex items-center gap-3 rounded-lg bg-accent-soft px-3 py-2">
          <Info aria-hidden className="size-4 shrink-0 text-accent-soft-text" />
          <p className="min-w-0 flex-1 text-xs text-accent-soft-text">
            <span className="font-medium">
              {binding.suggestion.count} notes use #{binding.suggestion.tag}.
            </span>{' '}
            Bind this tag to that tag so they show up as its rows. Their folders stay as they are.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={config.saving || config.hasInvalidRows}
            onClick={() => {
              const next = binding.suggestion?.tag
              if (next === undefined) {
                return
              }
              void config.rebindTo(next).then((moved) => {
                if (moved) onRebound(next)
              })
            }}
          >
            Use #{binding.suggestion.tag}
          </Button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[15rem_1fr]">
        <nav
          aria-label="Tag settings"
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-3 pb-3"
          aria-busy={config.loading || undefined}
        >
          <NavButton
            active={selection.kind === 'type'}
            onClick={() => setSelection({ kind: 'type' })}
          >
            <Settings aria-hidden className="size-4 shrink-0 text-text-muted" />
            <span className="flex-1 truncate">Tag</span>
          </NavButton>
          <p className="px-2 pb-1 pt-4 text-2xs font-medium text-text-muted">Properties</p>
          <PropertyNavList
            config={config}
            selectedRowId={selected?.rowId ?? null}
            onSelect={(rowId) => setSelection({ kind: 'property', rowId })}
          />
          {config.removedDraft === null ? null : (
            <RemovedPropertyNotice
              name={config.removedDraft.name.trim()}
              className="h-8 pl-2 pr-1 text-xs"
              onUndo={() => {
                const rowId = config.restoreRemovedDraft()
                if (rowId !== null) setSelection({ kind: 'property', rowId })
              }}
            />
          )}
          <NavButton
            muted
            disabled={config.loading}
            onClick={() => setSelection({ kind: 'property', rowId: config.addDraft() })}
          >
            <Plus aria-hidden className="size-4 shrink-0" />
            <span className="flex-1 truncate">Add property</span>
          </NavButton>
        </nav>

        <section className="min-h-0 overflow-y-auto px-6 pb-6 pt-1">
          {config.needsConversion ? (
            <p className="mb-4 rounded-lg bg-surface-hover px-3 py-2 text-xs text-text-secondary">
              A note already exists at <code className="font-mono">tags/{key}.md</code>. Saving
              converts it into this tag's definition (adds the tag marker to its frontmatter); its
              body is kept.
            </p>
          ) : null}
          {selected === null ? (
            <TypePane
              tagKey={key}
              config={config}
              onPicked={() => setSelection({ kind: 'type' })}
              closeThen={closeThen}
            />
          ) : (
            <PropertyPane
              key={selected.rowId}
              draft={selected}
              config={config}
              onRemove={() => {
                config.removeDraft(selected.rowId)
                setSelection({ kind: 'type' })
              }}
            />
          )}
        </section>
      </div>

      <SaveBar
        config={config}
        onClose={requestClose}
        discarding={discarding}
        onKeepEditing={keepEditing}
        onDiscard={discard}
      />
    </>
  )
}

/** A labelled row of the right pane: label column, then the control. */
function PaneRow({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex items-start gap-2">
      <span className={FIELD_LABEL_CLASS}>{label}</span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  )
}

function PaneHeading({ children }: { children: ReactNode }): ReactElement {
  return <h3 className="pb-3 pt-3 text-sm font-semibold text-text">{children}</h3>
}

function TypePane({
  tagKey,
  config,
  onPicked,
  closeThen,
}: {
  tagKey: string
  config: TagConfigDraft
  onPicked: () => void
  closeThen: DiscardGuard['closeThen']
}): ReactElement {
  const suggestWithAi = useSuggestTagSchema(tagKey, closeThen)
  if (config.loading) {
    return <div aria-busy className="h-40" />
  }
  return (
    <div className="flex flex-col gap-3">
      <PaneHeading>Tag</PaneHeading>
      {config.drafts.length === 0 ? (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-hover p-2">
          {suggestWithAi === null ? null : (
            <TagSuggestRow variant="dialog" onSuggest={suggestWithAi} />
          )}
          <p className="px-1 pb-1 pt-1 text-xs text-text-secondary">
            {suggestWithAi === null ? 'Start' : 'Or start'} from a ready-made schema. Every property
            stays editable.
          </p>
          {TAG_SCHEMA_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => {
                config.seedPreset(preset)
                onPicked()
              }}
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-active"
            >
              <TagPresetIcon presetId={preset.id} className="size-4 shrink-0 text-text-muted" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium text-text">{preset.name}</span>
                <span className="truncate text-xs text-text-muted">{preset.summary}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <TagViewsStrip properties={config.liveSchema} />
      <PaneRow label="Template">
        <Select
          value={config.template ?? 'none'}
          items={{
            none: 'None',
            ...Object.fromEntries(config.templates.map((entry) => [entry.path, entry.title])),
          }}
          onValueChange={(value) => config.setTemplate(value === 'none' ? null : value)}
        >
          <SelectTrigger aria-label="New-row template" className="min-w-44">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {config.templates.map((entry) => (
              <SelectItem key={entry.path} value={entry.path}>
                {entry.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PaneRow>
      <TagFolderField
        folder={config.folder}
        folders={config.folders}
        onChange={config.setFolder}
        labelClassName={FIELD_LABEL_CLASS}
      />
      <TagAdvancedSection
        tag={tagKey}
        parents={config.parents}
        candidates={config.parentCandidates}
        onChange={config.setParents}
      />
      <p className="pt-2 text-xs text-text-muted">
        Stored in <code className="font-mono">tags/{tagKey}.md</code>, a note that syncs with the
        vault, so agents read the same schema.
      </p>
    </div>
  )
}
