#!/usr/bin/env node
// Recall@k for `kore search` on a fixed question set (the "MCP alla pari con
// la chat" slice's measure). Each question lists the note paths a good answer
// must surface; a question counts as a hit when any of them is in the top k.
// Runs every question in lexical and hybrid mode, so the gain of the
// semantic leg is measured on the user's own vault. Hybrid is the same
// fusion the in-app chat's `search_notes` runs (`retrieve()`), and `kore
// search` refuses semantic search unless its vectors match the app's, so
// hybrid here is the chat's ranking.
//
//   node apps/desktop/scripts/search-recall.mjs questions.json [--kore <path>] [--graph <dir>] [--k 5]
//
// questions.json: [{ "question": "cosa so di …", "expect": ["CRM/People/X.md"] }, …]
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
function flag(name, fallback) {
  const at = args.indexOf(`--${name}`)
  return at === -1 ? fallback : args[at + 1]
}
const file = args.find((arg, index) => !arg.startsWith('--') && !args[index - 1]?.startsWith('--'))
if (!file) {
  console.error('usage: search-recall.mjs questions.json [--kore <path>] [--graph <dir>] [--k 5]')
  process.exit(2)
}
const kore = flag('kore', 'kore')
const graph = flag('graph', null)
const k = Number(flag('k', '5'))
const questions = JSON.parse(readFileSync(file, 'utf8'))

function search(question, mode) {
  const argv = [
    ...(graph ? ['--graph', graph] : []),
    '--json',
    'search',
    '--limit',
    String(k),
    '--mode',
    mode,
    '--',
    question,
  ]
  const out = JSON.parse(
    execFileSync(kore, argv, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  )
  return out
}

const totals = { lexical: 0, hybrid: 0 }
let unavailable = null
console.log(`| # | question | lexical@${k} | hybrid@${k} |`)
console.log('|---|---|---|---|')
for (const [index, { question, expect }] of questions.entries()) {
  const row = {}
  for (const mode of ['lexical', 'hybrid']) {
    const result = search(question, mode)
    if (mode === 'hybrid' && result.mode !== 'hybrid') unavailable = result.semanticUnavailable
    const paths = result.results.map((hit) => hit.path)
    row[mode] = expect.some((path) => paths.includes(path))
    totals[mode] += row[mode] ? 1 : 0
  }
  console.log(
    `| ${index + 1} | ${question} | ${row.lexical ? '✓' : '·'} | ${row.hybrid ? '✓' : '·'} |`,
  )
}
console.log(
  `\nrecall@${k}: lexical ${totals.lexical}/${questions.length}, hybrid ${totals.hybrid}/${questions.length}`,
)
if (unavailable) console.log(`(semantic search did not run: ${unavailable})`)
