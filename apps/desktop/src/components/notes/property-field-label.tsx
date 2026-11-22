import { useState, type ReactElement } from 'react'
import {
  errorMessage,
  QUICK_PROPERTY_TYPES,
  type TagProperty,
  type TagPropertyType,
} from '@kore/core'
import { Settings, Trash } from '@/components/icons'
import { PROPERTY_TYPE_ICONS } from '@/components/tags/property-type-icons'
import { PROPERTY_TYPE_LABELS } from '@/components/tags/tag-config-drafts'
import { TagConfigDialog } from '@/components/tags/tag-config-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from '@/components/ui/toast'
import { isMobileSurface } from '@/lib/platform-surface'
import { removeTagProperty, renameTagProperty, setTagPropertyType } from '@/lib/tags/schema-edits'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { useGraph } from '@/providers/graph-provider'
import { PropertyLabelSheet } from './property-label-sheet'

interface PropertyFieldLabelProps {
  property: TagProperty
  /**
   * The tag whose schema declares this field (display casing), or `null` for
   * a note-owned loose field, whose type is read from its value.
   */
  ownerTag: string | null
  /** Width of the label column — header uses `w-32`, the rail uses `w-24`. */
  className?: string
}

/**
 * A note field's name, drawn with its type's glyph so the type reads at a
 * glance. On desktop, clicking opens a compact menu (edit fields, switch type,
 * delete property). On iPhone, tapping opens a Notion-style animated bottom
 * sheet (rename, change type, edit fields, delete property).
 */
export function PropertyFieldLabel({
  property,
  ownerTag,
  className,
}: PropertyFieldLabelProps): ReactElement {
  const { graph } = useGraph()
  const mobile = isMobileSurface()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [configuring, setConfiguring] = useState(false)
  const TypeIcon = PROPERTY_TYPE_ICONS[property.type]
  const typeLabel = PROPERTY_TYPE_LABELS[property.type]
  // The current type stays listed even when it is not a one-gesture type
  // (a formula, a stamp), so the menu always shows what the field is.
  const choices = QUICK_PROPERTY_TYPES.includes(property.type)
    ? QUICK_PROPERTY_TYPES
    : [property.type, ...QUICK_PROPERTY_TYPES]

  const changeType = async (type: TagPropertyType): Promise<boolean> => {
    if (ownerTag === null || graph === null || type === property.type) {
      return false
    }
    try {
      await setTagPropertyType(ownerTag, graph.generation, property.key, type)
      invalidateOnNextIndexApply()
      return true
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't change the property type",
        description: errorMessage(error),
      })
      return false
    }
  }

  const rename = async (nextName: string): Promise<boolean> => {
    if (ownerTag === null || graph === null) {
      return false
    }
    try {
      await renameTagProperty(ownerTag, graph.generation, property.key, nextName)
      invalidateOnNextIndexApply()
      return true
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't rename the property",
        description: errorMessage(error),
      })
      return false
    }
  }

  const remove = async (): Promise<boolean> => {
    if (ownerTag === null || graph === null) {
      return false
    }
    try {
      await removeTagProperty(ownerTag, graph.generation, property.key)
      invalidateOnNextIndexApply()
      return true
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't delete the property",
        description: errorMessage(error),
      })
      return false
    }
  }

  const triggerClass = cn(
    'flex min-w-0 shrink-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-text-secondary transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline-none data-[popup-open]:bg-surface-hover data-[popup-open]:text-text',
    mobile ? 'min-h-9 text-[14px] active:bg-surface-hover' : 'min-h-7 text-[13px]',
    className,
  )

  if (mobile) {
    return (
      <>
        <button
          type="button"
          aria-label={`${property.name} (${typeLabel})`}
          onClick={() => {
            hapticImpactLight()
            setSheetOpen(true)
          }}
          className={triggerClass}
        >
          <TypeIcon aria-hidden className="size-4 shrink-0 text-text-muted" />
          <span className="truncate">{property.name}</span>
        </button>
        <PropertyLabelSheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          property={property}
          ownerTag={ownerTag}
          onRename={rename}
          onChangeType={changeType}
          onEditSchema={() => setConfiguring(true)}
          onDelete={remove}
        />
        {configuring && ownerTag !== null ? (
          <TagConfigDialog tag={ownerTag} onClose={() => setConfiguring(false)} />
        ) : null}
      </>
    )
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`${property.name} (${typeLabel})`}
              title={`${typeLabel}: click to change`}
              className={triggerClass}
            >
              <TypeIcon aria-hidden className="size-3.5 shrink-0 text-text-muted" />
              <span className="truncate">{property.name}</span>
            </button>
          }
        />
        <DropdownMenuContent align="start" className="w-60">
          {ownerTag === null ? (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Type: {typeLabel}</DropdownMenuLabel>
              <p className="px-1.5 pb-1 text-xs text-text-muted">
                This field isn’t part of a type, so its type is read from the value.
              </p>
            </DropdownMenuGroup>
          ) : (
            <>
              {/* First, so it never scrolls out of a long type list. */}
              <DropdownMenuItem onClick={() => setConfiguring(true)}>
                <Settings aria-hidden className="size-3.5" />
                Edit #{ownerTag} fields…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Type, for every #{ownerTag} note</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={property.type}
                  onValueChange={(value: TagPropertyType) => void changeType(value)}
                >
                  {choices.map((type) => {
                    const Glyph = PROPERTY_TYPE_ICONS[type]
                    return (
                      <DropdownMenuRadioItem key={type} value={type} closeOnClick>
                        <Glyph aria-hidden className="size-3.5" />
                        {PROPERTY_TYPE_LABELS[type]}
                      </DropdownMenuRadioItem>
                    )
                  })}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => void remove()}>
                <Trash aria-hidden className="size-3.5" />
                Delete property
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {configuring && ownerTag !== null ? (
        <TagConfigDialog tag={ownerTag} onClose={() => setConfiguring(false)} />
      ) : null}
    </>
  )
}
