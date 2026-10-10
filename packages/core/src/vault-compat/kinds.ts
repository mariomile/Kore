/**
 * What an Obsidian vault can hold that Kore does not render yet. The one list
 * the compatibility report is built from: detection ({@link detectCompatFindings})
 * only reports kinds named here, and the report keeps this order. When Kore
 * learns to render one (a `.canvas` view, say), deleting its entry drops it
 * from the report everywhere.
 *
 * Bases (`.base`) are deliberately absent: Kore renders them.
 */
export const COMPAT_KINDS = [
  {
    id: 'dataview',
    label: 'Dataview queries',
    hint: 'Shown as code. Obsidian Bases (.base) are the query format Kore renders.',
  },
  {
    id: 'templater',
    label: 'Templater commands',
    hint: 'Left as plain text: Kore does not run <% %> commands.',
  },
  {
    id: 'admonition',
    label: 'Admonition blocks',
    hint: 'Shown as code. Obsidian callouts (> [!note]) render in Kore.',
  },
  {
    id: 'mermaid',
    label: 'Unsupported Mermaid diagrams',
    hint: 'Flowcharts, sequence, class, state, ER and XY charts draw; other diagram types show an error.',
  },
  {
    id: 'canvas',
    label: 'Canvas links',
    hint: 'Links and embeds of .canvas files do not open in Kore.',
  },
  {
    id: 'excalidraw',
    label: 'Excalidraw drawings',
    hint: 'Drawings show as their raw data instead of a picture.',
  },
] as const satisfies readonly CompatKindEntry[]

/** One entry of {@link COMPAT_KINDS}. */
export interface CompatKindEntry {
  readonly id: string
  /** Short plural name, as the report's row heading. */
  readonly label: string
  /** One line on what the user sees in Kore instead, and any alternative. */
  readonly hint: string
}

/** Identifier of one {@link COMPAT_KINDS} entry. */
export type CompatKindId = (typeof COMPAT_KINDS)[number]['id']

const KIND_IDS: ReadonlySet<string> = new Set(COMPAT_KINDS.map((kind) => kind.id))

/** Whether a kind is still on the unsupported list (see {@link COMPAT_KINDS}). */
export function isCompatKind(id: string): id is CompatKindId {
  return KIND_IDS.has(id)
}
