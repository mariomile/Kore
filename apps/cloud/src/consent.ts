import type { Env } from './worker'

/**
 * The one page a person sees in Kore Cloud: when an agent (Claude, ChatGPT)
 * connects, it opens `/authorize`, and the vault's owner approves it by
 * typing the access key Kore showed at setup. There are no accounts: holding
 * the key is being the owner.
 */

/** The bearer token of a request, or null. */
export function bearer(request: Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))
}

/**
 * Constant-time comparison of a presented key with the configured one, over
 * their SHA-256 digests so neither length nor content leaks through timing.
 * An unset configured key matches nothing.
 */
export async function accessKeyMatches(
  presented: string | null,
  expected: string | undefined,
): Promise<boolean> {
  if (presented === null || expected === undefined || expected === '') {
    return false
  }
  const [left, right] = await Promise.all([digest(presented), digest(expected)])
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replaceAll(/[&<>"']/g, (character) => ESCAPES[character] ?? character)
}

/** A minimal, self-contained page (no external assets) in light and dark. */
export function consentPage(inner: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Kore</title>
<style>
:root{color-scheme:light dark;--fg:#1d1d1f;--muted:#6e6e73;--line:#d2d2d7;--bg:#fff;--btn:#1d1d1f;--btnfg:#fff}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f7;--muted:#a1a1a6;--line:#424245;--bg:#1c1c1e;--btn:#f5f5f7;--btnfg:#1d1d1f}}
body{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:26rem;margin:12vh auto;padding:0 16px;color:var(--fg);background:var(--bg)}
h1{font-size:1.4rem;margin:0 0 .5rem}.muted{color:var(--muted);font-size:.9rem}
input,button{font:inherit;width:100%;padding:.7rem;margin:.35rem 0;border-radius:10px;box-sizing:border-box}
input{border:1px solid var(--line);background:transparent;color:inherit}
button{border:0;background:var(--btn);color:var(--btnfg);cursor:pointer}
button.secondary{background:transparent;color:var(--fg);border:1px solid var(--line)}
</style>${inner}</html>`,
    { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

/** `GET /authorize` shows the approval form; `POST` checks the key and completes the grant. */
export async function handleAuthorize(request: Request, env: Env): Promise<Response> {
  const oauth = env.OAUTH_PROVIDER
  if (request.method === 'GET') {
    let authRequest
    try {
      authRequest = await oauth.parseAuthRequest(request)
    } catch (cause) {
      const redirectTo = (cause as { redirectTo?: unknown }).redirectTo
      if (typeof redirectTo === 'string') {
        return Response.redirect(redirectTo, 302)
      }
      return consentPage(
        `<h1>This link does not work</h1><p class="muted">${escapeHtml((cause as Error).message ?? cause)}</p>`,
        400,
      )
    }
    const details = await oauth.describeConsent(authRequest)
    const consent = await oauth.beginConsent(authRequest)
    const page = consentPage(`<h1>Connect ${escapeHtml(details.clientName)} to Kore</h1>
<p class="muted">It will be able to search and read your notes and add to them. Private notes are never in Kore Cloud. You will return to ${escapeHtml(details.redirectHost)}.</p>
<form method="post">
<input type="hidden" name="handle" value="${escapeHtml(consent.handle)}">
<input type="password" name="key" placeholder="Kore access key" autocomplete="current-password" required autofocus>
<button name="decision" value="approve">Allow</button>
<button class="secondary" name="decision" value="deny" formnovalidate>Deny</button>
</form>`)
    consent.headers.forEach((value, name) => {
      if (name.toLowerCase() !== 'content-type') {
        page.headers.append(name, value)
      }
    })
    return page
  }
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { allow: 'GET, POST' } })
  }
  const form = await request.formData()
  const handle = form.get('handle') ?? ''
  if (form.get('decision') !== 'approve') {
    const denied = await oauth.denyConsent(request, handle)
    return new Response(null, { status: 302, headers: denied.headers })
  }
  if (!(await accessKeyMatches(form.get('key') ?? '', env.KORE_ACCESS_KEY))) {
    return consentPage(
      '<h1>That key is not right</h1><p class="muted">Start again from the agent and type the access key Kore showed you.</p>',
      401,
    )
  }
  const approved = await oauth.approveConsent(request, handle, { scope: ['mcp', 'offline_access'] })
  const { redirectTo } = await oauth.completeAuthorization({
    request: approved.request,
    userId: 'owner',
    metadata: {},
    scope: approved.request.scope,
    props: { user: 'owner' },
  })
  approved.headers.set('location', redirectTo)
  return new Response(null, { status: 302, headers: approved.headers })
}
