/**
 * Notion-style grouping for meowdown's `/` menu. meowdown owns the popup and
 * a flat list of rows; Kore paints section headers, icons, and descriptions
 * onto that DOM so the menu reads as grouped without forking the editor.
 */

export type SlashGroupId =
  | 'basic'
  | 'lists'
  | 'media'
  | 'inline'
  | 'callouts'
  | 'collections'
  | 'templates'

interface SlashItemMeta {
  readonly group: SlashGroupId
  readonly icon: string
  readonly description: string
}

export const SLASH_GROUP_LABELS: Record<SlashGroupId, string> = {
  basic: 'Basic blocks',
  lists: 'Lists',
  media: 'Media',
  inline: 'Inline',
  callouts: 'Callouts',
  collections: 'Collections',
  templates: 'Templates',
}

const BUILTIN_ITEMS: Record<string, SlashItemMeta> = {
  Text: { group: 'basic', icon: 'T', description: 'Just start writing' },
  'Heading 1': { group: 'basic', icon: 'H1', description: 'Large section heading' },
  'Heading 2': { group: 'basic', icon: 'H2', description: 'Medium section heading' },
  'Heading 3': { group: 'basic', icon: 'H3', description: 'Small section heading' },
  'Heading 4': { group: 'basic', icon: 'H4', description: 'Smaller heading' },
  Blockquote: { group: 'basic', icon: '“', description: 'Capture a quote' },
  'Bullet list': { group: 'lists', icon: '•', description: 'Create a simple list' },
  'Ordered list': { group: 'lists', icon: '1.', description: 'Create a numbered list' },
  'Task list': { group: 'lists', icon: '+', description: 'Track tasks with circles' },
  'Checkbox list': { group: 'lists', icon: '☐', description: 'Track tasks with checkboxes' },
  'Code block': { group: 'media', icon: '</>', description: 'Capture a code snippet' },
  Math: { group: 'media', icon: 'Σ', description: 'Display a formula' },
  Table: { group: 'media', icon: '⊞', description: 'Add a table' },
  'Attach file': { group: 'media', icon: '📎', description: 'Upload a file' },
  'Embed a link': { group: 'media', icon: 'URL', description: 'Preview a URL' },
  'Embed HTML': { group: 'media', icon: '</>', description: 'Sandboxed HTML' },
  Now: { group: 'inline', icon: '⏱', description: 'Insert the current time' },
}

const CALLOUT_META: SlashItemMeta = {
  group: 'callouts',
  icon: '!',
  description: 'Highlighted callout',
}

const COLLECTION_META: SlashItemMeta = {
  group: 'collections',
  icon: '#',
  description: 'Live collection view',
}

const TEMPLATE_META: SlashItemMeta = {
  group: 'templates',
  icon: '▤',
  description: 'Insert a template',
}

/** Resolve the Notion-style group for a `/` row's visible label. */
export function metaForSlashLabel(label: string): SlashItemMeta | null {
  if (label === '' || label === 'No results') {
    return null
  }
  const builtin = BUILTIN_ITEMS[label]
  if (builtin !== undefined) {
    return builtin
  }
  if (label.startsWith('Collection:')) {
    return COLLECTION_META
  }
  if (label.startsWith('Callout:')) {
    return CALLOUT_META
  }
  return TEMPLATE_META
}

function optionLabel(option: HTMLElement): string {
  const labelled = option.querySelector('span')
  return (labelled?.textContent ?? option.textContent ?? '').trim()
}

interface PlannedHeader {
  readonly group: SlashGroupId
  readonly before: Element
}

function isSlashGroupId(value: string): value is SlashGroupId {
  return Object.hasOwn(SLASH_GROUP_LABELS, value)
}

function planHeaders(popup: Element): PlannedHeader[] {
  const headers: PlannedHeader[] = []
  let lastGroup: SlashGroupId | null = null
  for (const child of popup.children) {
    if (!(child instanceof HTMLElement)) {
      continue
    }
    if (child.hasAttribute('data-slash-group-header') || child.hasAttribute('hidden')) {
      continue
    }
    if (child.getAttribute('role') !== 'option') {
      continue
    }
    const group = child.dataset.slashGroup
    if (group === undefined || !isSlashGroupId(group) || group === lastGroup) {
      continue
    }
    lastGroup = group
    headers.push({ group, before: child })
  }
  return headers
}

function headersMatch(existing: Element[], planned: PlannedHeader[]): boolean {
  if (existing.length !== planned.length) {
    return false
  }
  return existing.every((node, index) => {
    const next = planned[index]
    return (
      next !== undefined &&
      node.getAttribute('data-slash-group-header') === next.group &&
      node.nextElementSibling === next.before
    )
  })
}

/**
 * Decorate a mounted slash popup: icon/description data attributes and one
 * section header ahead of each visible group.
 */
export function layoutSlashMenu(popup: Element): void {
  for (const option of popup.querySelectorAll('[role="option"]')) {
    if (!(option instanceof HTMLElement)) {
      continue
    }
    const meta = metaForSlashLabel(optionLabel(option))
    if (meta === null) {
      delete option.dataset.slashGroup
      delete option.dataset.slashIcon
      delete option.dataset.slashDesc
      continue
    }
    option.dataset.slashGroup = meta.group
    option.dataset.slashIcon = meta.icon
    option.dataset.slashDesc = meta.description
  }

  const planned = planHeaders(popup)
  const existing = [...popup.querySelectorAll('[data-slash-group-header]')]
  if (headersMatch(existing, planned)) {
    return
  }
  for (const node of existing) {
    node.remove()
  }
  for (const [index, header] of planned.entries()) {
    const node = document.createElement('div')
    node.setAttribute('data-slash-group-header', header.group)
    node.setAttribute('data-testid', 'slash-menu-group')
    node.setAttribute('aria-hidden', 'true')
    if (index === 0) {
      node.setAttribute('data-slash-group-first', '')
    }
    node.textContent = SLASH_GROUP_LABELS[header.group]
    header.before.before(node)
  }
}
