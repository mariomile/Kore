import { useState, type ReactElement, type ReactNode } from 'react'
import type { CollectionEntry, CollectionSort, TagProperty, TagType } from '@kore/core'
import {
  filterLabel,
  filterValueInventory,
  operatorsFor,
  type CollectionFilter,
  type CollectionFilterMatch,
  type CollectionFilterOperator,
} from '@/components/all-notes/collection-filter-menu'
import { ArrowDown, ArrowUp, Check, ChevronLeft, Close, Plus } from '@/components/icons'
import { selectOptionDotClass } from '@/components/tags/select-colors'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { cn } from '@/lib/utils'
import { hapticImpactLight } from '@/mobile/haptics'
import {
  SettingsActionRow,
  SettingsGroup,
  SettingsNavRow,
  SettingsSegmentedRow,
  SettingsSelectRow,
  SettingsSwitchRow,
} from '@/mobile/settings-list'
import {
  addSort,
  fieldsSummary,
  filterCountFor,
  flipSort,
  hasFilter,
  removeSort,
  sortFieldName,
  sortFields,
  sortSummary,
  toggleFilter,
} from './mobile-view-options-model'
import type { MobileTypeView } from './mobile-type-view'

/** How many equality picks a field's filter page lists. */
const MAX_FILTER_VALUES = 24

/** The grouping the current layout offers: the table's (may be none) or the board's lanes. */
export interface ViewGrouping {
  properties: readonly TagProperty[]
  selected: TagProperty | null
  /** The table can be flat; the board always groups. */
  allowNone: boolean
  onChange: (key: string | null) => void
}

interface MobileViewOptionsProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The saved view the changes land in, for the footer. */
  viewName: string
  /** Where the view lives, for the footers: a type's saved view, or a note's own fence. */
  scope?: 'savedView' | 'note'
  layout: MobileTypeView
  /** The full schema (hidden fields included: they still filter and sort). */
  type: TagType
  /** The unfiltered rows: the filter pages offer the values they hold. */
  entries: readonly CollectionEntry[] | undefined
  filters: readonly CollectionFilter[]
  onFiltersChange: (filters: CollectionFilter[]) => void
  match: CollectionFilterMatch
  onMatchChange: (match: CollectionFilterMatch) => void
  sorts: readonly CollectionSort[]
  onSortsChange: (sorts: readonly CollectionSort[]) => void
  grouping: ViewGrouping | null
  hiddenFields: ReadonlySet<string>
  onToggleField: (key: string) => void
}

type Page =
  | { kind: 'root' }
  | { kind: 'filter' }
  | { kind: 'filterField'; key: string }
  | { kind: 'sort' }
  | { kind: 'group' }
  | { kind: 'fields' }

const ROOT: Page = { kind: 'root' }

/**
 * The type page's view options on a phone (Craft's view menu, Notion's view
 * settings): Filter, Sort, Group and Fields as one sheet that drills into a
 * page each, the iOS Settings way. Filter, sort and group are the saved
 * view's own lens, so a change here is the same change on the Mac's tab;
 * which fields show is this device's column layout, like the Mac's table.
 * Every change applies at once, behind the sheet.
 */
export function MobileViewOptions(props: MobileViewOptionsProps): ReactElement {
  const { open, onOpenChange } = props
  const [page, setPage] = useState<Page>(ROOT)
  const go = (next: Page): void => {
    hapticImpactLight()
    setPage(next)
  }
  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setPage(ROOT)
        }
      }}
    >
      <DrawerContent aria-label="View options">
        <PageHeader page={page} type={props.type} onBack={() => go(backOf(page))} />
        <div className="flex max-h-[62dvh] min-h-[16rem] flex-col gap-6 overflow-y-auto px-4 pt-4 pb-8">
          <PageBody page={page} go={go} {...props} />
        </div>
      </DrawerContent>
    </Drawer>
  )
}

function backOf(page: Page): Page {
  return page.kind === 'filterField' ? { kind: 'filter' } : ROOT
}

function pageTitle(page: Page, type: TagType): string {
  switch (page.kind) {
    case 'root':
      return 'View options'
    case 'filter':
      return 'Filter'
    case 'filterField':
      return type.properties.find((property) => property.key === page.key)?.name ?? page.key
    case 'sort':
      return 'Sort'
    case 'group':
      return 'Group'
    case 'fields':
      return 'Fields'
  }
}

function PageHeader({
  page,
  type,
  onBack,
}: {
  page: Page
  type: TagType
  onBack: () => void
}): ReactElement {
  return (
    <div className="relative flex h-14 shrink-0 items-end justify-center px-12 pb-1">
      {page.kind === 'root' ? null : (
        <button
          type="button"
          aria-label="Back"
          onClick={onBack}
          className="absolute bottom-0 left-2 flex size-11 items-center justify-center rounded-full text-primary active:opacity-60"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
      )}
      <DrawerTitle className="truncate px-0 pt-0 pb-2.5 text-center text-[17px] font-semibold">
        {pageTitle(page, type)}
      </DrawerTitle>
    </div>
  )
}

function PageBody({
  page,
  go,
  ...props
}: MobileViewOptionsProps & { page: Page; go: (page: Page) => void }): ReactElement {
  switch (page.kind) {
    case 'root':
      return <RootPage go={go} {...props} />
    case 'filter':
      return <FilterPage go={go} {...props} />
    case 'filterField':
      return <FilterFieldPage fieldKey={page.key} {...props} />
    case 'sort':
      return <SortPage {...props} />
    case 'group':
      return <GroupPage {...props} />
    case 'fields':
      return <FieldsPage {...props} />
  }
}

function RootPage({
  go,
  viewName,
  scope = 'savedView',
  layout,
  type,
  filters,
  sorts,
  grouping,
  hiddenFields,
}: MobileViewOptionsProps & { go: (page: Page) => void }): ReactElement {
  return (
    <>
      <SettingsGroup
        footer={
          scope === 'note'
            ? 'Saved in this note, so the Mac shows the same view.'
            : `Filter, sort and group are saved in “${viewName}”, on your Mac too.`
        }
      >
        <SettingsNavRow
          label="Filter"
          value={filters.length === 0 ? 'None' : String(filters.length)}
          onPress={() => go({ kind: 'filter' })}
          disabled={type.properties.length === 0 && filters.length === 0}
        />
        <SettingsNavRow
          label="Sort"
          value={sortSummary(type, sorts)}
          onPress={() => go({ kind: 'sort' })}
        />
        {grouping !== null && grouping.properties.length > 0 ? (
          <SettingsNavRow
            label="Group"
            value={grouping.selected?.name ?? 'None'}
            onPress={() => go({ kind: 'group' })}
          />
        ) : null}
      </SettingsGroup>
      {layout !== 'board' && type.properties.length > 0 ? (
        <SettingsGroup
          footer={scope === 'note' ? null : 'Which fields show is kept on this iPhone.'}
        >
          <SettingsNavRow
            label="Fields"
            value={fieldsSummary(type, hiddenFields)}
            onPress={() => go({ kind: 'fields' })}
          />
        </SettingsGroup>
      ) : null}
    </>
  )
}

function FilterPage({
  go,
  type,
  filters,
  onFiltersChange,
  match,
  onMatchChange,
}: MobileViewOptionsProps & { go: (page: Page) => void }): ReactElement {
  return (
    <>
      {filters.length > 0 ? (
        <SettingsGroup header="Showing notes where">
          {filters.map((filter) => (
            <RemovableRow
              key={`${filter.key}:${filter.operator}:${filter.text}`}
              label={filterLabel(type, filter)}
              removeLabel={`Remove filter ${filterLabel(type, filter)}`}
              onRemove={() => onFiltersChange(toggleFilter(filters, filter))}
            />
          ))}
          {filters.length > 1 ? (
            <SettingsSegmentedRow
              label="Match"
              value={match}
              options={[
                { value: 'all', label: 'All' },
                { value: 'any', label: 'Any' },
              ]}
              onChange={onMatchChange}
            />
          ) : null}
        </SettingsGroup>
      ) : null}
      {type.properties.length > 0 ? (
        <SettingsGroup header={filters.length === 0 ? 'Filter by' : 'Add a filter'}>
          {type.properties.map((property) => {
            const count = filterCountFor(filters, property.key)
            return (
              <SettingsNavRow
                key={property.key}
                label={property.name}
                value={count === 0 ? undefined : String(count)}
                onPress={() => go({ kind: 'filterField', key: property.key })}
              />
            )
          })}
        </SettingsGroup>
      ) : null}
      {filters.length > 0 ? (
        <SettingsGroup>
          <SettingsActionRow
            label="Clear filters"
            tone="destructive"
            onPress={() => {
              hapticImpactLight()
              onFiltersChange([])
            }}
          />
        </SettingsGroup>
      ) : null}
    </>
  )
}

/** The typed conditions' wording: dates read as before/after, numbers as less/more. */
function conditionLabel(operator: CollectionFilterOperator, dated: boolean): string | null {
  switch (operator) {
    case 'contains':
      return 'Contains'
    case 'gt':
      return dated ? 'After' : 'More than'
    case 'lt':
      return dated ? 'Before' : 'Less than'
    default:
      return null
  }
}

function FilterFieldPage({
  fieldKey,
  type,
  entries,
  filters,
  onFiltersChange,
}: MobileViewOptionsProps & { fieldKey: string }): ReactElement | null {
  const property = type.properties.find((candidate) => candidate.key === fieldKey)
  if (property === undefined) {
    return null
  }
  const operators = operatorsFor(property)
  const values =
    property.type === 'checkbox' ? [] : filterValueInventory(property, entries, MAX_FILTER_VALUES)
  const toggle = (operator: CollectionFilterOperator, text: string): void => {
    hapticImpactLight()
    onFiltersChange(toggleFilter(filters, { key: property.key, operator, text }))
  }
  const coloredOptions =
    property.type === 'select' || property.type === 'status' || property.type === 'multiselect'
  const dated =
    property.type === 'date' || property.type === 'created' || property.type === 'updated'
  const conditions = operators.flatMap((operator) => {
    const label = conditionLabel(operator, dated)
    return label === null ? [] : [{ operator, label }]
  })
  return (
    <>
      {values.length > 0 ? (
        <SettingsGroup
          header="Is"
          footer={values.length > 1 ? 'Pick several to show any of them.' : null}
        >
          {values.map((value) => (
            <ValueRow
              key={value}
              label={value}
              dot={coloredOptions ? selectOptionDotClass(value) : null}
              selected={hasFilter(filters, { key: property.key, operator: 'is', text: value })}
              onPress={() => toggle('is', value)}
            />
          ))}
        </SettingsGroup>
      ) : null}
      {conditions.length > 0 ? (
        <SettingsGroup header="Condition">
          {conditions.map(({ operator, label }) => (
            <ConditionRow
              key={operator}
              label={label}
              inputType={
                dated
                  ? 'date'
                  : property.type === 'number' || property.type === 'rating'
                    ? 'number'
                    : 'text'
              }
              onSubmit={(text) =>
                onFiltersChange(
                  hasFilter(filters, { key: property.key, operator, text })
                    ? [...filters]
                    : [...filters, { key: property.key, operator, text }],
                )
              }
            />
          ))}
        </SettingsGroup>
      ) : null}
      <SettingsGroup header={property.type === 'checkbox' ? 'Show' : 'Or'}>
        <SettingsSelectRow
          label={property.type === 'checkbox' ? 'Ticked' : 'Is set'}
          selected={hasFilter(filters, { key: property.key, operator: 'notEmpty', text: '' })}
          onPress={() => toggle('notEmpty', '')}
        />
        <SettingsSelectRow
          label={property.type === 'checkbox' ? 'Not ticked' : 'Is empty'}
          selected={hasFilter(filters, { key: property.key, operator: 'empty', text: '' })}
          onPress={() => toggle('empty', '')}
        />
      </SettingsGroup>
    </>
  )
}

/** A condition with a typed value: the field, then Add (or Return). */
function ConditionRow({
  label,
  inputType,
  onSubmit,
}: {
  label: string
  inputType: 'text' | 'number' | 'date'
  onSubmit: (text: string) => void
}): ReactElement {
  const [draft, setDraft] = useState('')
  const submit = (): void => {
    const text = draft.trim()
    if (text === '') {
      return
    }
    hapticImpactLight()
    onSubmit(text)
    setDraft('')
  }
  return (
    <div className="flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-[15px]">
      <span className="shrink-0">{label}</span>
      <input
        aria-label={label}
        type={inputType}
        inputMode={inputType === 'number' ? 'decimal' : undefined}
        enterKeyHint="done"
        value={draft}
        placeholder={inputType === 'date' ? undefined : 'Value'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
        }}
        className="h-9 min-w-0 flex-1 bg-transparent text-right text-[15px] text-text outline-none placeholder:text-text-muted"
      />
      <button
        type="button"
        aria-label={`Add ${label.toLowerCase()} filter`}
        disabled={draft.trim() === ''}
        onClick={submit}
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-primary transition-opacity active:opacity-60 disabled:opacity-40"
      >
        <Plus aria-hidden className="size-4" />
      </button>
    </div>
  )
}

function SortPage({ type, sorts, onSortsChange }: MobileViewOptionsProps): ReactElement {
  const unsorted = sortFields(type).filter((field) => !sorts.some((sort) => sort.key === field.key))
  return (
    <>
      {sorts.length > 0 ? (
        <SettingsGroup
          header="Sorted by"
          footer={sorts.length > 1 ? 'Each sort breaks the ties of the one above it.' : null}
        >
          {sorts.map((sort) => {
            const name = sortFieldName(type, sort.key)
            const ascending = sort.direction === 'asc'
            return (
              <RemovableRow
                key={sort.key}
                label={name}
                removeLabel={`Stop sorting by ${name}`}
                onRemove={() => onSortsChange(removeSort(sorts, sort.key))}
              >
                <button
                  type="button"
                  aria-label={`${name}: ${ascending ? 'ascending' : 'descending'}`}
                  onClick={() => {
                    hapticImpactLight()
                    onSortsChange(flipSort(sorts, sort.key))
                  }}
                  className="flex h-8 shrink-0 items-center gap-1 rounded-full bg-surface-hover px-3 text-[13px] font-medium text-text active:opacity-60"
                >
                  {ascending ? (
                    <ArrowUp aria-hidden className="size-3.5" />
                  ) : (
                    <ArrowDown aria-hidden className="size-3.5" />
                  )}
                  {ascending ? 'Ascending' : 'Descending'}
                </button>
              </RemovableRow>
            )
          })}
        </SettingsGroup>
      ) : null}
      {unsorted.length > 0 ? (
        <SettingsGroup
          header={sorts.length === 0 ? 'Sort by' : 'Then by'}
          footer={sorts.length === 0 ? 'Unsorted notes keep the most recently edited first.' : null}
        >
          {unsorted.map((field) => (
            <SettingsActionRow
              key={field.key}
              label={field.name}
              icon={Plus}
              onPress={() => {
                hapticImpactLight()
                onSortsChange(addSort(sorts, field.key))
              }}
            />
          ))}
        </SettingsGroup>
      ) : null}
    </>
  )
}

function GroupPage({ grouping }: MobileViewOptionsProps): ReactElement | null {
  if (grouping === null) {
    return null
  }
  const pick = (key: string | null): void => {
    hapticImpactLight()
    grouping.onChange(key)
  }
  return (
    <SettingsGroup
      header="Group by"
      footer={grouping.allowNone ? null : 'A board always groups its cards into lanes.'}
    >
      {grouping.allowNone ? (
        <SettingsSelectRow
          label="None"
          selected={grouping.selected === null}
          onPress={() => pick(null)}
        />
      ) : null}
      {grouping.properties.map((property) => (
        <SettingsSelectRow
          key={property.key}
          label={property.name}
          selected={grouping.selected?.key === property.key}
          onPress={() => pick(property.key)}
        />
      ))}
    </SettingsGroup>
  )
}

function FieldsPage({ type, hiddenFields, onToggleField }: MobileViewOptionsProps): ReactElement {
  return (
    <SettingsGroup header="Show" footer="The title always shows.">
      {type.properties.map((property) => (
        <SettingsSwitchRow
          key={property.key}
          label={property.name}
          checked={!hiddenFields.has(property.key)}
          onCheckedChange={() => {
            hapticImpactLight()
            onToggleField(property.key)
          }}
        />
      ))}
    </SettingsGroup>
  )
}

/** A list row with a trailing remove control (and room for one more). */
function RemovableRow({
  label,
  removeLabel,
  onRemove,
  children,
}: {
  label: string
  removeLabel: string
  onRemove: () => void
  children?: ReactNode
}): ReactElement {
  return (
    <div className="flex min-h-11 w-full items-center gap-2 py-1.5 pr-1.5 pl-4 text-[15px]">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {children}
      <button
        type="button"
        aria-label={removeLabel}
        onClick={() => {
          hapticImpactLight()
          onRemove()
        }}
        className={cn(
          'flex size-9 shrink-0 items-center justify-center rounded-full text-text-muted active:bg-surface-hover',
        )}
      >
        <Close aria-hidden className="size-4" />
      </button>
    </div>
  )
}

/** An equality pick: the option's color dot (as on its chip), its name, a check when on. */
function ValueRow({
  label,
  dot,
  selected,
  onPress,
}: {
  label: string
  dot: string | null
  selected: boolean
  onPress: () => void
}): ReactElement {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPress}
      className="flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left text-[15px] transition-colors active:bg-secondary/70"
    >
      {dot !== null ? (
        <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot)} />
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check aria-hidden className="size-4 shrink-0 text-primary" /> : null}
    </button>
  )
}
