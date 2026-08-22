#!/usr/bin/env node
/**
 * Generates `src/components/icons/solar-icons.gen.tsx` from the Solar icon set.
 *
 * Solar ships as raw SVG bodies in `@iconify-json/solar`. Rather than pull an
 * icon framework into the runtime, this bakes the handful of glyphs the app
 * actually uses into plain React components at author time: no runtime lookup,
 * no network, and the SVG paths land in review like any other source.
 *
 * The shared presentation attributes (`fill="none"`, `stroke="currentColor"`,
 * `stroke-width="1.5"`) are hoisted out of the body and onto the `<svg>` root
 * by `createIcon`, so a call site passing `strokeWidth` or `fill` overrides the
 * whole glyph instead of fighting a nested `<g>`.
 *
 * Usage: `node scripts/generate-icons.mjs`
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { SOLAR_ICONS } from './icon-manifest.mjs'

const require = createRequire(import.meta.url)
const scriptDir = import.meta.dirname
const outputPath = join(scriptDir, '../src/components/icons/solar-icons.gen.tsx')

/** Attributes hoisted onto the `<svg>` root by `createIcon`. */
const HOISTED_ATTRIBUTES = new Map([
  ['fill', 'none'],
  ['stroke', 'currentColor'],
  ['stroke-width', '1.5'],
])

const SVG_ATTRIBUTE_NAMES = new Map([
  ['stroke-width', 'strokeWidth'],
  ['stroke-linecap', 'strokeLinecap'],
  ['stroke-linejoin', 'strokeLinejoin'],
  ['stroke-miterlimit', 'strokeMiterlimit'],
  ['stroke-dasharray', 'strokeDasharray'],
  ['stroke-dashoffset', 'strokeDashoffset'],
  ['fill-rule', 'fillRule'],
  ['clip-rule', 'clipRule'],
  ['fill-opacity', 'fillOpacity'],
  ['stroke-opacity', 'strokeOpacity'],
])

/**
 * Resolves an icon id through the icon set's alias table.
 *
 * @param {{icons: Record<string, {body: string}>, aliases?: Record<string, {parent: string}>}} iconSet
 * @param {string} iconId
 * @returns {{body: string}}
 */
function resolveIcon(iconSet, iconId) {
  const direct = iconSet.icons[iconId]
  if (direct) {
    return direct
  }
  const alias = iconSet.aliases?.[iconId]
  const parent = alias ? iconSet.icons[alias.parent] : undefined
  if (!parent) {
    throw new Error(`Unknown Solar icon: ${iconId}`)
  }
  return parent
}

/**
 * Rewrites one SVG element's attribute list into JSX, dropping the attributes
 * `createIcon` sets on the root and camel-casing the rest.
 *
 * @param {string} attributes
 * @returns {string}
 */
function rewriteAttributes(attributes) {
  const rewritten = []
  const pattern = /([\w:-]+)="([^"]*)"/g
  let match = pattern.exec(attributes)
  while (match !== null) {
    const [, name, value] = match
    if (HOISTED_ATTRIBUTES.get(name) !== value) {
      rewritten.push(`${SVG_ATTRIBUTE_NAMES.get(name) ?? name}="${value}"`)
    }
    match = pattern.exec(attributes)
  }
  return rewritten.join(' ')
}

/**
 * Converts a Solar SVG body into JSX children, unwrapping the grouping `<g>`
 * once every attribute it carried has been hoisted to the root.
 *
 * @param {string} body
 * @returns {string}
 */
function bodyToJsx(body) {
  const unwrapped = body.replace(/^<g([^>]*)>(.*)<\/g>$/s, (whole, attributes, children) => {
    return rewriteAttributes(attributes) === '' ? children : whole
  })
  const jsx = unwrapped.replaceAll(/<([\w:-]+)([^>]*?)\s*\/>/g, (_whole, tag, attributes) => {
    const rewritten = rewriteAttributes(attributes)
    return rewritten === '' ? `<${tag} />` : `<${tag} ${rewritten} />`
  })
  return jsx.replaceAll(/<g([^>]*)>/g, (_whole, attributes) => {
    const rewritten = rewriteAttributes(attributes)
    return rewritten === '' ? '<g>' : `<g ${rewritten}>`
  })
}

/**
 * Splits a JSX string into its top-level sibling elements.
 *
 * @param {string} jsx
 * @returns {string[]}
 */
function splitElements(jsx) {
  const elements = []
  let depth = 0
  let start = 0
  for (const tag of jsx.matchAll(/<\/?[\w:-]+[^>]*?(\/?)>/g)) {
    const [text] = tag
    if (text.startsWith('</')) {
      depth -= 1
    } else if (tag[1] !== '/') {
      depth += 1
    }
    if (depth === 0) {
      elements.push(jsx.slice(start, tag.index + text.length))
      start = tag.index + text.length
    }
  }
  return elements
}

/**
 * Lays a glyph body out with one element per line, so the generated file stays
 * readable (and reviewable) rather than one very long line per icon.
 *
 * @param {string} jsx
 * @param {string} indent
 * @returns {string}
 */
function formatChildren(jsx, indent = '  ') {
  const elements = splitElements(jsx)
  if (elements.length > 1) {
    const inner = elements.map((element) => formatChildren(element, `${indent}  `))
    return `<>\n${indent}  ${inner.join(`\n${indent}  `)}\n${indent}</>`
  }
  // A lone wrapping <g> kept an attribute the root could not absorb; its own
  // children still deserve a line each.
  const group = /^<g([^>]*)>(.*)<\/g>$/s.exec(jsx)
  if (group === null) {
    return jsx
  }
  const inner = splitElements(group[2]).map((element) => formatChildren(element, `${indent}  `))
  return `<g${group[1]}>\n${indent}  ${inner.join(`\n${indent}  `)}\n${indent}</g>`
}

const iconSet = require('@iconify-json/solar/icons.json')
if (iconSet.width !== 24 || iconSet.height !== 24) {
  throw new Error(`Expected a 24×24 Solar grid, got ${iconSet.width}×${iconSet.height}`)
}

const foreignFamily = Object.entries(SOLAR_ICONS).filter(
  ([, iconId]) => !iconId.endsWith('-linear'),
)
if (foreignFamily.length > 0) {
  const names = foreignFamily.map(([name, iconId]) => `${name} (${iconId})`).join(', ')
  throw new Error(`Only Solar's -linear family is in the set; drop or repoint: ${names}`)
}

const components = Object.entries(SOLAR_ICONS)
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([componentName, iconId]) => {
    const { body } = resolveIcon(iconSet, iconId)
    return [
      `/** Solar \`${iconId}\`. */`,
      `export const ${componentName}: Icon = createIcon(`,
      `  '${componentName}',`,
      `  ${formatChildren(bodyToJsx(body))},`,
      `)`,
    ].join('\n')
  })

const solarVersion = require('@iconify-json/solar/package.json').version
const file = [
  '// Generated by scripts/generate-icons.mjs — do not edit by hand.',
  `// Source: @iconify-json/solar@${solarVersion} (Solar icon set, CC BY 4.0).`,
  `// Add or repoint an icon in scripts/icon-manifest.mjs, then re-run the script.`,
  '',
  `import { createIcon, type Icon } from './create-icon'`,
  '',
  components.join('\n\n'),
  '',
].join('\n')

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, file)
console.log(`Wrote ${components.length} icons to ${outputPath}`)
