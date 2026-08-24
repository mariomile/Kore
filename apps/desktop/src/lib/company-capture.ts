import {
  createNoteWithTitle,
  getTagType,
  type GraphRole,
  type TagType,
  type TemplatePlaceholderValues,
} from '@reflect/core'
import { createTypedCollectionNote } from '@/lib/tags/create-collection-note'
import { ensureCompanyGraphSeed } from '@/lib/company-graph-seed'
import { todayIso } from '@/lib/dates'

export type CompanyCaptureKind = 'decision' | 'person' | 'company' | 'project' | 'meeting'

const DEFAULT_TITLES: Record<CompanyCaptureKind, string> = {
  decision: 'Decision',
  person: 'Person',
  company: 'Company',
  project: 'Project',
  meeting: 'Meeting',
}

function captureProperties(kind: CompanyCaptureKind): Record<string, unknown> {
  if (kind === 'decision') {
    return { status: 'proposed', decided: todayIso() }
  }
  if (kind === 'meeting') {
    return { date: todayIso() }
  }
  return {}
}

function captureTemplateValues(title: string): TemplatePlaceholderValues {
  const iso = todayIso()
  return { title, date: iso, dateIso: iso, time: '' }
}

/**
 * Birth a named company-brain note (decision / person / …). Seeds the
 * company types when they are missing, then uses the type's template.
 */
export async function logCompanyCapture(
  kind: CompanyCaptureKind,
  generation: number,
  title?: string,
  extraBody?: string,
): Promise<string> {
  await ensureCompanyGraphSeed(generation)
  const type: TagType | null = await getTagType(kind)
  const properties = captureProperties(kind)
  const heading = title?.trim() ?? ''
  const suffix = extraBody === undefined || extraBody.trim() === '' ? '' : `\n\n${extraBody.trim()}`
  if (heading === '') {
    return await createTypedCollectionNote(
      kind,
      generation,
      properties,
      type,
      captureTemplateValues(DEFAULT_TITLES[kind]),
    )
  }
  return await createNoteWithTitle(heading, generation, `- Type: #${kind}${suffix}`)
}

/** Command titles for the palette. */
export const COMPANY_CAPTURE_COMMANDS: readonly {
  readonly kind: CompanyCaptureKind
  readonly id: string
  readonly title: string
  readonly keywords: readonly string[]
}[] = [
  {
    kind: 'decision',
    id: 'capture.logDecision',
    title: 'Log a decision',
    keywords: ['decision', 'company', 'brain', 'capture'],
  },
  {
    kind: 'meeting',
    id: 'capture.logMeeting',
    title: 'Log a meeting',
    keywords: ['meeting', 'calendar', 'company', 'capture'],
  },
  {
    kind: 'person',
    id: 'capture.logPerson',
    title: 'Log a person',
    keywords: ['person', 'contact', 'company', 'crm'],
  },
  {
    kind: 'company',
    id: 'capture.logCompany',
    title: 'Log a company',
    keywords: ['company', 'org', 'crm'],
  },
]

const COMPANY_CAPTURE_COMMAND_IDS = new Set(
  COMPANY_CAPTURE_COMMANDS.map((command) => command.id),
)

/** Palette / keymap ids that belong only on a company graph. */
export function isCompanyCaptureCommand(id: string): boolean {
  return COMPANY_CAPTURE_COMMAND_IDS.has(id)
}

/**
 * Company capture commands stay off the default personal notebook. Unmarked
 * graphs are personal — one person, today's note, no extra destinations.
 */
export function commandsForGraphRole<T extends { readonly id: string }>(
  commands: readonly T[],
  role: GraphRole | null,
): T[] {
  if (role === 'company') {
    return [...commands]
  }
  return commands.filter((command) => !isCompanyCaptureCommand(command.id))
}
