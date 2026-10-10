/**
 * A deterministic vault shaped like a heavy Obsidian vault being moved into
 * Kore (`?seed=obsidian`): ~5,150 notes across PARA-ish folders, file names
 * with spaces, YAML frontmatter on nearly every note with nested block-list
 * tags and `up:`/`related:` wiki links, ~880 dailies under
 * `Journal/Daily/DD-MM-YYYY.md`, long imported reading notes and meeting
 * notes, image embeds, and the `.md` sidecars an attachments folder collects.
 * Counts and proportions mirror a real 5,116-note vault measured on
 * 2026-10-09, so indexing, list, search and graph costs show up at the scale
 * that vault hits. Same seed, same bytes.
 */

/** Knobs for the generated vault; the defaults are the profiling baseline. */
export interface ObsidianVaultOptions {
  dailies: number
  people: number
  companies: number
  concepts: number
  readings: number
  meetings: number
  projects: number
  outputs: number
  resources: number
  sidecars: number
}

export const OBSIDIAN_VAULT_DEFAULTS: ObsidianVaultOptions = {
  dailies: 878,
  people: 600,
  companies: 250,
  concepts: 1_400,
  readings: 500,
  meetings: 400,
  projects: 150,
  outputs: 300,
  resources: 300,
  sidecars: 347,
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

const WORDS = [
  'growth',
  'pricing',
  'retention',
  'voice',
  'agent',
  'funnel',
  'signal',
  'market',
  'loop',
  'onboarding',
  'latency',
  'model',
  'positioning',
  'narrative',
  'cohort',
  'activation',
  'churn',
  'discovery',
  'roadmap',
  'strategy',
  'founder',
  'capital',
  'leverage',
  'habit',
  'focus',
  'system',
  'workflow',
  'insight',
  'experiment',
  'distribution',
  'moat',
  'craft',
  'taste',
  'judgment',
  'clarity',
  'feedback',
  'velocity',
  'quality',
  'trust',
  'outcome',
]

const FIRST_NAMES = [
  'Ada',
  'Bruno',
  'Chiara',
  'Dario',
  'Elena',
  'Fabio',
  'Giulia',
  'Luca',
  'Marta',
  'Nico',
  'Paola',
  'Sara',
]
const LAST_NAMES = [
  'Rossi',
  'Bianchi',
  'Romano',
  'Colombo',
  'Ricci',
  'Marino',
  'Greco',
  'Bruno',
  'Gallo',
  'Conti',
]
const DOMAIN_TAGS = [
  'domain/product',
  'domain/growth',
  'domain/ai',
  'domain/startup',
  'domain/wealth',
  'domain/health',
  'domain/design',
  'domain/sales',
]

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

const SYLLABLES = [
  'ka',
  'lo',
  'mi',
  'ne',
  'ru',
  'sa',
  'ti',
  'vo',
  'ze',
  'bra',
  'cho',
  'dri',
  'fen',
  'gal',
  'han',
  'jor',
  'kel',
  'mar',
  'nor',
  'pel',
  'qua',
  'ros',
  'sen',
  'tor',
]

/**
 * A long-tailed vocabulary: the real words above are the frequent head, then
 * a few thousand made-up words, so a search term matches as many notes as a
 * term would in a real vault rather than all of them.
 */
const VOCABULARY = [
  ...WORDS,
  ...Array.from({ length: 6_000 }, (_, index) => {
    const parts = [index % 24, Math.floor(index / 24) % 24, Math.floor(index / 576) % 24]
    return parts.map((part) => SYLLABLES[part]).join('')
  }),
]

function word(random: () => number): string {
  return VOCABULARY[Math.floor(VOCABULARY.length * random() ** 3)] as string
}

function sentence(random: () => number, words: number): string {
  const text = Array.from({ length: words }, () => word(random)).join(' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function titleCase(text: string): string {
  return text.replaceAll(/\b\w/g, (first) => first.toUpperCase())
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** The vault: graph-relative path → markdown source. */
export function seedObsidianVaultFiles(
  options: ObsidianVaultOptions = OBSIDIAN_VAULT_DEFAULTS,
): Record<string, string> {
  const random = createRandom(0x0b5d1a17)
  const files: Record<string, string> = {}
  const attachments: string[] = Array.from(
    { length: 2_362 },
    (_, index) => `Pasted image ${20_240_000 + index}.png`,
  )

  const people = Array.from(
    { length: options.people },
    (_, index) =>
      `${FIRST_NAMES[index % FIRST_NAMES.length]} ${LAST_NAMES[Math.floor(index / FIRST_NAMES.length) % LAST_NAMES.length]} ${Math.floor(index / (FIRST_NAMES.length * LAST_NAMES.length)) + 1}`,
  )
  const companies = Array.from(
    { length: options.companies },
    (_, index) =>
      `${titleCase(pick(random, WORDS))} ${titleCase(pick(random, WORDS))} ${index + 1}`,
  )
  const concepts = Array.from(
    { length: options.concepts },
    (_, index) => `${titleCase(sentence(random, 3))} ${index + 1}`,
  )
  const projects = Array.from(
    { length: options.projects },
    (_, index) => `Project ${titleCase(sentence(random, 2))} ${index + 1}`,
  )
  const mocs = DOMAIN_TAGS.map((tag) => `${titleCase(tag.slice('domain/'.length))} MOC`)

  // A link the way the measured vault writes them: mostly bare titles, about
  // a fifth with an alias and a quarter with the folder path spelled out.
  function link(folder: string, title: string): string {
    const roll = random()
    if (roll < 0.19) {
      return `[[${title}|${pick(random, WORDS)}]]`
    }
    if (roll < 0.44) {
      return `[[${folder}/${title}]]`
    }
    return `[[${title}]]`
  }

  function anyLink(): string {
    const roll = random()
    if (roll < 0.45) {
      return link('Knowledge', pick(random, concepts))
    }
    if (roll < 0.7) {
      return link('CRM/People', pick(random, people))
    }
    if (roll < 0.85) {
      return link('CRM/Companies', pick(random, companies))
    }
    return link('Active', pick(random, projects))
  }

  function frontmatter(type: string, extra: string[] = []): string[] {
    const lines = ['---', 'tags:', `  - ${type}`, `  - ${pick(random, DOMAIN_TAGS)}`]
    if (random() < 0.4) {
      lines.push(`  - ${pick(random, DOMAIN_TAGS)}`)
    }
    if (random() < 0.5) {
      lines.push(`up: "[[${pick(random, mocs)}]]"`)
    }
    if (random() < 0.2) {
      lines.push('related:', `  - "${anyLink()}"`, `  - "${anyLink()}"`)
    }
    if (random() < 0.21) {
      lines.push(
        `created: 2025-${pad(1 + Math.floor(random() * 12))}-${pad(1 + Math.floor(random() * 28))}`,
      )
    }
    lines.push(...extra, '---')
    return lines
  }

  function paragraph(sentences: number, linkChance: number): string {
    return Array.from({ length: sentences }, () => {
      const body = sentence(random, 8 + Math.floor(random() * 10))
      return random() < linkChance ? `${body} ${anyLink()}.` : `${body}.`
    }).join(' ')
  }

  function body(paragraphs: number, linkChance: number): string[] {
    const lines: string[] = []
    for (let index = 0; index < paragraphs; index += 1) {
      if (index > 0 && index % 3 === 0) {
        lines.push(`## ${titleCase(sentence(random, 3))}`, '')
      }
      if (random() < 0.25) {
        lines.push(
          ...Array.from({ length: 3 + Math.floor(random() * 4) }, () =>
            `- ${sentence(random, 6)} ${random() < 0.3 ? anyLink() : ''}`.trimEnd(),
          ),
          '',
        )
      } else {
        lines.push(paragraph(2 + Math.floor(random() * 4), linkChance), '')
      }
      if (random() < 0.05) {
        lines.push(`![[${pick(random, attachments)}]]`, '')
      }
      if (random() < 0.1) {
        lines.push(
          `![${pick(random, WORDS)}](Resources/_attachments/${encodeURI(pick(random, attachments))})`,
          '',
        )
      }
    }
    return lines
  }

  for (const moc of mocs) {
    files[`Knowledge/MOC/${moc}.md`] = [
      ...frontmatter('type/moc'),
      `# ${moc}`,
      '',
      ...concepts.slice(0, 60).map((title) => `- [[${title}]]`),
      '',
    ].join('\n')
  }
  for (const [index, name] of people.entries()) {
    files[`CRM/People/${name}.md`] = [
      ...frontmatter('type/person', [
        `company: "[[${companies[index % companies.length]}]]"`,
        `email: person${index}@example.com`,
      ]),
      '',
      ...body(1 + Math.floor(random() * 3), 0.2),
    ].join('\n')
  }
  for (const name of companies) {
    files[`CRM/Companies/${name}.md`] = [
      ...frontmatter('type/company', ['stage: seed']),
      '',
      ...body(2 + Math.floor(random() * 3), 0.3),
    ].join('\n')
  }
  for (const title of concepts) {
    files[`Knowledge/${title}.md`] = [
      ...frontmatter(pick(random, ['type/concept', 'type/framework', 'type/note'])),
      `# ${title}`,
      '',
      ...body(2 + Math.floor(random() * 8), 0.25),
    ].join('\n')
  }
  for (let index = 0; index < options.readings; index += 1) {
    const title = `${titleCase(sentence(random, 5))} ${index + 1}`
    const highlights = 10 + Math.floor(random() * 40)
    files[`Input/Readwise/Articles/${title}.md`] = [
      ...frontmatter('type/reading', [`author: ${pick(random, people)}`, 'source: readwise']),
      `# ${title}`,
      '',
      '## Highlights',
      '',
      ...Array.from(
        { length: highlights },
        () =>
          `- ${paragraph(1 + Math.floor(random() * 3), 0.05)} ([Location ${Math.floor(random() * 9000)}](https://readwise.io/to_kindle?action=open))`,
      ),
      '',
    ].join('\n')
  }
  for (let index = 0; index < options.meetings; index += 1) {
    const title = `Meeting ${titleCase(sentence(random, 3))} ${index + 1}`
    files[`Input/Granola/${title}.md`] = [
      ...frontmatter('type/meeting', [
        `attendees:`,
        `  - "[[${pick(random, people)}]]"`,
        `  - "[[${pick(random, people)}]]"`,
        'granola_id: g' + index,
      ]),
      `# ${title}`,
      '',
      '## Summary',
      '',
      ...body(3 + Math.floor(random() * 6), 0.3),
      '## Action items',
      '',
      ...Array.from({ length: 2 + Math.floor(random() * 5) }, () =>
        `- [ ] ${sentence(random, 7)} ${random() < 0.5 ? anyLink() : ''}`.trimEnd(),
      ),
      '',
    ].join('\n')
  }
  for (const title of projects) {
    files[`Active/${title}.md`] = [
      ...frontmatter('type/project', ['status: active']),
      `# ${title}`,
      '',
      ...body(3 + Math.floor(random() * 6), 0.35),
      ...Array.from(
        { length: 3 + Math.floor(random() * 8) },
        () => `- [${random() < 0.4 ? 'x' : ' '}] ${sentence(random, 6)}`,
      ),
      '',
    ].join('\n')
  }
  for (let index = 0; index < options.outputs; index += 1) {
    const title = `${titleCase(sentence(random, 4))} draft ${index + 1}`
    files[`Output/${title}.md`] = [
      ...frontmatter('type/note'),
      `# ${title}`,
      '',
      ...body(4 + Math.floor(random() * 12), 0.2),
    ].join('\n')
  }
  for (let index = 0; index < options.resources; index += 1) {
    const title = `${titleCase(sentence(random, 3))} resource ${index + 1}`
    files[`Resources/${title}.md`] = [
      ...frontmatter('type/note'),
      '',
      ...body(1 + Math.floor(random() * 4), 0.15),
    ].join('\n')
  }
  for (let index = 0; index < options.sidecars; index += 1) {
    files[`Resources/_attachments/${attachments[index]}.md`] = [
      '---',
      'source: image',
      `ocr: ${sentence(random, 10)}`,
      '---',
      '',
    ].join('\n')
  }
  for (let index = 0; index < 30; index += 1) {
    files[`_system/memory/${titleCase(sentence(random, 2))} ${index + 1}.md`] = [
      '---',
      'created_by: cowork',
      '---',
      '',
      ...body(2, 0),
    ].join('\n')
  }
  // Dailies: one per day ending 2026-10-09, newest densest (meeting links,
  // tasks, a Granola block), as the measured vault's last weeks are.
  const end = Date.UTC(2026, 9, 9)
  for (let index = 0; index < options.dailies; index += 1) {
    const date = new Date(end - index * 86_400_000)
    const name = `${pad(date.getUTCDate())}-${pad(date.getUTCMonth() + 1)}-${date.getUTCFullYear()}`
    files[`Journal/Daily/${name}.md`] = [
      '---',
      'tags:',
      '  - type/daily',
      `date: ${date.toISOString().slice(0, 10)}`,
      '---',
      '',
      '## Focus',
      '',
      ...Array.from({ length: 2 + Math.floor(random() * 4) }, () =>
        `- [${random() < 0.5 ? 'x' : ' '}] ${sentence(random, 6)} ${random() < 0.4 ? anyLink() : ''}`.trimEnd(),
      ),
      '',
      '## Log',
      '',
      ...body(1 + Math.floor(random() * 4), 0.35),
    ].join('\n')
  }
  files['.obsidian/app.json'] = JSON.stringify({ attachmentFolderPath: 'Resources/_attachments' })
  // Plugin syntax the compatibility report lists (added last, so the random
  // stream above, and every byte it produced, is unchanged).
  files['_system/templates/Meeting.md'] = [
    '---',
    'created: <% tp.date.now("YYYY-MM-DD") %>',
    '---',
    '# <% tp.file.title %>',
    '',
  ].join('\n')
  files['Active/Roadmap.md'] = [
    '# Roadmap',
    '',
    '```dataview',
    'TABLE status FROM "Active"',
    '```',
    '',
    '```mermaid',
    'gantt',
    '  title Q4',
    '```',
    '',
    '```ad-warning',
    'Dates move.',
    '```',
    '',
    'Planning board: ![[Roadmap.canvas]]',
    '',
  ].join('\n')
  return files
}
