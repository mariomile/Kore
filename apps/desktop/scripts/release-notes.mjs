// What's in this build, for the people who install it.
//
//   node scripts/release-notes.mjs print <version>
//   node scripts/release-notes.mjs testflight --build-number=<n>
//
// `print` writes the notes for <version> to stdout: the hand-written
// `release-notes/<version>.md` when it exists (short, English, no PR jargon,
// written by whoever cuts the release), otherwise the version's section of
// CHANGELOG.md with the links and hashes stripped. The DMG release puts this
// at the top of the GitHub release body, which tauri-action also copies into
// latest.json as the updater's `notes`.
//
// `testflight` sets the same text as the TestFlight "What to Test" of the
// build just uploaded, through the App Store Connect API with the same
// APPLE_API_KEY / APPLE_API_ISSUER / APPLE_API_KEY_CONTENT secrets the upload
// uses. It never fails the release: on any error it prints a warning and
// exits 0, because the build itself is already on TestFlight.

import { createPrivateKey, sign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { normalizeApiKeyContent } from './release-ios.mjs'

const appDir = join(import.meta.dirname, '..')
const IOS_BUNDLE_ID = 'app.kore.ios'
const ASC = 'https://api.appstoreconnect.apple.com/v1'
/** App Store Connect rejects a longer whatsNew. */
export const WHATS_NEW_LIMIT = 4000

/** The `## [x.y.z]` section of a release-please changelog, as plain lines. */
export function changelogSection(changelog, version) {
  const lines = changelog.split('\n')
  const escaped = version.replaceAll('.', String.raw`\.`)
  const start = lines.findIndex((line) =>
    new RegExp(String.raw`^## \[?${escaped}\]?[ (]`).test(line),
  )
  if (start === -1) return ''
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .map((line) =>
      line
        .replaceAll(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/g, '')
        .replaceAll(/\s*\(\[#\d+\]\([^)]*\)\)/g, '')
        .replace(/^\* \*\*[^*]+:\*\* /, '* ')
        .replace(/^### /, ''),
    )
    .join('\n')
    .replaceAll(/\n{3,}/g, '\n\n')
    .trim()
}

/** The notes for a version: the hand-written file first, the changelog second. */
export function releaseNotes(version, { dir = appDir } = {}) {
  const handWritten = join(dir, 'release-notes', `${version}.md`)
  if (existsSync(handWritten)) return readFileSync(handWritten, 'utf8').trim()
  const changelog = join(dir, 'CHANGELOG.md')
  if (!existsSync(changelog)) return ''
  return changelogSection(readFileSync(changelog, 'utf8'), version)
}

/** Markdown down to what TestFlight shows: plain text, `•` bullets. */
export function plainText(markdown) {
  const text = markdown
    .split('\n')
    .map((line) =>
      line
        .replace(/^#+\s*/, '')
        .replace(/^\s*[*-]\s+/, '• ')
        .replaceAll(/\*\*([^*]+)\*\*/g, '$1')
        .replaceAll(/`([^`]+)`/g, '$1')
        .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1'),
    )
    .join('\n')
    .trim()
  return text.length > WHATS_NEW_LIMIT ? `${text.slice(0, WHATS_NEW_LIMIT - 1)}…` : text
}

/** An App Store Connect API token (ES256 JWT, 20 minutes). */
export function ascToken({ keyId, issuerId, privateKey, now = Date.now() }) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const iat = Math.floor(now / 1000)
  const unsigned = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({
    iss: issuerId,
    iat,
    exp: iat + 1200,
    aud: 'appstoreconnect-v1',
  })}`
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: createPrivateKey(privateKey),
    dsaEncoding: 'ieee-p1363',
  })
  return `${unsigned}.${signature.toString('base64url')}`
}

async function asc(token, path, { method = 'GET', body } = {}) {
  const response = await fetch(`${ASC}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    throw new Error(
      `${method} ${path} → ${response.status} ${(await response.text()).slice(0, 300)}`,
    )
  }
  return response.status === 204 ? null : response.json()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function setWhatsNew({ buildNumber, whatsNew, env = process.env }) {
  const { APPLE_API_KEY, APPLE_API_ISSUER, APPLE_API_KEY_CONTENT, APPLE_API_KEY_PATH } = env
  if (!APPLE_API_KEY || !APPLE_API_ISSUER)
    throw new Error('APPLE_API_KEY / APPLE_API_ISSUER not set')
  const raw =
    APPLE_API_KEY_CONTENT ?? (APPLE_API_KEY_PATH ? readFileSync(APPLE_API_KEY_PATH, 'utf8') : '')
  if (!raw) throw new Error('APPLE_API_KEY_CONTENT / APPLE_API_KEY_PATH not set')
  const token = ascToken({
    keyId: APPLE_API_KEY.trim(),
    issuerId: APPLE_API_ISSUER.trim(),
    privateKey: normalizeApiKeyContent(raw),
  })

  const apps = await asc(token, `/apps?filter[bundleId]=${IOS_BUNDLE_ID}&limit=1`)
  const app = apps.data[0]
  if (!app) throw new Error(`no App Store Connect app for ${IOS_BUNDLE_ID}`)

  // The upload waited for processing, but the build can take a few more
  // minutes to show up in the API.
  let build
  for (let attempt = 0; attempt < 20 && !build; attempt++) {
    if (attempt > 0) await sleep(30_000)
    const builds = await asc(
      token,
      `/builds?filter[app]=${app.id}&filter[version]=${buildNumber}&limit=1`,
    )
    build = builds.data[0]
  }
  if (!build) throw new Error(`build ${buildNumber} not found in App Store Connect`)

  const existing = await asc(token, `/builds/${build.id}/betaBuildLocalizations`)
  if (existing.data.length > 0) {
    for (const localization of existing.data) {
      await asc(token, `/betaBuildLocalizations/${localization.id}`, {
        method: 'PATCH',
        body: {
          data: {
            type: 'betaBuildLocalizations',
            id: localization.id,
            attributes: { whatsNew },
          },
        },
      })
    }
    return existing.data.map((localization) => localization.attributes.locale)
  }
  const locale = app.attributes.primaryLocale ?? 'it'
  await asc(token, '/betaBuildLocalizations', {
    method: 'POST',
    body: {
      data: {
        type: 'betaBuildLocalizations',
        attributes: { locale, whatsNew },
        relationships: { build: { data: { type: 'builds', id: build.id } } },
      },
    },
  })
  return [locale]
}

async function main(argv) {
  const [command, ...rest] = argv
  const version = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).version
  if (command === 'print') {
    process.stdout.write(`${releaseNotes(rest[0] ?? version)}\n`)
    return
  }
  if (command === 'testflight') {
    const buildNumber = rest.find((arg) => arg.startsWith('--build-number='))?.split('=')[1]
    const whatsNew = plainText(releaseNotes(version))
    if (!buildNumber || !whatsNew) {
      console.log(
        `::warning::No TestFlight notes set (build ${buildNumber ?? '?'}, ${whatsNew.length} chars)`,
      )
      return
    }
    try {
      const locales = await setWhatsNew({ buildNumber, whatsNew })
      console.log(`What to Test set on build ${buildNumber} (${locales.join(', ')}):\n${whatsNew}`)
    } catch (error) {
      console.log(`::warning::Could not set TestFlight What to Test: ${error.message}`)
    }
    return
  }
  console.error('usage: release-notes.mjs print [version] | testflight --build-number=<n>')
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main(process.argv.slice(2))
}
