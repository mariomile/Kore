import { templatePath } from './paths'
import type { TagProperty } from '../tags/tag-type'

/**
 * Starter types for a company graph. Collections already render these; the
 * seed is markdown in the vault, not a new app surface.
 */

export const COMPANY_SEED_TAGS = ['decision', 'person', 'company', 'project', 'meeting'] as const
export type CompanySeedTag = (typeof COMPANY_SEED_TAGS)[number]

export interface CompanySeedType {
  readonly tag: CompanySeedTag
  readonly properties: readonly TagProperty[]
  readonly templatePath: string
  readonly templateBody: string
  readonly definitionBody: string
}

const STATUS_OPTIONS = ['proposed', 'decided', 'reversed'] as const

/** The typed tags + templates a company graph should carry. */
export function companySeedTypes(): readonly CompanySeedType[] {
  return [
    {
      tag: 'decision',
      templatePath: templatePath('decision'),
      definitionBody: 'A durable choice. Log one named note per decision — never a shared daily.',
      properties: [
        { name: 'Status', key: 'status', type: 'status', options: [...STATUS_OPTIONS] },
        { name: 'Date', key: 'decided', type: 'date' },
        { name: 'Project', key: 'project', type: 'relation' },
      ],
      templateBody: ['#', '', '- Type: #decision', '', 'What we decided:', '', 'Why:', ''].join(
        '\n',
      ),
    },
    {
      tag: 'person',
      templatePath: templatePath('person'),
      definitionBody: 'Someone the company talks to or works with.',
      properties: [
        { name: 'Company', key: 'company', type: 'relation' },
        { name: 'Email', key: 'email', type: 'email' },
      ],
      templateBody: ['#', '', '- Type: #person', '', 'Role:', ''].join('\n'),
    },
    {
      tag: 'company',
      templatePath: templatePath('company'),
      definitionBody: 'An organization — customer, partner, vendor, or ours.',
      properties: [{ name: 'Domain', key: 'domain', type: 'url' }],
      templateBody: ['#', '', '- Type: #company', ''].join('\n'),
    },
    {
      tag: 'project',
      templatePath: templatePath('project'),
      definitionBody: 'A body of work with an owner and a status.',
      properties: [
        { name: 'Status', key: 'status', type: 'status', options: ['active', 'paused', 'done'] },
        { name: 'Owner', key: 'owner', type: 'relation' },
      ],
      templateBody: ['#', '', '- Type: #project', '', 'Goal:', ''].join('\n'),
    },
    {
      tag: 'meeting',
      templatePath: templatePath('meeting'),
      definitionBody: 'A named meeting note. Attendees become #person notes.',
      properties: [
        { name: 'Date', key: 'date', type: 'date' },
        { name: 'Project', key: 'project', type: 'relation' },
      ],
      templateBody: ['#', '', '- Type: #meeting', '', 'Notes:', '', 'Decisions:', ''].join('\n'),
    },
  ]
}

/** Canned chat questions for a company graph. */
export const COMPANY_CHAT_PROMPTS: readonly { readonly label: string; readonly prompt: string }[] =
  [
    {
      label: 'What did we decide?',
      prompt:
        'What did we decide recently? Search #decision notes first, then meeting notes, and cite the notes you used.',
    },
    {
      label: 'Last time we talked to…',
      prompt:
        'Who have we talked to lately? Search #person and #meeting notes and summarize the last conversation with each person you find.',
    },
    {
      label: 'What’s the status?',
      prompt:
        'What is the status of our active work? Search #project and #decision notes and list each with its status and the note you drew on.',
    },
  ]
