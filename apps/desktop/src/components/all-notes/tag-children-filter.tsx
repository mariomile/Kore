import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/**
 * The collection's "only #tag" filter (Plan 33 B2): a tag that other tags
 * build on lists their notes too, and this narrows it back to the tag's
 * own. Renders nothing when no tag builds on `tag`.
 */
export function TagChildrenFilter({
  tag,
  childTags,
  ownOnly,
  onOwnOnlyChange,
}: {
  tag: string
  childTags: readonly string[]
  ownOnly: boolean
  onOwnOnlyChange: (ownOnly: boolean) => void
}) {
  if (childTags.length === 0) {
    return null
  }
  const withChildren = `With ${childTags.map((child) => `#${child}`).join(', ')}`
  return (
    <Select
      value={ownOnly ? 'own' : 'all'}
      items={{ all: withChildren, own: `Only #${tag}` }}
      onValueChange={(value) => {
        if (value === 'own' || value === 'all') {
          onOwnOnlyChange(value === 'own')
        }
      }}
    >
      <SelectTrigger aria-label="Tags that build on this one" data-size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{withChildren}</SelectItem>
        <SelectItem value="own">Only #{tag}</SelectItem>
      </SelectContent>
    </Select>
  )
}
