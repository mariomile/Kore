import { OAuthProvider, type OAuthHelpers } from '@cloudflare/workers-oauth-provider'
import { accessKeyMatches, bearer, consentPage, handleAuthorize } from './consent'
import { installVaultLayout } from './layout'
import { handleMcp } from './mcp'
import { NoteStore } from './store'
import { handleSync } from './sync'

/**
 * Kore Cloud: the user's vault always on, in their own Cloudflare account.
 *
 * - `/mcp` is the agents' endpoint. Claude and ChatGPT connect through OAuth
 *   (dynamic registration or a client metadata document, PKCE), signing in
 *   once with the vault's access key; a CLI or script may instead send the
 *   access key itself as `Authorization: Bearer <key>`.
 * - `/sync/*` is the Kore app's two-way sync, access key only.
 */
export interface Env {
  DB: D1Database
  OAUTH_KV: KVNamespace
  /** The vault's access key, a Worker secret setup generates. */
  KORE_ACCESS_KEY: string
  /** The vault's layout as JSON (see `layout.ts`); absent means Kore's default. */
  KORE_VAULT_LAYOUT?: string
  /** Installed by the OAuth provider on requests it forwards. */
  OAUTH_PROVIDER: OAuthHelpers
}

let schemaReady: Promise<void> | null = null

/** The store, with the schema ensured once per isolate. */
async function storeFor(env: Env): Promise<NoteStore> {
  installVaultLayout(env.KORE_VAULT_LAYOUT)
  const store = new NoteStore(env.DB)
  schemaReady ??= store.ensureSchema().catch((cause: unknown) => {
    schemaReady = null
    throw cause
  })
  await schemaReady
  return store
}

/**
 * Dynamic client registrations allowed per day. Registration is open (the
 * MCP spec requires it) and each one writes to KV, whose free tier allows
 * 1,000 writes a day: a cap far above a person's own agents keeps a stranger
 * with the URL from spending that budget and blocking sign-ins.
 */
export const MAX_REGISTRATIONS_PER_DAY = 25

function isAllowedRedirect(uri: unknown): boolean {
  if (typeof uri !== 'string') {
    return false
  }
  try {
    const url = new URL(uri)
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    return url.protocol === 'https:' || (url.protocol === 'http:' && loopback)
  } catch {
    return false
  }
}

async function registrationGate(
  env: Env,
  clientMetadata: Record<string, unknown>,
): Promise<{ code: string; description: string } | undefined> {
  const uris = clientMetadata.redirect_uris
  if (
    !Array.isArray(uris) ||
    uris.length === 0 ||
    uris.length > 10 ||
    !uris.every(isAllowedRedirect)
  ) {
    return {
      code: 'invalid_redirect_uri',
      description: 'redirect_uris must be https (or loopback http)',
    }
  }
  const store = await storeFor(env)
  const day = new Date().toISOString().slice(0, 10)
  if (!(await store.countUnder(`registrations:${day}`, MAX_REGISTRATIONS_PER_DAY))) {
    return {
      code: 'access_denied',
      description: 'Too many client registrations today; try tomorrow',
    }
  }
  return undefined
}

const providers = new Map<string, OAuthProvider<Env>>()

/** One provider per origin: its metadata names the Worker's own URL. */
function providerFor(origin: string, env: Env): OAuthProvider<Env> {
  let provider = providers.get(origin)
  if (provider === undefined) {
    provider = new OAuthProvider<Env>({
      apiRoute: '/mcp',
      apiHandler: { fetch: async (request, env) => await handleMcp(request, await storeFor(env)) },
      defaultHandler: {
        fetch: async (request, env) => {
          const url = new URL(request.url)
          if (url.pathname === '/authorize') {
            return await handleAuthorize(request, env)
          }
          if (url.pathname === '/') {
            return consentPage(
              '<h1>Kore Cloud is running.</h1><p class="muted">Connect an agent to <code>/mcp</code>.</p>',
            )
          }
          return new Response('Not found', { status: 404 })
        },
      },
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/oauth/token',
      clientRegistrationEndpoint: '/oauth/register',
      clientIdMetadataDocumentEnabled: true,
      clientRegistrationCallback: async ({ clientMetadata }) =>
        await registrationGate(env, clientMetadata),
      scopesSupported: ['mcp', 'offline_access'],
      resourceMetadata: { resource: `${origin}/mcp`, authorization_servers: [origin] },
      requiredScopes: ['mcp'],
    })
    providers.set(origin, provider)
  }
  return provider
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/sync/')) {
      if (!(await accessKeyMatches(bearer(request), env.KORE_ACCESS_KEY))) {
        return Response.json({ error: 'unauthorized' }, { status: 401 })
      }
      return await handleSync(request, await storeFor(env))
    }
    const key = bearer(request)
    if (
      url.pathname === '/mcp' &&
      key !== null &&
      (await accessKeyMatches(key, env.KORE_ACCESS_KEY))
    ) {
      return await handleMcp(request, await storeFor(env))
    }
    return await providerFor(url.origin, env).fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Env>
