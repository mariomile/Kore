#!/usr/bin/env node
// Keeps the upstream "reflect" name from creeping back in.
//
// Kore forked Reflect; every name a user or contributor sees is Kore. What is
// left on purpose: on-disk data that needs a migration (`.reflect/`,
// `.reflectignore`, the `reflect-open` app-data folder), references to the
// upstream product (Reflect V1, its importer, its repos), and history
// (changelog, delivery log, plans). Those are counted per file in
// `legacy-names-baseline.json`. This check fails when a file holds more
// matches than its baseline, so new code can only lower the count.
//
//   node scripts/check-legacy-names.mjs            check
//   node scripts/check-legacy-names.mjs --update   rewrite the baseline
//
// Lower the baseline (`--update`) in the same commit that removes matches.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const baselinePath = join(root, 'scripts', 'legacy-names-baseline.json')

// Not the upstream name: the English verb and the JS `Reflect` global.
const ENGLISH = /\b(reflects|reflected|reflecting|reflections?|Reflections?)\b(?![-_/:.])/g
const JS_GLOBAL =
  /\bReflect\.(apply|construct|defineProperty|deleteProperty|get|getOwnPropertyDescriptor|getPrototypeOf|has|isExtensible|ownKeys|preventExtensions|set|setPrototypeOf)\b/g
const NAME = /reflect/gi

const SKIP = new Set(['pnpm-lock.yaml', 'Cargo.lock', 'scripts/legacy-names-baseline.json'])

function countIn(text) {
  return (text.replaceAll(ENGLISH, '').replaceAll(JS_GLOBAL, '').match(NAME) ?? []).length
}

function currentCounts() {
  const listed = execFileSync('git', ['grep', '-Il', '-i', 'reflect', '--', '.'], {
    cwd: root,
    encoding: 'utf8',
  })
  const counts = {}
  for (const file of listed.split('\n')) {
    if (!file || SKIP.has(file)) continue
    const n = countIn(readFileSync(join(root, file), 'utf8'))
    if (n > 0) counts[file] = n
  }
  return counts
}

const counts = currentCounts()

if (process.argv.includes('--update')) {
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`)
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  console.log(`legacy names: baseline updated (${total} in ${Object.keys(counts).length} files)`)
  process.exit(0)
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
const over = Object.entries(counts).filter(([file, n]) => n > (baseline[file] ?? 0))
if (over.length > 0) {
  console.error('New "reflect" names. Kore is the only name; see CLAUDE.md:')
  for (const [file, n] of over) console.error(`  ${file}: ${n} (baseline ${baseline[file] ?? 0})`)
  console.error('If the match is upstream history or on-disk data, run with --update and say why.')
  process.exit(1)
}
