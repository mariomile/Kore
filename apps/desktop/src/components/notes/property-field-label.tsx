import { useState, type ReactElement } from 'react'
import {
  errorMessage,
  QUICK_PROPERTY_TYPES,
  type TagProperty,
  type TagPropertyType,
} from '@reflect/core'
import { Settings } from '@/components/icons'
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
import { setTagPropertyType } from '@/lib/tags/schema-edits'
import { invalidateOnNextIndexApply } from '@/lib/tags/use-commit-note-property'
import { cn } from '@/lib/utils'
import { useGraph } from '@/providers/graph-provider'

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
 * glance. Clicking it opens the field's menu: the type, switchable in place
 * (written to the owning tag's schema, so it applies to every note of that
 * type, which the menu says), and the door to the full schema dialog. A
 * loose field has no schema to change, so its menu only names the type read
 * from its value.
 */
export function PropertyFieldLabel({
  property,
  ownerTag,
  className,
}: PropertyFieldLabelProps): ReactElement {
  const { graph } = useGraph()
  const [configuring, setConfiguring] = useState(false)
  const TypeIcon = PROPERTY_TYPE_ICONS[property.type]
  const typeLabel = PROPERTY_TYPE_LABELS[property.type]
  // The current type stays listed even when it is not a one-gesture type
  // (a formula, a stamp), so the menu always shows what the field is.
  const choices: readonly TagPropertyType[] = (
    QUICK_PROPERTY_TYPES as readonly TagPropertyType[]
  ).includes(property.type)
    ? QUICK_PROPERTY_TYPES
    : [property.type, ...QUICK_PROPERTY_TYPES]

  const changeType = async (type: TagPropertyType): Promise<void> => {
    if (ownerTag === null || graph === null || type === property.type) {
      return
    }
    try {
      await setTagPropertyType(ownerTag, graph.generation, property.key, type)
      invalidateOnNextIndexApply()
    } catch (error) {
      toast.add({
        type: 'error',
        title: "Couldn't change the property type",
        description: errorMessage(error),
      })
    }
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
              className={cn(
                'flex min-w-0 shrink-0 items-center gap-1.5 rounded-sm text-left text-[13px] text-text-muted transition-colors hover:text-text focus-visible:outline-none data-[popup-open]:text-text',
                className,
              )}
            >
              <TypeIcon aria-hidden className="size-3.5 shrink-0" />
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
