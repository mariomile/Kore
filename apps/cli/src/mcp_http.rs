//! `kore mcp --http` — the same MCP handler as the stdio server, reachable
//! over the network so agents that cannot launch a local process (Claude on
//! the web and on the phone, cloud agents, API clients) can use the graph.
//!
//! Transport: MCP Streamable HTTP in its stateless form. `POST /mcp` carries
//! one JSON-RPC message (or a batch) and gets a JSON reply; there is no SSE
//! stream, so `GET /mcp` is 405 as the spec allows.
//!
//! Auth: the owner's secret, `KORE_MCP_TOKEN`, plus one key per named agent
//! (`KORE_MCP_AGENTS`). API clients send either as `Authorization: Bearer
//! <key>`; Claude's and ChatGPT's connectors sign in through the built-in
//! OAuth server in [`oauth`]. `GET /setup.md` is the one public page: what
//! an agent reads to connect itself, with no secret in it.
//!
//! The server never terminates TLS: it binds a local address and is meant to
//! sit behind an HTTPS tunnel (Tailscale Funnel, Cloudflare Tunnel) that
//! supplies the public URL.

mod oauth;
mod pages;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{json, Value};

pub use crate::agent_keys::AgentKey;
use crate::mcp::{decode_component, Runner, Server};
use oauth::Authorizer;

/// The agent-facing setup guide; `{MCP_URL}` is filled per request.
const SETUP_GUIDE: &str = include_str!("mcp_http/setup.md");

/// Shortest secret accepted: long enough that guessing it online is hopeless.
pub const MIN_SECRET_LEN: usize = 24;

/// Largest request body read, far above any MCP message an agent sends.
const MAX_BODY: u64 = 8 * 1024 * 1024;

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

    fn body_form(&self) -> HashMap<String, String> {
        parse_form(&String::from_utf8_lossy(&self.body))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

impl HttpResponse {
    fn new(status: u16, headers: &[(&str, &str)], body: impl Into<Vec<u8>>) -> Self {
        Self {
            status,
            headers: headers
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            body: body.into(),
        }
    }

    fn json(status: u16, body: &Value) -> Self {
        let headers = [
            ("Content-Type", "application/json"),
            ("Cache-Control", "no-store"),
        ];
        Self::new(status, &headers, body.to_string())
    }

    fn html(status: u16, body: String) -> Self {
        Self::new(
            status,
            &[("Content-Type", "text/html; charset=utf-8")],
            body,
        )
    }

    fn redirect(location: String) -> Self {
        Self::new(302, &[("Location", &location)], Vec::new())
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
    /// The public origin clients reach (the tunnel's URL). When absent it is
    /// taken from the `Host` header.
    pub public_url: Option<String>,
    /// OAuth redirect URIs accepted on top of Claude's, ChatGPT's and
    /// loopback ones.
    pub extra_redirects: Vec<String>,
    /// Named agents' keys handed over at start (`KORE_MCP_AGENTS`).
    pub agents: Vec<AgentKey>,
    /// The keys file `kore keys` edits, read on every request.
    pub keys_file: Option<std::path::PathBuf>,
}

/// The MCP handler behind HTTP routing and the OAuth endpoints.
pub struct HttpServer<R: Runner> {
    mcp: Server<R>,
    auth: Authorizer,
    public_url: Option<String>,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// Parses `application/x-www-form-urlencoded` (also query strings).
fn parse_form(input: &str) -> HashMap<String, String> {
    let decode = |value: &str| {
        let spaced = value.replace('+', " ");
        decode_component(&spaced).unwrap_or(spaced)
    };
    input
        .split('&')
        .filter(|pair| !pair.is_empty())
        .map(|pair| {
            let (key, value) = pair.split_once('=').unwrap_or((pair, ""));
            (decode(key), decode(value))
        })
        .collect()
}

impl<R: Runner> HttpServer<R> {
    pub fn new(mcp: Server<R>, options: HttpOptions) -> Self {
        Self {
            mcp,
            auth: Authorizer::new(
                options.secret,
                options.extra_redirects,
                options.agents,
                options.keys_file,
            ),
            public_url: options
                .public_url
                .map(|url| url.trim_end_matches('/').to_string()),
        }
    }

    /// Route one request at time `at` (seconds since the epoch).
    pub fn route(&self, request: &HttpRequest, at: u64) -> HttpResponse {
        let base = self.base_url(request);
        match (request.method.as_str(), request.path.as_str()) {
            ("POST", "/mcp") => self.post_mcp(request, &base, at),
            (_, "/mcp") => HttpResponse::new(405, &[("Allow", "POST")], Vec::new()),
            ("GET", path) if path.starts_with("/.well-known/oauth-protected-resource") => {
                HttpResponse::json(200, &Authorizer::protected_resource_metadata(&base))
            }
            ("GET", path) if path.starts_with("/.well-known/oauth-authorization-server") => {
                HttpResponse::json(200, &Authorizer::server_metadata(&base))
            }
            ("GET", "/setup.md") => HttpResponse::new(
                200,
                &[("Content-Type", "text/markdown; charset=utf-8")],
                SETUP_GUIDE.replace("{MCP_URL}", &format!("{base}/mcp")),
            ),
            ("POST", "/register") => self.auth.register(&request.body),
            ("GET", "/authorize") => self.auth.authorize_page(&parse_form(&request.query)),
            ("POST", "/authorize") => self.auth.authorize_submit(&request.body_form(), at),
            ("POST", "/token") => self.auth.token(&request.body_form(), at),
            _ => HttpResponse::new(404, &[("Content-Type", "text/plain")], "not found"),
        }
    }

    fn base_url(&self, request: &HttpRequest) -> String {
        if let Some(url) = &self.public_url {
            return url.clone();
        }
        let host = request.header("host").unwrap_or("localhost");
        let local = host.starts_with("localhost") || host.starts_with("127.0.0.1");
        format!("{}://{host}", if local { "http" } else { "https" })
    }

    fn post_mcp(&self, request: &HttpRequest, base: &str, at: u64) -> HttpResponse {
        let bearer = request
            .header("authorization")
            .and_then(|value| value.strip_prefix("Bearer "))
            .map(str::trim);
        let Some(caller) = bearer.and_then(|token| self.auth.caller(token, at)) else {
            let mut response =
                HttpResponse::oauth_error(401, "invalid_token", "missing or invalid bearer token");
            response.headers.push((
                "WWW-Authenticate".into(),
                format!("Bearer resource_metadata=\"{base}/.well-known/oauth-protected-resource\""),
            ));
            return response;
        };
        match self.mcp.handle_payload_as(&request.body, &caller) {
            Some(reply) => HttpResponse::json(200, &reply),
            None => HttpResponse::new(202, &[], Vec::new()),
        }
    }
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
                    let response = server.route(&to_request(&mut incoming), now());
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
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use base64::Engine;
    use sha2::{Digest, Sha256};

    use super::oauth::{is_loopback_redirect, ACCESS_TTL_SECS};
    use super::*;
    use crate::mcp::{encode_component, RunOutput};

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
    const AGENT_KEY: &str = "grok-bots-own-long-enough-key-456";
    const AT: u64 = 1_800_000_000;
    const REDIRECT: &str = "https://claude.ai/api/mcp/auth_callback";

    fn server() -> HttpServer<NoRunner> {
        HttpServer::new(
            Server::new(NoRunner, false),
            HttpOptions {
                secret: SECRET.into(),
                public_url: Some("https://kore.example.ts.net".into()),
                extra_redirects: Vec::new(),
                agents: vec![AgentKey {
                    id: "a1".into(),
                    name: "Grok bot".into(),
                    key: AGENT_KEY.into(),
                    access: crate::agent_keys::Access::Read,
                }],
                keys_file: None,
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
            encode_component(REDIRECT)
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
            encode_component(&query["code"]),
            encode_component(REDIRECT)
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

    fn tool_names(response: &HttpResponse) -> Vec<String> {
        body(response)["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect()
    }

    #[test]
    fn an_agent_key_is_its_own_read_only_caller_and_its_tokens_die_with_it() {
        let server = server();
        let direct = server.route(&post("/mcp", LIST_TOOLS, Some(AGENT_KEY)), AT);
        assert_eq!(direct.status, 200);
        let names = tool_names(&direct);
        assert!(names.contains(&"search".to_string()));
        assert!(!names.contains(&"remember".to_string()));
        let owner = server.route(&post("/mcp", LIST_TOOLS, Some(SECRET)), AT);
        assert!(tool_names(&owner).contains(&"remember".to_string()));

        // Signing in with the agent key binds the OAuth tokens to the agent.
        let verifier = "a-pkce-verifier-that-is-long-enough-for-the-spec-000";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier));
        let chatgpt = "https://chatgpt.com/connector/oauth/abc_123";
        let form = format!(
            "response_type=code&client_id=c1&redirect_uri={}&code_challenge={challenge}\
&code_challenge_method=S256&secret={AGENT_KEY}",
            encode_component(chatgpt)
        );
        let allowed = server.route(&post("/authorize", &form, None), AT);
        assert_eq!(allowed.status, 302);
        let code =
            parse_form(header(&allowed, "Location").split_once('?').unwrap().1)["code"].clone();
        let exchange = format!(
            "grant_type=authorization_code&code={}&client_id=c1&redirect_uri={}&code_verifier={verifier}",
            encode_component(&code),
            encode_component(chatgpt)
        );
        let access = body(&server.route(&post("/token", &exchange, None), AT))["access_token"]
            .as_str()
            .unwrap()
            .to_string();
        let as_agent = server.route(&post("/mcp", LIST_TOOLS, Some(&access)), AT + 1);
        assert!(!tool_names(&as_agent).contains(&"remember".to_string()));

        // Removing the key (a restart with the agent gone) revokes its token.
        let without_agent = HttpServer::new(
            Server::new(NoRunner, false),
            HttpOptions {
                secret: SECRET.into(),
                public_url: Some("https://kore.example.ts.net".into()),
                extra_redirects: Vec::new(),
                agents: Vec::new(),
                keys_file: None,
            },
        );
        let revoked = without_agent.route(&post("/mcp", LIST_TOOLS, Some(&access)), AT + 1);
        assert_eq!(revoked.status, 401);
    }

    #[test]
    fn the_setup_guide_is_public_and_names_this_servers_url() {
        let server = server();
        let request = HttpRequest {
            method: "GET".into(),
            path: "/setup.md".into(),
            ..HttpRequest::default()
        };
        let response = server.route(&request, AT);
        assert_eq!(response.status, 200);
        let text = String::from_utf8(response.body).unwrap();
        assert!(text.contains("https://kore.example.ts.net/mcp"));
        assert!(!text.contains(SECRET) && !text.contains("{MCP_URL}"));
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
        for injected in [
            "http://localhost:1/cb\r\nLocation: https://evil.example",
            "http://localhost:1/cb x",
        ] {
            assert!(!server.auth.redirect_allowed(injected), "{injected}");
        }
        assert!(is_loopback_redirect("http://localhost:3118/callback"));
        assert!(!server
            .auth
            .redirect_allowed("https://chatgpt.com/connector/oauth/x/../../evil"));
    }
}
