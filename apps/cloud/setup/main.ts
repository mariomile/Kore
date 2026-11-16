import { spawn } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { setVaultLayout } from '@kore/core/graph/vault-layout'
import bundle from '../dist/worker/worker.js?raw'
import {
  KoreCloud,
  activateKoreCloud,
  connectorUrl,
  tokenPageUrl,
  uploadNotes,
  waitForWorker,
  type KoreCloudConfig,
  type UploadReport,
} from '@kore/core/cloud'
import { readVaultLayout, readVaultNotes } from './upload'

/**
 * `kore-cloud.mjs`, the script behind `kore cloud setup`: create Kore Cloud
 * in the user's own Cloudflare account, upload the Worker, and send the
 * vault's notes. The Cloudflare token comes from `KORE_CLOUDFLARE_TOKEN` or a
 * hidden prompt and is never stored; the owner key and the Worker's URL go to
 * a 0600 file outside the vault (`--config`), so running setup again keeps
 * the key and updates the Worker in place.
 */

type CloudConfig = KoreCloudConfig

function log(line: string): void {
  process.stderr.write(`${line}\n`)
}

async function readConfig(path: string): Promise<CloudConfig | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as CloudConfig
  } catch {
    return null
  }
}

async function writeConfig(path: string, config: CloudConfig): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 })
  await chmod(path, 0o600)
}

/** Open a page in the default browser where there is one (best effort). */
function openInBrowser(url: string): void {
  const opener =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  try {
    spawn(opener, [url], { stdio: 'ignore', detached: true })
      .on('error', () => {})
      .unref()
  } catch {
    // No browser here: the link above is enough.
  }
}

/** A line read from the terminal without echoing it. */
async function promptHidden(question: string): Promise<string> {
  const input = process.stdin
  if (!input.isTTY) {
    throw new Error('No terminal to paste the token into: set KORE_CLOUDFLARE_TOKEN.')
  }
  process.stderr.write(question)
  input.setRawMode(true)
  input.resume()
  input.setEncoding('utf8')
  return await new Promise((done, fail) => {
    let value = ''
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') {
          finish()
          done(value.trim())
          return
        }
        if (character === '\u{3}') {
          finish()
          fail(new Error('Cancelled.'))
          return
        }
        value = character === '\u{7F}' ? value.slice(0, -1) : value + character
      }
    }
    const finish = (): void => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stderr.write('\n')
    }
    input.on('data', onData)
  })
}

async function setup(options: {
  vault: string
  config: string
  account: string | undefined
  name: string | undefined
}): Promise<void> {
  let token = process.env.KORE_CLOUDFLARE_TOKEN?.trim() ?? ''
  if (token === '') {
    log('Kore Cloud runs in your own Cloudflare account (the free plan is enough).')
    log('Open this page, pick your account, press "Create Token" and copy the token:')
    log(`  ${tokenPageUrl()}`)
    openInBrowser(tokenPageUrl())
    token = await promptHidden('Paste the token (it is not shown): ')
  }
  if (token === '') {
    throw new Error('No token given.')
  }
  const layout = await readVaultLayout(options.vault)
  setVaultLayout(layout)
  const done = await activateKoreCloud({
    token,
    fetch,
    bundle,
    layout,
    saved: await readConfig(options.config),
    accountId: options.account,
    workerName: options.name,
    readNotes: () => readVaultNotes(options.vault),
    onConfig: async (config) => {
      await writeConfig(options.config, config)
      log(`Owner key saved in ${options.config}`)
    },
    onStep: log,
    onUpload: (sent, total) => log(`Notes uploaded: ${sent} of ${total}`),
  })
  summarize(done.config, done.created, done.report)
}

/** Send the vault's notes Kore Cloud lacks, and print what happened. */
async function upload(vault: string, config: CloudConfig): Promise<void> {
  const cloud = new KoreCloud(config.url, config.ownerKey)
  log('Waiting for Kore Cloud to answer')
  await waitForWorker(cloud)
  const notes = await readVaultNotes(vault)
  log(`Vault: ${notes.length} notes`)
  const report = await uploadNotes(cloud, notes, (sent, total) =>
    log(`Notes uploaded: ${sent} of ${total}`),
  )
  summarize(config, false, report)
}

function summarize(config: CloudConfig, created: boolean, report: UploadReport): void {
  log('')
  log(`Kore Cloud is on: ${config.url}`)
  log(`  ${report.uploaded} notes uploaded, ${report.unchanged} already there`)
  if (report.private > 0) {
    log(`  ${report.private} private notes stayed on this computer`)
  }
  if (report.tooLarge.length > 0) {
    log(
      `  ${report.tooLarge.length} notes over 1 MB stayed on this computer: ${report.tooLarge.join(', ')}`,
    )
  }
  if (report.differs.length > 0) {
    log(`  ${report.differs.length} notes differ from Kore Cloud and were left as they are there`)
  }
  for (const failure of report.failed) {
    log(`  not uploaded: ${failure.path} (${failure.reason})`)
  }
  log('')
  log(`Add it to Claude or ChatGPT as a custom connector: ${connectorUrl(config)}`)
  log('When it asks, name the agent and approve it with this owner key (keep it to yourself):')
  log(`  ${config.ownerKey}`)
  log('`kore cloud key` prints it again.')
  process.stdout.write(
    `${JSON.stringify({ url: config.url, mcp: connectorUrl(config), created, ...report })}\n`,
  )
}

async function main(argv: string[]): Promise<void> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      vault: { type: 'string' },
      config: { type: 'string' },
      account: { type: 'string' },
      name: { type: 'string' },
    },
  })
  const [command] = positionals
  if (command === 'token-url') {
    process.stdout.write(`${tokenPageUrl()}\n`)
    return
  }
  if (command === 'key') {
    if (values.config === undefined) {
      throw new Error('--config is required')
    }
    const saved = await readConfig(values.config)
    if (saved === null) {
      throw new Error('Kore Cloud is not set up on this computer: run `kore cloud setup`.')
    }
    process.stdout.write(`${saved.ownerKey}\n`)
    return
  }
  if (command === 'upload') {
    if (values.vault === undefined || values.config === undefined) {
      throw new Error('--vault and --config are required')
    }
    const saved = await readConfig(values.config)
    if (saved === null) {
      throw new Error('Kore Cloud is not set up on this computer: run `kore cloud setup`.')
    }
    const vault = resolve(values.vault)
    setVaultLayout(await readVaultLayout(vault))
    await upload(vault, saved)
    return
  }
  if (command === 'setup') {
    if (values.vault === undefined || values.config === undefined) {
      throw new Error('--vault and --config are required')
    }
    await setup({
      vault: resolve(values.vault),
      config: resolve(values.config),
      account: values.account,
      name: values.name,
    })
    return
  }
  throw new Error(
    'usage: kore-cloud.mjs setup --vault <dir> --config <file> [--account <id>] [--name <worker>] | upload --vault <dir> --config <file> | key --config <file> | token-url',
  )
}

main(process.argv.slice(2)).catch((error: unknown) => {
  log(`kore cloud: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
