/**
 * A small vault where pictures matter (`?seed=visual`): notes with a
 * `cover:`, notes whose first image sits in the body, and text-only notes
 * beside them, so the note grid's picture cards can be checked in a plain
 * browser. The images are painted on a canvas at boot (no binary fixtures in
 * the repo) and served by the dev bridge like attachments written this
 * session.
 */

/** The seeded notes plus the images they reference, base64 by vault path. */
export interface VisualVaultSeed {
  files: Record<string, string>
  assets: Map<string, string>
}

interface Painting {
  readonly path: string
  readonly width: number
  readonly height: number
  readonly colors: readonly [string, string, string]
}

const PAINTINGS: readonly Painting[] = [
  {
    path: 'assets/barn-south.png',
    width: 1600,
    height: 1000,
    colors: ['#1d3f8f', '#2f57b5', '#eaf1ff'],
  },
  {
    path: 'assets/moodboard.png',
    width: 1200,
    height: 1500,
    colors: ['#ead9c4', '#c8613f', '#2f4858'],
  },
  {
    path: 'assets/brand-gradient.png',
    width: 1600,
    height: 900,
    colors: ['#ff8a3d', '#b14dff', '#4f46e5'],
  },
  {
    path: 'Inspiration/chair.png',
    width: 1000,
    height: 1200,
    colors: ['#dfe5d8', '#d9763d', '#2c3a2e'],
  },
  {
    path: 'Inspiration/dunes.png',
    width: 1500,
    height: 1000,
    colors: ['#f9e2c2', '#f26b4e', '#234a52'],
  },
]

function paint({ width, height, colors: [ground, accent, ink] }: Painting): string {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (context === null) {
    return ''
  }
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, ground)
  gradient.addColorStop(1, accent)
  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  context.fillStyle = ink
  context.beginPath()
  context.arc(width * 0.72, height * 0.32, Math.min(width, height) * 0.16, 0, Math.PI * 2)
  context.fill()
  context.globalAlpha = 0.85
  context.fillRect(0, height * 0.72, width, height * 0.28)
  return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length)
}

/** Build the vault; needs a DOM (it paints its images on a canvas). */
export function seedVisualVault(): VisualVaultSeed {
  const assets = new Map(PAINTINGS.map((painting) => [painting.path, paint(painting)]))
  const files: Record<string, string> = {
    'notes/Kore brand directions.md': [
      '---',
      'cover: assets/brand-gradient.png',
      'tags: [brand]',
      '---',
      '# Kore brand directions',
      '',
      'Three routes for the identity. The warm one feels most like a studio wall.',
      '',
      '- Warm, tactile, personal',
      '- Quiet, enduring, functional',
    ].join('\n'),
    'notes/Barn build 2026.md': [
      '# Barn build 2026',
      '',
      'South elevation approved. Measure the doors again before trusting the drawing.',
      '',
      '![South elevation](../assets/barn-south.png)',
      '',
      '+ [ ] Order the timber',
      '+ [x] Get the permit',
    ].join('\n'),
    'notes/Moodboard.md': [
      '# Moodboard',
      '',
      '![[assets/moodboard.png]]',
      '',
      'Arches, terracotta, a single dark sun. Keep the palette to three colors.',
    ].join('\n'),
    'Inspiration/Chairs worth copying.md': [
      '# Chairs worth copying',
      '',
      '![[Inspiration/chair.png]]',
      '',
      'Bent steel legs, a shell seat, nothing else.',
    ].join('\n'),
    'Inspiration/Desert light.md': [
      '---',
      'cover: "[[Inspiration/dunes.png]]"',
      '---',
      '# Desert light',
      '',
      'Late afternoon, long shadows. The orange only works next to the deep teal.',
    ].join('\n'),
    'notes/Quarterly Goals.md': [
      '# Quarterly Goals',
      '',
      '+ [ ] Mobile app in TestFlight',
      '+ [ ] 1k beta signups',
      '+ [x] Open-source the core',
    ].join('\n'),
    'notes/Atomic Habits.md': [
      '# Atomic Habits',
      '',
      'Systems over goals. Make it obvious, attractive, easy, satisfying.',
      '',
      '#book',
    ].join('\n'),
    'notes/Long essay.md': [
      '# Long essay',
      '',
      ...Array.from(
        { length: 12 },
        (_, index) =>
          `Paragraph ${index + 1}. A note with a lot of text shows only its opening lines on a card and ends on a whole line, never halfway through one, however long the note runs.\n`,
      ),
    ].join('\n'),
  }
  return { files, assets }
}
