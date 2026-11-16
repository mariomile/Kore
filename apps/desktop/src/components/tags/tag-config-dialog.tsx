import { useState, type ReactElement, type ReactNode } from 'react'
import {
  foldTag,
  propertyKeyForName,
  tagDisplayName,
  tagPropertyTypeSchema,
  type TagPropertyType,
} from '@kore/core'
import { Close, Info, Plus, Settings, Trash } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { isMobileSurface } from '@/lib/platform-surface'
import { TAG_SCHEMA_PRESETS } from '@/lib/tags/schema-presets'
import { PROPERTY_TYPE_ICONS } from './property-type-icons'
import { FIELD_LABEL_CLASS, PROPERTY_TYPE_LABELS, type PropertyDraft } from './tag-config-drafts'
import { TagConfigSheet } from './tag-config-sheet'
import { TagPresetIcon } from './tag-preset-icon'
import { TagParentsField } from './tag-parents-field'
import { TagIconPicker } from './tag-icon-picker'
import { TagPropertySettings } from './tag-property-settings'
import { TagViewsStrip } from './tag-views-strip'
import { NavButton, PropertyNavList } from './tag-config-nav'
import { useTagConfigDraft, type TagConfigDraft } from './use-tag-config-draft'
import { useTypeTagBinding } from './use-type-tag-binding'

interface TagConfigDialogProps {
  /** The tag being configured (display casing). */
  tag: string
  onClose: () => void
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
export function TagConfigDialog(props: TagConfigDialogProps): ReactElement {
  return isMobileSurface() ? <TagConfigSheet {...props} /> : <TagConfigDesktopDialog {...props} />
}

function TagConfigDesktopDialog({ tag: initialTag, onClose }: TagConfigDialogProps): ReactElement {
  // A rebind moves the type onto another tag; the settings reopen there.
  const [tag, setTag] = useState(initialTag)
  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex h-[min(42rem,calc(100dvh-2rem))] w-[min(56rem,94vw)] flex-col gap-0 overflow-hidden p-0"
      >
        <TypeSettings key={foldTag(tag)} tag={tag} onClose={onClose} onRebound={setTag} />
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
}: {
  tag: string
  onClose: () => void
  onRebound: (tag: string) => void
}): ReactElement {
  const config = useTagConfigDraft(tag, onClose)
  const binding = useTypeTagBinding(tag)
  const key = foldTag(tag)
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
            Bind this type to that tag so they show up as its rows. Their folders stay as they are.
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
          aria-label="Type settings"
          className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-3 pb-3"
          aria-busy={config.loading || undefined}
        >
          <NavButton
            active={selection.kind === 'type'}
            onClick={() => setSelection({ kind: 'type' })}
          >
            <Settings aria-hidden className="size-4 shrink-0 text-text-muted" />
            <span className="flex-1 truncate">Type</span>
          </NavButton>
          <p className="px-2 pb-1 pt-4 text-2xs font-medium text-text-muted">Properties</p>
          <PropertyNavList
            config={config}
            selectedRowId={selected?.rowId ?? null}
            onSelect={(rowId) => setSelection({ kind: 'property', rowId })}
          />
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
              converts it into this type's definition (adds the type marker to its frontmatter); its
              body is kept.
            </p>
          ) : null}
          {selected === null ? (
            <TypePane
              tagKey={key}
              config={config}
              onPicked={() => setSelection({ kind: 'type' })}
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

      <SaveBar config={config} onClose={onClose} />
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
}: {
  tagKey: string
  config: TagConfigDraft
  onPicked: () => void
}): ReactElement {
  if (config.loading) {
    return <div aria-busy className="h-40" />
  }
  return (
    <div className="flex flex-col gap-3">
      <PaneHeading>Type</PaneHeading>
      {config.drafts.length === 0 ? (
        <div className="flex flex-col gap-1 rounded-lg bg-surface-hover p-2">
          <p className="px-1 pb-1 text-xs text-text-secondary">
            Start from a ready-made schema. Every property stays editable.
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
      <TagParentsField
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

function PropertyPane({
  draft,
  config,
  onRemove,
}: {
  draft: PropertyDraft
  config: TagConfigDraft
  onRemove: () => void
}): ReactElement {
  const nameInvalid = config.invalidNameRowIds.has(draft.rowId)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 pt-1">
        <Input
          value={draft.name}
          aria-label="Property name"
          aria-invalid={nameInvalid || undefined}
          placeholder="Property name"
          autoFocus={config.focusRowId === draft.rowId}
          className="h-9 flex-1 text-base font-medium"
          onChange={(event) => {
            const name = event.target.value
            config.updateDraft(draft.rowId, {
              name,
              // Follow the name until the key was edited by hand.
              ...(draft.key === propertyKeyForName(draft.name)
                ? { key: propertyKeyForName(name) }
                : {}),
            })
          }}
        />
        <Select
          value={draft.type}
          items={PROPERTY_TYPE_LABELS}
          onValueChange={(value) => {
            const parsed = tagPropertyTypeSchema.safeParse(value)
            if (parsed.success) {
              config.updateDraft(draft.rowId, { type: parsed.data })
            }
          }}
        >
          <SelectTrigger className="h-9 w-44 shrink-0" aria-label="Property type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(PROPERTY_TYPE_LABELS).map(([value, label]) => {
              const Glyph = PROPERTY_TYPE_ICONS[value as TagPropertyType]
              return (
                <SelectItem key={value} value={value}>
                  <Glyph aria-hidden className="size-3.5 text-text-muted" />
                  {label}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-3 pt-1">
        <TagPropertySettings
          draft={draft}
          keyInvalid={config.invalidKeyRowIds.has(draft.rowId)}
          updateDraft={config.updateDraft}
        />
      </div>
      <div className="pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5 text-destructive"
          onClick={onRemove}
        >
          <Trash aria-hidden className="size-3.5" />
          Delete property
        </Button>
      </div>
    </div>
  )
}

function SaveBar({
  config,
  onClose,
}: {
  config: TagConfigDraft
  onClose: () => void
}): ReactElement {
  const { pendingRenames } = config
  if (pendingRenames !== null) {
    return (
      <footer className="flex flex-col gap-2 bg-surface-hover px-5 py-3">
        <p className="text-xs text-text-secondary">
          {pendingRenames
            .map(
              (rename) =>
                `${rename.from} → ${rename.to} (${rename.notes.length} ${
                  rename.notes.length === 1 ? 'note' : 'notes'
                })`,
            )
            .join(' · ')}
          . Move the stored values to the new key, or keep them under the old one?
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={config.cancelPendingRenames}>
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={config.saving}
            onClick={() => {
              void config.performSave([], false)
            }}
          >
            Save without migrating
          </Button>
          <Button
            type="button"
            disabled={config.saving}
            onClick={() => {
              void config.performSave(pendingRenames, true)
            }}
          >
            Save & migrate values
          </Button>
        </div>
      </footer>
    )
  }
  return (
    <footer className="flex items-center justify-end gap-2 px-5 pb-4 pt-3">
      <Button type="button" variant="ghost" onClick={onClose}>
        Cancel
      </Button>
      <Button
        type="button"
        onClick={() => {
          void config.save()
        }}
        disabled={config.loading || config.saving || config.hasInvalidRows}
      >
        {config.needsConversion ? 'Convert & save' : 'Save'}
      </Button>
    </footer>
  )
}
