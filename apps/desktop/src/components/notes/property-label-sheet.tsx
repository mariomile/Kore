import { useState, type FormEvent, type ReactElement } from 'react'
import { QUICK_PROPERTY_TYPES, type TagProperty, type TagPropertyType } from '@kore/core'
import { Check, ChevronLeft, Pencil, Settings, Trash } from '@/components/icons'
import { PROPERTY_TYPE_ICONS } from '@/components/tags/property-type-icons'
import { PROPERTY_TYPE_LABELS } from '@/components/tags/tag-config-drafts'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { haptic } from '@/lib/haptics'
import { SettingsActionRow, SettingsGroup, SettingsNavRow } from '@/mobile/settings-list'

interface PropertyLabelSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  property: TagProperty
  ownerTag: string | null
  onRename: (nextName: string) => Promise<boolean>
  onChangeType: (nextType: TagPropertyType) => Promise<boolean>
  onEditSchema: () => void
  onDelete: () => Promise<boolean>
}

type SheetPage = 'root' | 'rename' | 'type'

/**
 * Notion-style animated bottom sheet when tapping a property label on iPhone:
 * Rename, Change type, Edit schema fields, or Delete property.
 */
export function PropertyLabelSheet({
  open,
  onOpenChange,
  property,
  ownerTag,
  onRename,
  onChangeType,
  onEditSchema,
  onDelete,
}: PropertyLabelSheetProps): ReactElement {
  const [page, setPage] = useState<SheetPage>('root')
  const [draftName, setDraftName] = useState(property.name)
  const typeLabel = PROPERTY_TYPE_LABELS[property.type]
  const choices = QUICK_PROPERTY_TYPES.includes(property.type)
    ? QUICK_PROPERTY_TYPES
    : [property.type, ...QUICK_PROPERTY_TYPES]

  const close = (): void => {
    onOpenChange(false)
    setPage('root')
  }
  const go = (next: SheetPage): void => {
    if (next === 'rename') {
      setDraftName(property.name)
    }
    setPage(next)
  }

  const submitRename = (event: FormEvent): void => {
    event.preventDefault()
    const trimmed = draftName.trim()
    if (trimmed === '') {
      return
    }
    void onRename(trimmed).then((ok) => {
      if (ok) {
        close()
      }
    })
  }

  const title =
    page === 'root' ? property.name : page === 'rename' ? 'Rename property' : 'Property type'

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setPage('root')
        }
      }}
    >
      <DrawerContent aria-label={property.name}>
        <div className="relative flex h-14 shrink-0 items-end justify-center px-16 pb-1">
          {page === 'root' ? null : (
            <button
              type="button"
              aria-label="Back"
              onClick={() => go('root')}
              className="absolute bottom-0 left-2 flex size-11 items-center justify-center rounded-full text-primary active:opacity-60"
            >
              <ChevronLeft aria-hidden className="size-5" />
            </button>
          )}
          <DrawerTitle className="truncate px-0 pt-0 pb-2.5 text-center text-[17px] font-semibold">
            {title}
          </DrawerTitle>
          <button
            type="button"
            onClick={close}
            className="absolute right-2 bottom-0 flex h-11 items-center rounded-full px-3 text-[15px] font-medium text-accent active:opacity-60"
          >
            Done
          </button>
        </div>

        <div className="flex max-h-[65dvh] min-h-[12rem] flex-col gap-5 overflow-y-auto px-4 pt-3 pb-8">
          {ownerTag === null ? (
            <SettingsGroup footer="This field isn’t part of a tag schema, so its type is inferred from its value.">
              <div className="flex min-h-12 items-center justify-between px-3.5 text-[15px]">
                <span className="text-text-secondary">Type</span>
                <span className="font-medium text-text">{typeLabel}</span>
              </div>
            </SettingsGroup>
          ) : page === 'root' ? (
            <>
              <SettingsGroup>
                <button
                  type="button"
                  onClick={() => go('rename')}
                  className="flex min-h-12 w-full items-center gap-3 px-3.5 text-left text-[16px] text-text active:bg-surface-hover"
                >
                  <Pencil aria-hidden className="size-[18px] shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">Rename</span>
                </button>
                <SettingsNavRow
                  label="Property type"
                  value={typeLabel}
                  onPress={() => go('type')}
                />
              </SettingsGroup>

              <SettingsGroup footer={`Changes apply to every #${ownerTag} note.`}>
                <button
                  type="button"
                  onClick={() => {
                    close()
                    onEditSchema()
                  }}
                  className="flex min-h-12 w-full items-center gap-3 px-3.5 text-left text-[16px] text-text active:bg-surface-hover"
                >
                  <Settings aria-hidden className="size-[18px] shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1 truncate">Edit #{ownerTag} fields…</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    haptic('warning')
                    void onDelete().then((ok) => {
                      if (ok) {
                        close()
                      }
                    })
                  }}
                  className="flex min-h-12 w-full items-center gap-3 px-3.5 text-left text-[16px] text-destructive active:bg-surface-hover"
                >
                  <Trash aria-hidden className="size-[18px] shrink-0" />
                  <span className="min-w-0 flex-1 truncate">Delete property</span>
                </button>
              </SettingsGroup>
            </>
          ) : page === 'rename' ? (
            <SettingsGroup header="Property name">
              <form onSubmit={submitRename} className="flex items-center gap-2 px-3 py-2">
                <input
                  autoFocus
                  type="text"
                  aria-label="Property name"
                  enterKeyHint="done"
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-text-muted"
                />
                <button
                  type="submit"
                  disabled={draftName.trim() === '' || draftName.trim() === property.name}
                  className="flex h-8 shrink-0 items-center rounded-full bg-accent-soft px-3 text-[13px] font-medium text-accent-soft-text disabled:opacity-40"
                >
                  Save
                </button>
              </form>
            </SettingsGroup>
          ) : (
            <SettingsGroup header={`Type, for every #${ownerTag} note`}>
              {choices.map((type) => {
                const Glyph = PROPERTY_TYPE_ICONS[type]
                const selected = type === property.type
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      haptic('selection')
                      void onChangeType(type).then((ok) => {
                        if (ok) {
                          close()
                        }
                      })
                    }}
                    className="flex min-h-12 w-full items-center gap-3 px-3.5 text-left text-[16px] text-text active:bg-surface-hover"
                  >
                    <Glyph aria-hidden className="size-[18px] shrink-0 text-text-muted" />
                    <span className={cn('min-w-0 flex-1 truncate', selected && 'font-medium')}>
                      {PROPERTY_TYPE_LABELS[type]}
                    </span>
                    <Check
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 text-accent',
                        selected ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </button>
                )
              })}
            </SettingsGroup>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

interface MobileAddPropertySheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag: string
  onAdd: (name: string, type: TagPropertyType) => Promise<void>
  onEditSchema: () => void
}

/** Animated bottom drawer to add a property to a note's owning tag on iPhone. */
export function MobileAddPropertySheet({
  open,
  onOpenChange,
  tag,
  onAdd,
  onEditSchema,
}: MobileAddPropertySheetProps): ReactElement {
  const [name, setName] = useState('')
  const [type, setType] = useState<TagPropertyType>('text')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const reset = (): void => {
    setName('')
    setType('text')
    setError(null)
    setSaving(false)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (name.trim() === '' || saving) {
      return
    }
    setSaving(true)
    try {
      await onAdd(name, type)
      haptic('success')
      onOpenChange(false)
      reset()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setSaving(false)
    }
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          reset()
        }
      }}
    >
      <DrawerContent aria-label="Add a property">
        <div className="relative flex h-14 shrink-0 items-end justify-center px-16 pb-1">
          <DrawerTitle className="truncate px-0 pt-0 pb-2.5 text-center text-[17px] font-semibold">
            Add a property
          </DrawerTitle>
          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              reset()
            }}
            className="absolute right-2 bottom-0 flex h-11 items-center rounded-full px-3 text-[15px] font-medium text-accent active:opacity-60"
          >
            Done
          </button>
        </div>

        <div className="flex max-h-[65dvh] flex-col gap-5 overflow-y-auto px-4 pt-3 pb-8">
          <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
            <SettingsGroup header={`New #${tag} property`}>
              <div className="flex items-center gap-2 px-3 py-2">
                <input
                  autoFocus
                  type="text"
                  aria-label="Property name"
                  enterKeyHint="done"
                  placeholder="Property name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    setError(null)
                  }}
                  className="h-10 min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-text-muted"
                />
                <button
                  type="submit"
                  disabled={name.trim() === '' || saving}
                  className="flex h-8 shrink-0 items-center rounded-full bg-accent-fill px-3.5 text-[13px] font-medium text-text-on-brand disabled:opacity-40"
                >
                  Add
                </button>
              </div>
            </SettingsGroup>
            {error === null ? null : (
              <p role="alert" className="px-2 text-[13px] text-destructive">
                {error}
              </p>
            )}
            <SettingsGroup header="Type">
              {QUICK_PROPERTY_TYPES.map((entry) => {
                const Glyph = PROPERTY_TYPE_ICONS[entry]
                const selected = entry === type
                return (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => {
                      haptic('selection')
                      setType(entry)
                    }}
                    className="flex min-h-11 w-full items-center gap-3 px-3.5 text-left text-[15px] text-text active:bg-surface-hover"
                  >
                    <Glyph aria-hidden className="size-[18px] shrink-0 text-text-muted" />
                    <span className={cn('min-w-0 flex-1 truncate', selected && 'font-medium')}>
                      {PROPERTY_TYPE_LABELS[entry]}
                    </span>
                    <Check
                      aria-hidden
                      className={cn(
                        'size-4 shrink-0 text-accent',
                        selected ? 'opacity-100' : 'opacity-0',
                      )}
                    />
                  </button>
                )
              })}
            </SettingsGroup>
            <SettingsGroup>
              <SettingsActionRow
                label={`More #${tag} options…`}
                onPress={() => {
                  onOpenChange(false)
                  reset()
                  onEditSchema()
                }}
              />
            </SettingsGroup>
          </form>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
