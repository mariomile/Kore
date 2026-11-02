//! The single-user OAuth 2.1 authorization server behind `kore mcp --http`.
//!
//! Claude's connectors only speak OAuth, so the server answers discovery
//! (RFC 8414 / RFC 9728), dynamic client registration (RFC 7591), an
//! authorize page that asks for the secret, and a token endpoint with PKCE
//! (S256) and refresh. Nothing is stored except used code ids: codes and
//! tokens are HMAC-signed [`Claims`] with a key derived from the secret, so
//! they survive a restart and changing the secret revokes them all.

use std::collections::HashMap;
use std::sync::Mutex;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::pages;
use super::HttpResponse;
use crate::mcp::encode_component;

/// Redirect URIs every hosted Claude surface (web, Desktop, mobile) uses.
const CLAUDE_REDIRECTS: [&str; 2] = [
    "https://claude.ai/api/mcp/auth_callback",
    "https://claude.com/api/mcp/auth_callback",
];

pub(super) const ACCESS_TTL_SECS: u64 = 60 * 60;
const REFRESH_TTL_SECS: u64 = 60 * 60 * 24 * 30;
const CODE_TTL_SECS: u64 = 120;

/// What a signed token is for. A token of one kind never passes as another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Kind {
    Code,
    Access,
    Refresh,
}

/// The signed payload of a code or token.
#[derive(Debug, Serialize, Deserialize)]
struct Claims {
    kind: Kind,
    /// Unique id, so two tokens never collide and a code can be spent once.
    id: String,
    expires: u64,
    /// The OAuth client (codes and refresh tokens).
    #[serde(default, skip_serializing_if = "String::is_empty")]
    client: String,
    /// Codes only: the redirect URI and PKCE challenge they were issued for.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    redirect_uri: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    challenge: String,
}

/// The validated parameters of an authorize request.
struct AuthorizeRequest {
    client: String,
    redirect_uri: String,
    challenge: String,
    state: Option<String>,
}

pub(super) struct Authorizer {
    secret: String,
    key: [u8; 32],
    extra_redirects: Vec<String>,
    /// Ids of codes already exchanged, with their expiry.
    spent_codes: Mutex<HashMap<String, u64>>,
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
pub(super) fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    left.len() == right.len()
        && left
            .iter()
            .zip(right)
            .fold(0u8, |acc, (one, two)| acc | (one ^ two))
            == 0
}

fn random_id() -> String {
    let mut bytes = [0u8; 16];
    // Without OS randomness ids would be guessable; refuse rather than degrade.
    getrandom::fill(&mut bytes).expect("the OS random number generator is unavailable");
    URL_SAFE_NO_PAD.encode(bytes)
}

/// A loopback redirect (`http://localhost:<any port>/…` or `127.0.0.1`), the
/// shape native clients such as Claude Code use (RFC 8252).
pub(super) fn is_loopback_redirect(uri: &str) -> bool {
    let Some(rest) = uri.strip_prefix("http://") else {
        return false;
    };
    // The authority ends at the first of these (browsers read a backslash as `/`).
    let authority = rest.split(['/', '\\', '?', '#']).next().unwrap_or_default();
    // Userinfo (`localhost:80@evil.example`) would make the real host the
    // part after `@`, so any `@` disqualifies the URI.
    if authority.contains('@') {
        return false;
    }
    let (host, port) = authority.split_once(':').unwrap_or((authority, ""));
    (host == "localhost" || host == "127.0.0.1") && port.bytes().all(|byte| byte.is_ascii_digit())
}

fn invalid_grant(description: &str) -> HttpResponse {
    HttpResponse::oauth_error(400, "invalid_grant", description)
}

impl Authorizer {
    pub(super) fn new(secret: String, extra_redirects: Vec<String>) -> Self {
        let key = Sha256::new()
            .chain_update(b"kore-mcp-oauth\0")
            .chain_update(secret.as_bytes())
            .finalize()
            .into();
        Self {
            secret,
            key,
            extra_redirects,
            spent_codes: Mutex::new(HashMap::new()),
        }
    }

    /// Whether a bearer token grants access: the secret itself, or an access
    /// token this server issued that has not expired.
    pub(super) fn accepts(&self, bearer: &str, at: u64) -> bool {
        constant_time_eq(bearer.as_bytes(), self.secret.as_bytes())
            || self.verify(bearer, Kind::Access, at).is_some()
    }

    pub(super) fn protected_resource_metadata(base: &str) -> Value {
        json!({
            "resource": format!("{base}/mcp"),
            "authorization_servers": [base],
            "bearer_methods_supported": ["header"],
        })
    }

    pub(super) fn server_metadata(base: &str) -> Value {
        json!({
            "issuer": base,
            "authorization_endpoint": format!("{base}/authorize"),
            "token_endpoint": format!("{base}/token"),
            "registration_endpoint": format!("{base}/register"),
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
        })
    }

    fn sign(&self, claims: &Claims) -> String {
        let payload = serde_json::to_vec(claims).expect("claims serialize");
        let body = URL_SAFE_NO_PAD.encode(payload);
        let mac = URL_SAFE_NO_PAD.encode(hmac_sha256(&self.key, body.as_bytes()));
        format!("{body}.{mac}")
    }

    fn issue(&self, kind: Kind, ttl: u64, at: u64, client: &str) -> String {
        self.sign(&Claims {
            kind,
            id: random_id(),
            expires: at + ttl,
            client: client.to_string(),
            redirect_uri: String::new(),
            challenge: String::new(),
        })
    }

    /// The claims of a token this server signed, if it is of `kind` and
    /// still valid at `at`.
    fn verify(&self, token: &str, kind: Kind, at: u64) -> Option<Claims> {
        let (body, mac) = token.split_once('.')?;
        let given = URL_SAFE_NO_PAD.decode(mac).ok()?;
        if !constant_time_eq(&hmac_sha256(&self.key, body.as_bytes()), &given) {
            return None;
        }
        let claims: Claims = serde_json::from_slice(&URL_SAFE_NO_PAD.decode(body).ok()?).ok()?;
        (claims.kind == kind && claims.expires > at).then_some(claims)
    }

    pub(super) fn redirect_allowed(&self, uri: &str) -> bool {
        // The URI ends up in a `Location` header: no control characters,
        // whitespace or non-ASCII, so it can never split the response.
        uri.bytes().all(|byte| byte.is_ascii_graphic())
            && (CLAUDE_REDIRECTS.contains(&uri)
                || is_loopback_redirect(uri)
                || self.extra_redirects.iter().any(|allowed| allowed == uri))
    }

    /// Dynamic client registration. Clients are not stored: the redirect URI
    /// allowlist is what keeps codes from leaking, and every authorization
    /// still needs the secret.
    pub(super) fn register(&self, body: &[u8]) -> HttpResponse {
        let Ok(body) = serde_json::from_slice::<Value>(body) else {
            return HttpResponse::oauth_error(400, "invalid_client_metadata", "body is not JSON");
        };
        let redirects: Vec<&str> = body
            .get("redirect_uris")
            .and_then(Value::as_array)
            .map(|uris| uris.iter().filter_map(Value::as_str).collect())
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

    fn authorize_request(
        &self,
        form: &HashMap<String, String>,
    ) -> Result<AuthorizeRequest, String> {
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
        Ok(AuthorizeRequest {
            client: field("client_id").ok_or("missing client_id")?,
            redirect_uri,
            challenge: field("code_challenge").ok_or("missing code_challenge")?,
            state: field("state"),
        })
    }

    /// `GET /authorize`: the consent page, or an error page that never
    /// redirects.
    pub(super) fn authorize_page(&self, form: &HashMap<String, String>) -> HttpResponse {
        match self.authorize_request(form) {
            Ok(_) => HttpResponse::html(200, pages::consent(form, None)),
            Err(message) => HttpResponse::html(400, pages::error(&message)),
        }
    }

    /// `POST /authorize`: checks the secret, then redirects with a code.
    pub(super) fn authorize_submit(&self, form: &HashMap<String, String>, at: u64) -> HttpResponse {
        let request = match self.authorize_request(form) {
            Ok(request) => request,
            Err(message) => return HttpResponse::html(400, pages::error(&message)),
        };
        let secret = form.get("secret").map(String::as_str).unwrap_or_default();
        if !constant_time_eq(secret.trim().as_bytes(), self.secret.as_bytes()) {
            return HttpResponse::html(401, pages::consent(form, Some("That token is not right.")));
        }
        let code = self.sign(&Claims {
            kind: Kind::Code,
            id: random_id(),
            expires: at + CODE_TTL_SECS,
            client: request.client,
            redirect_uri: request.redirect_uri.clone(),
            challenge: request.challenge,
        });
        let separator = if request.redirect_uri.contains('?') {
            '&'
        } else {
            '?'
        };
        let mut location = format!(
            "{}{separator}code={}",
            request.redirect_uri,
            encode_component(&code)
        );
        if let Some(state) = request.state {
            location.push_str(&format!("&state={}", encode_component(&state)));
        }
        HttpResponse::redirect(location)
    }

    /// `POST /token`: exchanges a code (with its PKCE verifier) or a refresh
    /// token for a fresh access + refresh pair.
    pub(super) fn token(&self, form: &HashMap<String, String>, at: u64) -> HttpResponse {
        let field = |key: &str| form.get(key).map(String::as_str).unwrap_or_default();
        let client = match field("grant_type") {
            "authorization_code" => {
                let Some(code) = self.verify(field("code"), Kind::Code, at) else {
                    return invalid_grant("invalid or expired code");
                };
                let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(field("code_verifier")));
                if code.client != field("client_id")
                    || code.redirect_uri != field("redirect_uri")
                    || !constant_time_eq(challenge.as_bytes(), code.challenge.as_bytes())
                {
                    return invalid_grant("code does not match this request");
                }
                if !self.spend_code(&code.id, at) {
                    return invalid_grant("code already used");
                }
                code.client
            }
            "refresh_token" => match self.verify(field("refresh_token"), Kind::Refresh, at) {
                Some(refresh) => refresh.client,
                None => return invalid_grant("invalid or expired refresh token"),
            },
            _ => {
                return HttpResponse::oauth_error(
                    400,
                    "unsupported_grant_type",
                    "grant_type must be authorization_code or refresh_token",
                )
            }
        };
        HttpResponse::json(
            200,
            &json!({
                "access_token": self.issue(Kind::Access, ACCESS_TTL_SECS, at, ""),
                "token_type": "Bearer",
                "expires_in": ACCESS_TTL_SECS,
                "refresh_token": self.issue(Kind::Refresh, REFRESH_TTL_SECS, at, &client),
            }),
        )
    }

    /// Records a code's id; false when it was already exchanged.
    fn spend_code(&self, id: &str, at: u64) -> bool {
        let Ok(mut spent) = self.spent_codes.lock() else {
            return false;
        };
        spent.retain(|_, expires| *expires > at);
        spent.insert(id.to_string(), at + CODE_TTL_SECS).is_none()
    }
}
