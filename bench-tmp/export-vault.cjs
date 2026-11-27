// node export-vault.cjs <vaultRoot> <out.json>  — md/base/canvas files outside dot folders, plus .obsidian/*.json
const fs = require('fs'), path = require('path')
const [root, out] = process.argv.slice(2)
const files = {}
let bytes = 0
function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const abs = path.join(dir, e.name), r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) walk(abs, r)
    else if (/\.(md|base|canvas)$/.test(e.name)) { const t = fs.readFileSync(abs, 'utf8'); files[r] = t; bytes += t.length }
  }
}
walk(root, '')
const ob = path.join(root, '.obsidian')
if (fs.existsSync(ob)) for (const f of fs.readdirSync(ob)) if (f.endsWith('.json')) files['.obsidian/' + f] = fs.readFileSync(path.join(ob, f), 'utf8')
fs.writeFileSync(out, JSON.stringify(files))
console.log(Object.keys(files).length, 'files', (bytes / 1e6).toFixed(1), 'MB')
