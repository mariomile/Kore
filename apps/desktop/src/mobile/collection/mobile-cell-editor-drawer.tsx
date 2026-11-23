import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react'
import {
  parseRating,
  relationDisplay,
  relationTarget,
  relationTargetOf,
  relationValue,
  type CollectionValue,
  type TagProperty,
} from '@kore/core'
import { Check, ExternalLink, Star } from '@/components/icons'
import {
  editorSeedList,
  editorSeedText,
  typedValueForText,
  useRelationCreateEntry,
  useRelationSuggestions,
} from '@/components/tags/property-editor-shared'
import { PROPERTY_TYPE_ICONS } from '@/components/tags/property-type-icons'
import { selectOptionBadgeClass } from '@/components/tags/select-colors'
import { Drawer, DrawerBody, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import { SearchInput } from '@/mobile/search-input'

/** The tapped mobile table cell currently open in the editor sheet. */
export interface MobileCellTarget {
  entryPath: string
  entryTitle: string
  property: TagProperty
  value: CollectionValue | undefined
}

interface MobileCellEditorDrawerProps {
  target: MobileCellTarget | null
  onClose: () => void
  onCommit: (path: string, key: string, value: unknown) => void
  onOpenRelation: (target: string) => void
}

/**
 * Touch-native bottom sheet editor for mobile collection table cells. Replaces
 * tiny desktop popovers on phones with 44pt+ rows, colored option pills,
 * tactile star ratings, and keyboard-avoiding inputs.
 */
export function MobileCellEditorDrawer({
  target,
  onClose,
  onCommit,
  onOpenRelation,
}: MobileCellEditorDrawerProps): ReactElement {
  const open = target !== null
  const flushPendingRef = useRef<(() => void) | null>(null)
  const TypeIcon = target === null ? null : PROPERTY_TYPE_ICONS[target.property.type]
  const commit = (value: unknown): void => {
    if (target === null) {
      return
    }
    onCommit(target.entryPath, target.property.key, value)
  }
  const handleClose = (): void => {
    const flush = flushPendingRef.current
    flushPendingRef.current = null
    flush?.()
    onClose()
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          handleClose()
        }
      }}
    >
      <DrawerContent>
        {target === null ? null : (
          <>
            <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {TypeIcon === null ? null : (
                    <TypeIcon aria-hidden className="size-4 shrink-0 text-text-muted" />
                  )}
                  <DrawerTitle className="p-0 text-[16px] font-semibold text-text">
                    {target.property.name}
                  </DrawerTitle>
                </div>
                <p className="mt-0.5 truncate text-[13px] text-text-muted">{target.entryTitle}</p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                className="flex h-9 shrink-0 items-center rounded-full px-3 text-[14px] font-medium text-accent active:bg-surface-hover"
              >
                Done
              </button>
            </div>
            <DrawerBody className="gap-3 px-5 pt-2 pb-5">
              {target.property.type === 'select' ||
              target.property.type === 'status' ||
              target.property.type === 'multiselect' ? (
                <MobileSelectBody
                  key={`${target.entryPath}:${target.property.key}`}
                  property={target.property}
                  value={target.value}
                  onCommit={commit}
                  onClose={onClose}
                />
              ) : target.property.type === 'rating' ? (
                <MobileRatingBody
                  key={`${target.entryPath}:${target.property.key}`}
                  value={target.value}
                  onCommit={commit}
                  onClose={onClose}
                />
              ) : target.property.type === 'relation' ||
                target.property.type === 'person' ||
                target.property.type === 'relations' ? (
                <MobileRelationBody
                  key={`${target.entryPath}:${target.property.key}`}
                  property={target.property}
                  value={target.value}
                  onCommit={commit}
                  onOpenRelation={onOpenRelation}
                  onClose={onClose}
                />
              ) : (
                <MobileInputBody
                  key={`${target.entryPath}:${target.property.key}`}
                  property={target.property}
                  value={target.value}
                  onCommit={commit}
                  onClose={onClose}
                  flushRef={flushPendingRef}
                />
              )}
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  )
}

function MobileSelectBody({
  property,
  value,
  onCommit,
  onClose,
}: {
  property: TagProperty
  value: CollectionValue | undefined
  onCommit: (value: unknown) => void
  onClose: () => void
}): ReactElement {
  const multiple = property.type === 'multiselect'
  const [localSelected, setLocalSelected] = useState<string[]>(() => editorSeedList(value))
  const [query, setQuery] = useState('')
  const options = [...new Set([...(property.options ?? []), ...localSelected])]
  const searchable = options.length > 6
  const needle = query.trim().toLocaleLowerCase()
  const filtered =
    needle === ''
      ? options
      : options.filter((option) => option.toLocaleLowerCase().includes(needle))

  const chooseSingle = (option: string): void => {
    hapticImpactLight()
    onCommit(localSelected.length === 1 && localSelected[0] === option ? undefined : option)
    onClose()
  }
  const toggleMultiple = (option: string): void => {
    hapticImpactLight()
    const next = localSelected.includes(option)
      ? localSelected.filter((entry) => entry !== option)
      : [...localSelected, option]
    setLocalSelected(next)
    onCommit(next.length === 0 ? undefined : next)
  }
  const clear = (): void => {
    hapticImpactLight()
    setLocalSelected([])
    onCommit(undefined)
    onClose()
  }

  return (
    <div className="flex flex-col gap-2">
      {searchable ? (
        <SearchInput
          aria-label={`Search ${property.name}`}
          placeholder={`Search ${property.name}…`}
          value={query}
          onValueChange={setQuery}
        />
      ) : null}
      <div role="listbox" aria-label={`Choose ${property.name}`} className="flex flex-col">
        {filtered.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">No options.</p>
        ) : (
          filtered.map((option) => {
            const active = localSelected.includes(option)
            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => (multiple ? toggleMultiple(option) : chooseSingle(option))}
                className="flex h-12 items-center justify-between gap-3 rounded-xl px-2.5 text-left active:bg-surface-hover"
              >
                <span
                  className={cn(
                    'truncate rounded-[5px] px-2.5 py-1 text-[13px] font-medium leading-tight',
                    selectOptionBadgeClass(option, property),
                  )}
                >
                  {option}
                </span>
                <Check
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 text-accent transition-opacity',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            )
          })
        )}
        {localSelected.length > 0 ? (
          <>
            <div aria-hidden className="my-1 border-t border-border" />
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={clear}
              className="flex h-12 items-center rounded-xl px-2.5 text-left text-[15px] text-text-muted active:bg-surface-hover"
            >
              Clear
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function MobileRatingBody({
  value,
  onCommit,
  onClose,
}: {
  value: CollectionValue | undefined
  onCommit: (value: unknown) => void
  onClose: () => void
}): ReactElement {
  const numeric = value?.valueType === 'number' ? (value.valueNumber ?? Number(value.value)) : NaN
  const current = parseRating(numeric)

  const pick = (score: number): void => {
    hapticImpactLight()
    onCommit(current === score ? undefined : score)
    onClose()
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label="Rating"
        className="flex items-center justify-center gap-2 py-2"
      >
        {[1, 2, 3, 4, 5].map((score) => {
          const filled = current !== null && score <= current
          return (
            <button
              key={score}
              type="button"
              role="radio"
              aria-checked={current === score}
              aria-label={`${score} ${score === 1 ? 'star' : 'stars'}`}
              onClick={() => pick(score)}
              className={cn(
                'flex size-12 items-center justify-center rounded-xl border transition-colors active:scale-95',
                filled
                  ? 'border-accent/40 bg-accent-soft text-accent'
                  : 'border-border bg-surface-hover/50 text-text-muted',
              )}
            >
              <Star aria-hidden className="size-6" />
            </button>
          )
        })}
      </div>
      {current !== null ? (
        <button
          type="button"
          onClick={() => {
            hapticImpactLight()
            onCommit(undefined)
            onClose()
          }}
          className="flex h-11 items-center justify-center rounded-xl text-[15px] text-text-muted active:bg-surface-hover"
        >
          Clear rating
        </button>
      ) : null}
    </div>
  )
}

function MobileInputBody({
  property,
  value,
  onCommit,
  onClose,
  flushRef,
}: {
  property: TagProperty
  value: CollectionValue | undefined
  onCommit: (value: unknown) => void
  onClose: () => void
  flushRef: { current: (() => void) | null }
}): ReactElement {
  const seed = property.type === 'files' ? editorSeedList(value).join(', ') : editorSeedText(value)
  const [draft, setDraft] = useState(seed)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const settledRef = useRef(false)
  const inputId = useId()

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const inputType =
    property.type === 'number'
      ? 'number'
      : property.type === 'date'
        ? 'date'
        : property.type === 'email'
          ? 'email'
          : property.type === 'phone'
            ? 'tel'
            : property.type === 'url'
              ? 'url'
              : 'text'

  const inputMode =
    property.type === 'number'
      ? 'decimal'
      : property.type === 'email'
        ? 'email'
        : property.type === 'phone'
          ? 'tel'
          : property.type === 'url'
            ? 'url'
            : undefined

  const commitDraft = (): void => {
    if (settledRef.current) {
      return
    }
    settledRef.current = true
    if (draft === seed) {
      return
    }
    const trimmed = draft.trim()
    if (
      property.type === 'number' &&
      ((trimmed !== '' && !Number.isFinite(Number(trimmed))) ||
        inputRef.current?.validity.badInput === true)
    ) {
      return
    }
    hapticImpactLight()
    onCommit(typedValueForText(property, draft))
  }

  // Keep Done and swipe/backdrop dismiss saving any in-progress draft,
  // matching how select and relation sheets persist without a separate step.
  useEffect(() => {
    flushRef.current = commitDraft
    return () => {
      flushRef.current = null
    }
  })

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    flushRef.current = null
    commitDraft()
    onClose()
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        id={inputId}
        ref={inputRef}
        type={inputType}
        inputMode={inputMode}
        enterKeyHint="done"
        value={draft}
        aria-label={property.name}
        placeholder={property.name}
        onChange={(event) => setDraft(event.target.value)}
        className="h-12 w-full rounded-xl border border-border-strong bg-input-bg px-3.5 text-[16px] text-text outline-none focus:border-border-focus placeholder:text-text-muted"
      />
      <div className="flex items-center gap-2">
        {value !== undefined ? (
          <button
            type="button"
            onClick={() => {
              settledRef.current = true
              flushRef.current = null
              hapticImpactLight()
              onCommit(undefined)
              onClose()
            }}
            className="flex h-11 flex-1 items-center justify-center rounded-xl border border-border text-[15px] font-medium text-text-secondary active:bg-surface-hover"
          >
            Clear
          </button>
        ) : null}
        <button
          type="submit"
          className="flex h-11 flex-1 items-center justify-center rounded-xl bg-accent-fill text-[15px] font-medium text-text-on-brand active:opacity-85"
        >
          Save
        </button>
      </div>
    </form>
  )
}

function MobileRelationBody({
  property,
  value,
  onCommit,
  onOpenRelation,
  onClose,
}: {
  property: TagProperty
  value: CollectionValue | undefined
  onCommit: (value: unknown) => void
  onOpenRelation: (target: string) => void
  onClose: () => void
}): ReactElement {
  const multiple = property.type === 'relations'
  const [query, setQuery] = useState('')
  const [links, setLinks] = useState<string[]>(() => editorSeedList(value))
  const currentTarget = !multiple && value !== undefined ? relationTarget(value.value) : null
  const target = relationTargetOf(property)
  const targetOf = (link: string): string => relationTarget(link) ?? link
  const suggestions = useRelationSuggestions(true, query, target)
  const createEntry = useRelationCreateEntry(property, true, query, suggestions)

  const chooseSingle = (insertText: string): void => {
    hapticImpactLight()
    onCommit(relationValue(insertText))
    onClose()
  }
  const toggleMulti = (insertText: string): void => {
    hapticImpactLight()
    const candidate = relationValue(insertText)
    const next = links.some((link) => targetOf(link) === targetOf(candidate))
      ? links.filter((link) => targetOf(link) !== targetOf(candidate))
      : [...links, candidate]
    setLinks(next)
    onCommit(next.length === 0 ? undefined : next)
  }
  const appendMulti = (insertText: string): void => {
    hapticImpactLight()
    const candidate = relationValue(insertText)
    if (links.some((link) => targetOf(link) === targetOf(candidate))) {
      return
    }
    const next = [...links, candidate]
    setLinks(next)
    onCommit(next)
  }
  const clear = (): void => {
    hapticImpactLight()
    setLinks([])
    onCommit(undefined)
    onClose()
  }

  return (
    <div className="flex flex-col gap-2">
      <SearchInput
        aria-label={`Link ${property.name}`}
        placeholder={
          target === undefined
            ? multiple
              ? 'Link notes…'
              : 'Link to a note…'
            : multiple
              ? `Link #${target} rows…`
              : `Link a #${target} row…`
        }
        value={query}
        onValueChange={setQuery}
      />
      <div role="listbox" aria-label={`Link ${property.name}`} className="flex flex-col">
        {currentTarget !== null && query === '' ? (
          <button
            type="button"
            onClick={() => {
              onClose()
              onOpenRelation(currentTarget)
            }}
            className="mb-1 flex h-12 items-center gap-2.5 rounded-xl bg-surface-hover/70 px-3 text-left text-[15px] font-medium text-accent active:bg-surface-active"
          >
            <ExternalLink aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Open “{currentTarget}”</span>
          </button>
        ) : null}
        {multiple && query === ''
          ? links.map((link) => (
              <button
                key={`linked:${link}`}
                type="button"
                role="option"
                aria-selected={true}
                onClick={() => toggleMulti(targetOf(link))}
                className="flex h-12 items-center gap-3 rounded-xl px-2.5 text-left text-[15px] text-text active:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate">{relationDisplay(link) ?? link}</span>
                <Check aria-hidden className="size-4 shrink-0 text-accent" />
              </button>
            ))
          : null}
        {suggestions
          .filter(
            (suggestion) =>
              !multiple ||
              query !== '' ||
              !links.some((link) => targetOf(link) === targetOf(suggestion.insertText)),
          )
          .map((suggestion) => {
            const active = multiple
              ? links.some((link) => targetOf(link) === targetOf(suggestion.insertText))
              : currentTarget === suggestion.target
            return (
              <button
                key={`${suggestion.target}:${suggestion.alias ?? ''}`}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() =>
                  multiple
                    ? toggleMulti(suggestion.insertText)
                    : chooseSingle(suggestion.insertText)
                }
                className="flex h-12 items-center gap-3 rounded-xl px-2.5 text-left text-[15px] text-text active:bg-surface-hover"
              >
                <span className="min-w-0 flex-1 truncate">{suggestion.title}</span>
                {suggestion.alias !== null ? (
                  <span className="shrink-0 text-xs text-text-muted">{suggestion.alias}</span>
                ) : null}
                <Check
                  aria-hidden
                  className={cn(
                    'size-4 shrink-0 text-accent',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                />
              </button>
            )
          })}
        {createEntry !== null ? (
          <button
            type="button"
            role="option"
            aria-selected={false}
            onClick={() => void createEntry.create().then(multiple ? appendMulti : chooseSingle)}
            className="flex min-h-12 items-center rounded-xl px-2.5 py-2 text-left text-[15px] font-medium text-accent active:bg-surface-hover"
          >
            <span className="min-w-0 flex-1 break-words">{createEntry.label}</span>
          </button>
        ) : null}
        {suggestions.length === 0 && createEntry === null && (!multiple || links.length === 0) ? (
          <p className="py-6 text-center text-sm text-text-muted">
            {query === '' ? 'Type to find a note.' : 'No matching notes.'}
          </p>
        ) : null}
        {(multiple ? links.length > 0 : value !== undefined) ? (
          <>
            <div aria-hidden className="my-1 border-t border-border" />
            <button
              type="button"
              role="option"
              aria-selected={false}
              onClick={clear}
              className="flex h-12 items-center rounded-xl px-2.5 text-left text-[15px] text-text-muted active:bg-surface-hover"
            >
              Clear
            </button>
          </>
        ) : null}
      </div>
    </div>
  )
}
