// node prof.cjs file.cpuprofile [n]  -> top self and inclusive by function
const fs = require('fs')
const p = JSON.parse(fs.readFileSync(process.argv[2]))
const n = Number(process.argv[3] ?? 30)
const byId = new Map(p.nodes.map((x) => [x.id, x]))
const parent = new Map()
for (const x of p.nodes) for (const c of x.children ?? []) parent.set(c, x.id)
const dt = new Map()
for (let i = 0; i < p.samples.length; i++) dt.set(p.samples[i], (dt.get(p.samples[i]) ?? 0) + (p.timeDeltas[i] ?? 0))
const key = (x) => { const cf = x.callFrame; const f = (cf.url || '').split('/').pop().replace(/-[A-Za-z0-9_]{8}\.js/, '.js'); return `${cf.functionName || '(anon)'} ${f}:${cf.lineNumber}` }
const self = new Map(), incl = new Map()
let total = 0
for (const [id, t] of dt) {
  const x = byId.get(id); total += t
  if (['(idle)', '(program)'].includes(x.callFrame.functionName)) continue
  self.set(key(x), (self.get(key(x)) ?? 0) + t)
  const seen = new Set(); let cur = id
  while (cur !== undefined) { const k = key(byId.get(cur)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) ?? 0) + t) } cur = parent.get(cur) }
}
const idle = [...dt].filter(([id]) => byId.get(id).callFrame.functionName === '(idle)').reduce((a, [, t]) => a + t, 0)
console.log('total ms', (total / 1000).toFixed(0), 'idle', (idle / 1000).toFixed(0))
console.log('--- self'); for (const [k, t] of [...self].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log((t / 1000).toFixed(0).padStart(6), k)
console.log('--- inclusive'); for (const [k, t] of [...incl].sort((a, b) => b[1] - a[1]).slice(0, n)) console.log((t / 1000).toFixed(0).padStart(6), k)
