//! `kore mcp --http` — the same MCP handler as the stdio server, reachable
//! over the network so agents that cannot launch a local process (Claude on
//! the web and on the phone, cloud agents, API clients) can use the graph.
//!
//! Transport: MCP Streamable HTTP in its stateless form. `POST /mcp` carries
//! one JSON-RPC message (or a batch) and gets a JSON reply; there is no SSE
//! stream, so `GET /mcp` is 405 as the spec allows.
//!
//! Auth: one secret, `KORE_MCP_TOKEN`, guards everything, two ways.
//! - API clients send it as `Authorization: Bearer <secret>`.
//! - Claude's connectors only speak OAuth, so the server is also its own
//!   single-user OAuth 2.1 authorization server: discovery metadata, dynamic
//!   client registration, an authorize page that asks for the secret, and a
//!   token endpoint with PKCE (S256) and refresh. Codes and tokens are
//!   stateless, HMAC-signed with a key derived from the secret, so they
//!   survive a restart and changing the secret revokes them all.
//!
//! The server never terminates TLS: it binds a local address and is meant to
//! sit behind an HTTPS tunnel (Tailscale Funnel, Cloudflare Tunnel) that
//! supplies the public URL.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::mcp::{Runner, Server};

/// Shortest secret accepted: long enough that guessing it online is hopeless.
pub const MIN_SECRET_LEN: usize = 24;

/// Redirect URIs every hosted Claude surface (web, Desktop, mobile) uses.
const CLAUDE_REDIRECTS: [&str; 2] = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
];

const ACCESS_TTL_SECS: u64 = 60 * 60;
const REFRESH_TTL_SECS: u64 = 60 * 60 * 24 * 30;
const CODE_TTL_SECS: u64 = 120;

/// A request as the router sees it, independent of the HTTP library.
#[derive(Debug, Clone, Default)]
pub struct HttpRequest {
    pub method: String,
    /// Path without the query string.
    pub path: String,
    pub query: String,
    /// Header names lowercased.
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpRequest {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    fn new(status: u16, content_type: &str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            headers: vec![("Content-Type".into(), content_type.into())],
            body: body.into(),
        }
    }

    fn json(status: u16, body: &Value) -> Self {
        let mut response = Self::new(status, "application/json", body.to_string());
        response
            .headers
            .push(("Cache-Control".into(), "no-store".into()));
        response
    }

    fn empty(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    fn html(status: u16, body: String) -> Self {
        Self::new(status, "text/html; charset=utf-8", body)
    }

    fn oauth_error(status: u16, error: &str, description: &str) -> Self {
        Self::json(
            status,
            &json!({ "error": error, "error_description": description }),
        )
    }
}

/// Settings for the HTTP front of the MCP server.
pub struct HttpOptions {
    /// The shared secret (`KORE_MCP_TOKEN`).
    pub secret: String,
    /// The public origin clients reach (the tunnel's URL), without a
    /// trailing slash. When absent it is taken from the `Host` header.
    pub public_url: Option<String>,
    /// OAuth redirect URIs accepted on top of Claude's and loopback ones.
    pub extra_redirects: Vec<String>,
}

/// The MCP handler plus HTTP routing and the OAuth endpoints.
pub struct HttpServer<R: Runner> {
    mcp: Server<R>,
    options: HttpOptions,
    key: [u8; 32],
    /// Authorization codes already exchanged, with their expiry, so a code
    /// works once.
    used_codes: Mutex<HashMap<String, u64>>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// HMAC-SHA256 (RFC 2104).
fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    let mut block = [0u8; 64];
    block[..32].copy_from_slice(key);
    let inner_pad: Vec<u8> = block.iter().map(|byte| byte ^ 0x36).collect();
    let outer_pad: Vec<u8> = block.iter().map(|byte| byte ^ 0x5c).collect();
    let inner = Sha256::new()
        .chain_update(&inner_pad)
        .chain_update(message)
        .finalize();
    Sha256::new()
        .chain_update(&outer_pad)
        .chain_update(inner)
        .finalize()
        .into()
}

/// Compares without an early exit, so timing does not leak how much of a
/// guess was right.
fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0u8, |acc, (one, two)| acc | (one ^ two))
        == 0
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    if getrandom::fill(&mut bytes).is_err() {
        bytes = Sha256::digest(now().to_le_bytes()).as_slice()[..16]
            .try_into()
            .unwrap_or_default();
    }
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Parses `application/x-www-form-urlencoded` (also query strings).
fn parse_form(input: &str) -> HashMap<String, String> {
    fn decode(value: &str) -> String {
        let bytes = value.as_bytes();
        let mut decoded = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while index < bytes.len() {
            match bytes[index] {
                b'+' => decoded.push(b' '),
                b'%' => {
                    let hex = bytes
                        .get(index + 1..index + 3)
                        .and_then(|hex| std::str::from_utf8(hex).ok())
                        .and_then(|hex| u8::from_str_radix(hex, 16).ok());
                    if let Some(byte) = hex {
                        decoded.push(byte);
                        index += 2;
                    } else {
                        decoded.push(b'%');
                    }
                }
                byte => decoded.push(byte),
            }
            index += 1;
        }
        String::from_utf8_lossy(&decoded).into_owned()
    }
    input
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| match pair.split_once('=') {
            Some((key, value)) => (decode(key), decode(value)),
            None => (decode(pair), String::new()),
        })
        .collect()
}

fn encode_query_value(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

/// A loopback redirect (`http://localhost:<any port>/…` or `127.0.0.1`), the
/// shape native clients such as Claude Code use (RFC 8252).
fn is_loopback_redirect(uri: &str) -> bool {
    let Some(rest) = uri.strip_prefix("http://") else {
        return false;
    };
    // The authority ends at the first of these (browsers treat `\\` as `/`).
    let authority = rest.split(['/', '\\', '?', '#']).next().unwrap_or_default();
    // Userinfo (`localhost:80@evil.example`) would make the real host the
    // part after `@`, so any `@` disqualifies the URI.
    if authority.contains('@') {
        return false;
    }
    let (host, port) = authority.split_once(':').unwrap_or((authority, ""));
    (host == "localhost" || host == "127.0.0.1") && port.bytes().all(|byte| byte.is_ascii_digit())
}

/// The OAuth parameters of an authorize request, validated.
struct AuthorizeParams {
    client_id: String,
    redirect_uri: String,
    code_challenge: String,
    state: Option<String>,
}

impl<R: Runner> HttpServer<R> {
    pub fn new(mcp: Server<R>, options: HttpOptions) -> Self {
        let key = Sha256::new()
            .chain_update(b"kore-mcp-oauth\0")
            .chain_update(options.secret.as_bytes())
            .finalize()
            .into();
        Self {
            mcp,
            options,
            key,
            used_codes: Mutex::new(HashMap::new()),
        }
    }

    /// Route one request at time `at` (seconds since the epoch).
    pub fn route(&self, request: &HttpRequest, at: u64) -> HttpResponse {
        let base = self.base_url(request);
        match (request.method.as_str(), request.path.as_str()) {
            ("POST", "/mcp") => self.post_mcp(request, &base, at),
            (_, "/mcp") => {
                let mut response = HttpResponse::empty(405);
                response.headers.push(("Allow".into(), "POST".into()));
                response
            }
            ("GET", path) if path.starts_with("/.well-known/oauth-protected-resource") => {
                HttpResponse::json(
                    200,
                    &json!({
                        "resource": format!("{base}/mcp"),
                        "authorization_servers": [base],
                        "bearer_methods_supported": ["header"],
                    }),
                )
            }
            ("GET", path)
                if path.starts_with("/.well-known/oauth-authorization-server")
                    || path.starts_with("/.well-known/openid-configuration") =>
            {
                HttpResponse::json(
                    200,
                    &json!({
                        "issuer": base,
                        "authorization_endpoint": format!("{base}/authorize"),
                        "token_endpoint": format!("{base}/token"),
                        "registration_endpoint": format!("{base}/register"),
                        "response_types_supported": ["code"],
                        "grant_types_supported": ["authorization_code", "refresh_token"],
                        "code_challenge_methods_supported": ["S256"],
                        "token_endpoint_auth_methods_supported": ["none"],
                    }),
                )
            }
            ("POST", "/register") => self.register(request),
            ("GET", "/authorize") => self.authorize_page(&parse_form(&request.query)),
            ("POST", "/authorize") => {
                self.authorize_submit(&parse_form(&String::from_utf8_lossy(&request.body)), at)
            }
            ("POST", "/token") => {
                self.token(&parse_form(&String::from_utf8_lossy(&request.body)), at)
            }
            _ => HttpResponse::new(404, "text/plain; charset=utf-8", "not found"),
        }
    }

    fn base_url(&self, request: &HttpRequest) -> String {
        if let Some(url) = &self.options.public_url {
            return url.trim_end_matches('/').to_string();
        }
        let host = request.header("host").unwrap_or("localhost");
        let local = host.starts_with("localhost") || host.starts_with("127.0.0.1");
        format!("{}://{host}", if local { "http" } else { "https" })
    }

    fn sign(&self, payload: &Value) -> String {
        let body = URL_SAFE_NO_PAD.encode(payload.to_string());
        let mac = URL_SAFE_NO_PAD.encode(hmac_sha256(&self.key, body.as_bytes()));
        format!("{body}.{mac}")
    }

    /// The payload of a token this server signed, if it is of `kind` and
    /// not expired at `at`.
    fn verify(&self, token: &str, kind: &str, at: u64) -> Option<Value> {
        let (body, mac) = token.split_once('.')?;
        let expected = hmac_sha256(&self.key, body.as_bytes());
        let given = URL_SAFE_NO_PAD.decode(mac).ok()?;
        if !constant_time_eq(&expected, &given) {
            return None;
        }
        let payload: Value = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body).ok()?).ok()?;
        let fresh = payload.get("exp").and_then(Value::as_u64)? > at;
        (payload.get("typ").and_then(Value::as_str) == Some(kind) && fresh).then_some(payload)
    }

    fn authorized(&self, request: &HttpRequest, at: u64) -> bool {
        let Some(token) = request
            .header("authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim)
        else {
            return false;
        };
        constant_time_eq(token.as_bytes(), self.options.secret.as_bytes())
            || self.verify(token, "access", at).is_some()
    }

    fn post_mcp(&self, request: &HttpRequest, base: &str, at: u64) -> HttpResponse {
        if !self.authorized(request, at) {
            let mut response = HttpResponse::json(
                401,
                &json!({ "error": "invalid_token", "error_description": "missing or invalid bearer token" }),
            );
            response.headers.push((
                "WWW-Authenticate".into(),
                format!("Bearer resource_metadata=\"{base}/.well-known/oauth-protected-resource\""),
            ));
            return response;
        }
        let reply = match serde_json::from_slice::<Value>(&request.body) {
            Ok(Value::Array(batch)) => {
                let replies: Vec<Value> = batch
                    .iter()
                    .filter_map(|message| self.mcp.handle(message))
                    .collect();
                (!replies.is_empty()).then_some(Value::Array(replies))
            }
            Ok(message) => self.mcp.handle(&message),
            Err(_) => Some(json!({ "jsonrpc": "2.0", "id": null,
                "error": { "code": -32700, "message": "parse error" } })),
        };
        match reply {
            Some(reply) => HttpResponse::json(200, &reply),
            None => HttpResponse::empty(202),
        }
    }

    fn redirect_allowed(&self, uri: &str) -> bool {
        CLAUDE_REDIRECTS.contains(&uri)
            || is_loopback_redirect(uri)
            || self
                .options
                .extra_redirects
                .iter()
                .any(|allowed| allowed == uri)
    }

    /// Dynamic client registration (RFC 7591). Clients are not stored: the
    /// redirect URI allowlist is what keeps codes from leaking, and every
    /// authorization still needs the secret.
    fn register(&self, request: &HttpRequest) -> HttpResponse {
        let Ok(body) = serde_json::from_slice::<Value>(&request.body) else {
            return HttpResponse::oauth_error(400, "invalid_client_metadata", "body is not JSON");
        };
        let redirects: Vec<String> = body
            .get("redirect_uris")
            .and_then(Value::as_array)
            .map(|uris| {
                uris.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default();
        if redirects.is_empty() || !redirects.iter().all(|uri| self.redirect_allowed(uri)) {
            return HttpResponse::oauth_error(
                400,
                "invalid_redirect_uri",
                "redirect URI not allowed; start kore mcp with --redirect-uri to allow it",
            );
        }
        let mut registered = json!({
            "client_id": random_id(),
            "redirect_uris": redirects,
            "token_endpoint_auth_method": "none",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
        });
        if let Some(name) = body.get("client_name") {
            registered["client_name"] = name.clone();
        }
        HttpResponse::json(201, &registered)
    }

    fn authorize_params(&self, form: &HashMap<String, String>) -> Result<AuthorizeParams, String> {
        let field = |key: &str| form.get(key).filter(|value| !value.is_empty()).cloned();
        let redirect_uri = field("redirect_uri").ok_or("missing redirect_uri")?;
        if !self.redirect_allowed(&redirect_uri) {
            return Err(format!("redirect URI not allowed: {redirect_uri}"));
        }
        if field("response_type").as_deref() != Some("code") {
            return Err("response_type must be code".into());
        }
        if field("code_challenge_method").as_deref() != Some("S256") {
            return Err("PKCE with S256 is required".into());
        }
        Ok(AuthorizeParams {
            client_id: field("client_id").ok_or("missing client_id")?,
            redirect_uri,
            code_challenge: field("code_challenge").ok_or("missing code_challenge")?,
            state: field("state"),
        })
    }

    fn authorize_page(&self, form: &HashMap<String, String>) -> HttpResponse {
        match self.authorize_params(form) {
            Ok(_) => HttpResponse::html(200, consent_page(form, None)),
            Err(message) => HttpResponse::html(400, error_page(&message)),
        }
    }

    fn authorize_submit(&self, form: &HashMap<String, String>, at: u64) -> HttpResponse {
        let params = match self.authorize_params(form) {
            Ok(params) => params,
            Err(message) => return HttpResponse::html(400, error_page(&message)),
        };
        let secret = form.get("secret").map(String::as_str).unwrap_or_default();
        if !constant_time_eq(secret.trim().as_bytes(), self.options.secret.as_bytes()) {
            return HttpResponse::html(401, consent_page(form, Some("That token is not right.")));
        }
        let code = self.sign(&json!({
            "typ": "code",
            "jti": random_id(),
            "cid": params.client_id,
            "ruri": params.redirect_uri,
            "pkce": params.code_challenge,
            "exp": at + CODE_TTL_SECS,
        }));
        let separator = if params.redirect_uri.contains('?') {
            '&'
        } else {
            '?'
        };
        let mut location = format!(
            "{}{separator}code={}",
            params.redirect_uri,
            encode_query_value(&code)
        );
        if let Some(state) = params.state {
            location.push_str(&format!("&state={}", encode_query_value(&state)));
        }
        let mut response = HttpResponse::empty(302);
        response.headers.push(("Location".into(), location));
        response
    }

    fn token(&self, form: &HashMap<String, String>, at: u64) -> HttpResponse {
        let field = |key: &str| form.get(key).map(String::as_str).unwrap_or_default();
        let client_id = match form.get("grant_type").map(String::as_str) {
            Some("authorization_code") => {
                let Some(code) = self.verify(field("code"), "code", at) else {
                    return HttpResponse::oauth_error(
                        400,
                        "invalid_grant",
                        "invalid or expired code",
                    );
                };
                let claim = |key: &str| code.get(key).and_then(Value::as_str).unwrap_or_default();
                let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(field("code_verifier")));
                if claim("cid") != field("client_id")
                    || claim("ruri") != field("redirect_uri")
                    || !constant_time_eq(challenge.as_bytes(), claim("pkce").as_bytes())
                {
                    return HttpResponse::oauth_error(
                        400,
                        "invalid_grant",
                        "code does not match this request",
                    );
                }
                if !self.mark_code_used(claim("jti"), at) {
                    return HttpResponse::oauth_error(400, "invalid_grant", "code already used");
                }
                claim("cid").to_string()
            }
            Some("refresh_token") => {
                let Some(refresh) = self.verify(field("refresh_token"), "refresh", at) else {
                    return HttpResponse::oauth_error(
                        400,
                        "invalid_grant",
                        "invalid or expired refresh token",
                    );
                };
                refresh
                    .get("cid")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string()
            }
            _ => {
                return HttpResponse::oauth_error(
                    400,
                    "unsupported_grant_type",
                    "grant_type must be authorization_code or refresh_token",
                )
            }
        };
        let access =
            self.sign(&json!({ "typ": "access", "jti": random_id(), "exp": at + ACCESS_TTL_SECS }));
        let refresh = self.sign(&json!({
            "typ": "refresh", "jti": random_id(), "cid": client_id, "exp": at + REFRESH_TTL_SECS,
        }));
        HttpResponse::json(
            200,
            &json!({
                "access_token": access,
                "token_type": "Bearer",
                "expires_in": ACCESS_TTL_SECS,
                "refresh_token": refresh,
            }),
        )
    }

    /// Records a code's id; false when it was already exchanged.
    fn mark_code_used(&self, jti: &str, at: u64) -> bool {
        let Ok(mut used) = self.used_codes.lock() else {
            return false;
        };
        used.retain(|_, expires| *expires > at);
        used.insert(jti.to_string(), at + CODE_TTL_SECS).is_none()
    }
}

fn page(title: &str, body: &str) -> String {
    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{title}</title>\
<style>body{{font:16px/1.5 -apple-system,system-ui,sans-serif;max-width:26rem;margin:15vh auto;padding:0 1rem;color:#1c1c1e}}\
input,button{{font:inherit;width:100%;box-sizing:border-box;padding:.6rem;margin-top:.6rem;border-radius:8px;border:1px solid #c7c7cc}}\
button{{background:#1c1c1e;color:#fff;border:0}}.error{{color:#c0392b}}\
@media(prefers-color-scheme:dark){{body{{background:#1c1c1e;color:#f2f2f7}}button{{background:#f2f2f7;color:#1c1c1e}}}}</style>\
</head><body>{body}</body></html>"
    )
}

fn consent_page(form: &HashMap<String, String>, error: Option<&str>) -> String {
    let hidden: String = [
        "response_type",
        "client_id",
        "redirect_uri",
        "code_challenge",
        "code_challenge_method",
        "state",
        "scope",
        "resource",
    ]
    .iter()
    .filter_map(|key| {
        form.get(*key).map(|value| {
            format!(
                "<input type=\"hidden\" name=\"{key}\" value=\"{}\">",
                escape_html(value)
            )
        })
    })
    .collect();
    let redirect = form
        .get("redirect_uri")
        .map(String::as_str)
        .unwrap_or_default();
    let host = redirect
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split('/').next())
        .unwrap_or(redirect);
    let error = error
        .map(|message| format!("<p class=\"error\">{}</p>", escape_html(message)))
        .unwrap_or_default();
    page(
        "Connect to Kore",
        &format!(
            "<h1>Connect to Kore</h1><p><strong>{}</strong> is asking to use your notes. \
Paste the token you set in <code>KORE_MCP_TOKEN</code> to allow it.</p>{error}\
<form method=\"post\" action=\"/authorize\">{hidden}\
<input type=\"password\" name=\"secret\" autocomplete=\"current-password\" placeholder=\"Token\" autofocus required>\
<button type=\"submit\">Allow</button></form>",
            escape_html(host)
        ),
    )
}

fn error_page(message: &str) -> String {
    page(
        "Kore",
        &format!(
            "<h1>Can't connect</h1><p class=\"error\">{}</p>",
            escape_html(message)
        ),
    )
}

/// Serve on `address` until the process is stopped, with a few worker
/// threads so one slow tool call doesn't hold up the rest.
pub fn serve<R: Runner + Send + Sync + 'static>(
    server: HttpServer<R>,
    address: &str,
) -> std::io::Result<()> {
    let listener = tiny_http::Server::http(address)
        .map_err(|err| std::io::Error::other(format!("could not listen on {address}: {err}")))?;
    let listener = Arc::new(listener);
    let server = Arc::new(server);
    eprintln!("kore mcp: listening on http://{address}/mcp");
    let workers: Vec<_> = (0..4)
        .map(|_| {
            let listener = Arc::clone(&listener);
            let server = Arc::clone(&server);
            std::thread::spawn(move || {
                for mut incoming in listener.incoming_requests() {
                    let request = to_request(&mut incoming);
                    let response = server.route(&request, now());
                    let mut reply = tiny_http::Response::from_data(response.body)
                        .with_status_code(response.status);
                    for (name, value) in response.headers {
                        if let Ok(header) =
                            tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes())
                        {
                            reply.add_header(header);
                        }
                    }
                    // A client that hung up is not the server's problem.
                    let _ = incoming.respond(reply);
                }
            })
        })
        .collect();
    for worker in workers {
        let _ = worker.join();
    }
    Ok(())
}

/// Largest request body read, far above any MCP message an agent sends.
const MAX_BODY: u64 = 8 * 1024 * 1024;

fn to_request(incoming: &mut tiny_http::Request) -> HttpRequest {
    use std::io::Read;
    let url = incoming.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let headers = incoming
        .headers()
        .iter()
        .map(|header| {
            (
                header.field.as_str().as_str().to_ascii_lowercase(),
                header.value.as_str().to_string(),
            )
        })
        .collect();
    let mut body = Vec::new();
    let _ = incoming.as_reader().take(MAX_BODY).read_to_end(&mut body);
    HttpRequest {
        method: incoming.method().as_str().to_ascii_uppercase(),
        path: path.to_string(),
        query: query.to_string(),
        headers,
        body,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mcp::RunOutput;

    struct NoRunner;

    impl Runner for NoRunner {
        fn run(&self, _args: &[String], _stdin: Option<&str>) -> RunOutput {
            RunOutput {
                success: true,
                text: "{}".into(),
            }
        }
    }

    const SECRET: &str = "a-long-enough-test-secret-123";
    const AT: u64 = 1_800_000_000;
    const REDIRECT: &str = "https://claude.ai/api/mcp/auth_callback";

    fn server() -> HttpServer<NoRunner> {
        HttpServer::new(
            Server::new(NoRunner, true),
            HttpOptions {
                secret: SECRET.into(),
                public_url: Some("https://kore.example.ts.net".into()),
                extra_redirects: Vec::new(),
            },
        )
    }

    fn post(path: &str, body: &str, bearer: Option<&str>) -> HttpRequest {
        let mut headers = vec![];
        if let Some(token) = bearer {
            headers.push(("authorization".into(), format!("Bearer {token}")));
        }
        HttpRequest {
            method: "POST".into(),
            path: path.into(),
            headers,
            body: body.as_bytes().to_vec(),
            ..HttpRequest::default()
        }
    }

    fn header<'a>(response: &'a HttpResponse, name: &str) -> &'a str {
        response
            .headers
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
            .unwrap_or_default()
    }

    fn body(response: &HttpResponse) -> Value {
        serde_json::from_slice(&response.body).unwrap()
    }

    const LIST_TOOLS: &str = r#"{"jsonrpc":"2.0","id":1,"method":"tools/list"}"#;

    #[test]
    fn mcp_without_a_token_points_the_client_at_oauth_discovery() {
        let server = server();
        let response = server.route(&post("/mcp", LIST_TOOLS, None), AT);
        assert_eq!(response.status, 401);
        assert_eq!(
            header(&response, "WWW-Authenticate"),
            "Bearer resource_metadata=\"https://kore.example.ts.net/.well-known/oauth-protected-resource\""
        );
        let wrong = server.route(&post("/mcp", LIST_TOOLS, Some("guess")), AT);
        assert_eq!(wrong.status, 401);

        let direct = server.route(&post("/mcp", LIST_TOOLS, Some(SECRET)), AT);
        assert_eq!(direct.status, 200);
        assert!(body(&direct)["result"]["tools"].as_array().unwrap().len() > 1);
    }

    #[test]
    fn an_oauth_round_trip_with_pkce_yields_a_token_that_reaches_the_tools() {
        let server = server();
        let verifier = "a-pkce-verifier-that-is-long-enough-for-the-spec-000";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier));
        let form = format!(
            "response_type=code&client_id=c1&redirect_uri={}&code_challenge={challenge}\
&code_challenge_method=S256&state=xyz",
            encode_query_value(REDIRECT)
        );

        let refused = server.route(
            &post("/authorize", &format!("{form}&secret=nope"), None),
            AT,
        );
        assert_eq!(refused.status, 401);

        let allowed = server.route(
            &post("/authorize", &format!("{form}&secret={SECRET}"), None),
            AT,
        );
        assert_eq!(allowed.status, 302);
        let location = header(&allowed, "Location");
        let query = parse_form(location.split_once('?').unwrap().1);
        assert_eq!(query["state"], "xyz");

        let exchange = format!(
            "grant_type=authorization_code&code={}&client_id=c1&redirect_uri={}&code_verifier={verifier}",
            encode_query_value(&query["code"]),
            encode_query_value(REDIRECT)
        );
        let tokens = server.route(&post("/token", &exchange, None), AT);
        assert_eq!(tokens.status, 200);
        let access = body(&tokens)["access_token"].as_str().unwrap().to_string();

        let replay = server.route(&post("/token", &exchange, None), AT);
        assert_eq!(body(&replay)["error"], "invalid_grant");

        let call = server.route(&post("/mcp", LIST_TOOLS, Some(&access)), AT + 10);
        assert_eq!(call.status, 200);
        let expired = server.route(
            &post("/mcp", LIST_TOOLS, Some(&access)),
            AT + ACCESS_TTL_SECS + 1,
        );
        assert_eq!(expired.status, 401);
    }

    #[test]
    fn an_unknown_redirect_uri_never_receives_a_code() {
        let server = server();
        let form = "response_type=code&client_id=c1&redirect_uri=https%3A%2F%2Fevil.example%2Fcb\
&code_challenge=abc&code_challenge_method=S256";
        let response = server.route(
            &post("/authorize", &format!("{form}&secret={SECRET}"), None),
            AT,
        );
        assert_eq!(response.status, 400);
        assert!(header(&response, "Location").is_empty());

        for disguised in [
            "http://127.0.0.1:80@evil.example/cb",
            "http://localhost@evil.example/cb",
        ] {
            assert!(!is_loopback_redirect(disguised), "{disguised}");
        }
        assert!(is_loopback_redirect("http://localhost:3118/callback"));
    }
}
