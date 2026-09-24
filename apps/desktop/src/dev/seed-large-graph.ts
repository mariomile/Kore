/**
 * A large, deterministic vault for profiling the dev bridge (`?seed=large`):
 * two years of daily notes — today's one long — a few thousand people,
 * companies, books, projects and meetings woven together with `[[links]]`,
 * `#tags`, tasks and typed frontmatter, plus the four supertag definitions
 * whose collections those notes fill. Sized like a heavy real vault so
 * editor, sidebar, collection and search costs show up at the scale users
 * actually hit. Same seed, same bytes: numbers stay comparable across runs.
 */

/** Knobs for the generated vault; the defaults are the profiling baseline. */
export interface LargeGraphOptions {
  /** Past daily notes, one per day ending today. */
  dailyDays: number
  /** Blocks in today's daily note — the long note typing and scrolling hit. */
  todayBlocks: number
  people: number
  companies: number
  books: number
  projects: number
  meetings: number
}

export const LARGE_GRAPH_DEFAULTS: LargeGraphOptions = {
  dailyDays: 730,
  todayBlocks: 400,
  people: 900,
  companies: 300,
  books: 400,
  projects: 150,
  meetings: 900,
}

/** Mulberry32: tiny, fast, and the same sequence for the same seed. */
function createRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4_294_967_296
  }
}

const FIRST_NAMES = [
  'Ada',
  'Bruno',
  'Chiara',
  'Dario',
  'Elena',
  'Fabio',
  'Giulia',
  'Hugo',
  'Irene',
  'Jonas',
  'Kira',
  'Luca',
  'Marta',
  'Nico',
  'Olga',
  'Paolo',
  'Quinn',
  'Rosa',
  'Sara',
  'Tomas',
  'Ugo',
  'Vera',
  'Walter',
  'Xenia',
  'Yuri',
  'Zoe',
]
const LAST_NAMES = [
  'Rossi',
  'Bianchi',
  'Chen',
  'Dubois',
  'Esposito',
  'Fischer',
  'Garcia',
  'Hansen',
  'Ito',
  'Jensen',
  'Kowalski',
  'Lopez',
  'Moretti',
  'Novak',
  'Olsen',
  'Park',
  'Ricci',
  'Silva',
  'Tanaka',
  'Weber',
]
const WORDS = [
  'roadmap',
  'launch',
  'pricing',
  'onboarding',
  'sync',
  'offline',
  'editor',
  'search',
  'latency',
  'retention',
  'budget',
  'hiring',
  'design',
  'review',
  'contract',
  'renewal',
  'migration',
  'backlog',
  'research',
  'interview',
  'workshop',
  'strategy',
  'metrics',
  'feedback',
  'prototype',
  'release',
  'partnership',
  'invoice',
  'travel',
  'offsite',
  'keynote',
  'podcast',
  'draft',
  'outline',
  'quarterly',
  'planning',
  'mobile',
  'desktop',
]
const INLINE_TAGS = ['idea', 'followup', 'question', 'insight', 'quote', 'decision', 'health']
const STATUSES = ['Planned', 'Active', 'On hold', 'Done']
const PRIORITIES = ['High', 'Medium', 'Low']

function pick<Item>(random: () => number, items: readonly Item[]): Item {
  return items[Math.floor(random() * items.length)] as Item
}

function isoDay(offsetDays: number): string {
  const date = new Date()
  date.setDate(date.getDate() - offsetDays)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

function ulid(index: number): string {
  return `01perf${index.toString(32).padStart(20, '0')}`
}

function sentence(random: () => number, words: number): string {
  const parts: string[] = []
  for (let position = 0; position < words; position++) {
    parts.push(pick(random, WORDS))
  }
  const text = parts.join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

interface SeedProperty {
  name: string
  key: string
  type: string
  options?: readonly string[]
}

function tagDefinition(tag: string, properties: readonly SeedProperty[]): string {
  return [
    '---',
    'lore: tag',
    'properties:',
    ...properties.flatMap((property) => [
      `  - name: ${property.name}`,
      `    key: ${property.key}`,
      `    type: ${property.type}`,
      ...(property.options === undefined
        ? []
        : ['    options:', ...property.options.map((option) => `      - ${option}`)]),
    ]),
    '---',
    `# ${tag.charAt(0).toUpperCase()}${tag.slice(1)}`,
    '',
    `Every note tagged #${tag}.`,
    '',
  ].join('\n')
}

/** The large profiling vault: graph-relative path → markdown source. */
export function seedLargeGraphFiles(
  options: LargeGraphOptions = LARGE_GRAPH_DEFAULTS,
): Record<string, string> {
  const random = createRandom(0x6b6f7265)
  const files: Record<string, string> = {}
  let idCounter = 0

  const people = Array.from(
    { length: options.people },
    (_, index) =>
      `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]} ${Math.floor(index / (FIRST_NAMES.length * LAST_NAMES.length)) + 1}`,
  )
  const companies = Array.from(
    { length: options.companies },
    (_, index) => `${pick(random, WORDS)} ${pick(random, WORDS)} Labs ${index + 1}`,
  ).map((name) => name.charAt(0).toUpperCase() + name.slice(1))
  const books = Array.from(
    { length: options.books },
    (_, index) => `The ${pick(random, WORDS)} of ${pick(random, WORDS)} ${index + 1}`,
  )
  const projects = Array.from({ length: options.projects }, (_, index) =>
    `Project ${pick(random, WORDS)} ${pick(random, WORDS)} ${index + 1}`.replace(/^\w/, (first) =>
      first.toUpperCase(),
    ),
  )
  const allTitles = [...people, ...companies, ...books, ...projects]

  files['tags/person.md'] = tagDefinition('person', [
    { name: 'Email', key: 'email', type: 'email' },
    { name: 'Company', key: 'company', type: 'relation' },
    { name: 'Phone', key: 'phone', type: 'text' },
  ])
  files['tags/company.md'] = tagDefinition('company', [
    { name: 'Website', key: 'website', type: 'url' },
    { name: 'Industry', key: 'industry', type: 'text' },
  ])
  files['tags/book.md'] = tagDefinition('book', [
    { name: 'Author', key: 'author', type: 'relation' },
    { name: 'Rating', key: 'rating', type: 'rating' },
    { name: 'Status', key: 'status', type: 'status', options: STATUSES },
  ])
  files['tags/project.md'] = tagDefinition('project', [
    { name: 'Status', key: 'status', type: 'status', options: STATUSES },
    { name: 'Due', key: 'due', type: 'date' },
    { name: 'Priority', key: 'priority', type: 'select', options: PRIORITIES },
  ])

  for (const [index, name] of people.entries()) {
    const company = companies[index % companies.length] as string
    files[`notes/${slug(name)}.md`] = [
      '---',
      `id: ${ulid(idCounter++)}`,
      `email: ${slug(name)}@example.com`,
      `company: "[[${company}]]"`,
      `phone: +39 02 ${String(1_000_000 + index).slice(1)}`,
      '---',
      `# ${name}`,
      '',
      `#person at [[${company}]]. ${sentence(random, 12)}.`,
      '',
      `- Met through [[${pick(random, people)}]]`,
      `- Working on [[${pick(random, projects)}]]`,
      `- ${sentence(random, 10)} #${pick(random, INLINE_TAGS)}`,
      '',
    ].join('\n')
  }
  for (const [index, name] of companies.entries()) {
    files[`notes/${slug(name)}.md`] = [
      '---',
      `id: ${ulid(idCounter++)}`,
      `website: https://example.com/${slug(name)}`,
      `industry: ${pick(random, WORDS)}`,
      '---',
      `# ${name}`,
      '',
      `#company. ${sentence(random, 14)}.`,
      '',
      `- Contact: [[${people[index % people.length]}]]`,
      `- ${sentence(random, 12)}`,
      '',
    ].join('\n')
  }
  for (const [index, title] of books.entries()) {
    files[`notes/${slug(title)}.md`] = [
      '---',
      `id: ${ulid(idCounter++)}`,
      `author: "[[${people[(index * 7) % people.length]}]]"`,
      `rating: ${1 + (index % 5)}`,
      `status: ${pick(random, STATUSES)}`,
      '---',
      `# ${title}`,
      '',
      `#book recommended by [[${pick(random, people)}]].`,
      '',
      ...Array.from({ length: 6 }, () => `- ${sentence(random, 14)}`),
      '',
    ].join('\n')
  }
  for (const [index, title] of projects.entries()) {
    files[`notes/${slug(title)}.md`] = [
      '---',
      `id: ${ulid(idCounter++)}`,
      `status: ${pick(random, STATUSES)}`,
      `due: ${isoDay(-(index % 90))}`,
      `priority: ${pick(random, PRIORITIES)}`,
      '---',
      `# ${title}`,
      '',
      `#project owned by [[${pick(random, people)}]] with [[${pick(random, companies)}]].`,
      '',
      '## Goals',
      '',
      ...Array.from({ length: 5 }, () => `- ${sentence(random, 12)}`),
      '',
      '## Tasks',
      '',
      ...Array.from(
        { length: 8 },
        (_, task) => `+ [${task % 3 === 0 ? 'x' : ' '}] ${sentence(random, 7)}`,
      ),
      '',
    ].join('\n')
  }
  for (let index = 0; index < options.meetings; index++) {
    const title = `Meeting ${sentence(random, 3)} ${index + 1}`
    files[`notes/${slug(title)}.md`] = [
      '---',
      `id: ${ulid(idCounter++)}`,
      `date: ${isoDay(index % options.dailyDays)}`,
      '---',
      `# ${title}`,
      '',
      `#meeting with [[${pick(random, people)}]] and [[${pick(random, people)}]] on [[${pick(random, projects)}]].`,
      '',
      ...Array.from({ length: 10 }, () => `- ${sentence(random, 12)}`),
      `+ [ ] ${sentence(random, 6)} [[${pick(random, people)}]]`,
      '',
    ].join('\n')
  }

  for (let offset = 0; offset < options.dailyDays; offset++) {
    const blocks = offset === 0 ? options.todayBlocks : 12 + Math.floor(random() * 50)
    files[`daily/${isoDay(offset)}.md`] = dailyBody(random, blocks, allTitles)
  }

  return files
}

/** A daily note's blocks: bullets, tasks, sub-bullets, headings, quotes, code. */
function dailyBody(random: () => number, blocks: number, titles: readonly string[]): string {
  const lines: string[] = []
  for (let block = 0; block < blocks; block++) {
    const roll = random()
    const link = `[[${pick(random, titles)}]]`
    if (block % 40 === 0) {
      lines.push('', `## ${sentence(random, 3)}`, '')
    } else if (roll < 0.2) {
      lines.push(`+ [${random() < 0.4 ? 'x' : ' '}] ${sentence(random, 8)} ${link}`)
    } else if (roll < 0.3) {
      lines.push(`  - ${sentence(random, 10)} #${pick(random, INLINE_TAGS)}`)
    } else if (roll < 0.33) {
      lines.push('', `> ${sentence(random, 18)}`, '')
    } else if (roll < 0.34) {
      lines.push('', '```ts', `const ${pick(random, WORDS)} = ${block}`, '```', '')
    } else {
      lines.push(`- ${sentence(random, 6 + Math.floor(random() * 18))} ${link}`)
    }
  }
  return `${lines.join('\n')}\n`
}
