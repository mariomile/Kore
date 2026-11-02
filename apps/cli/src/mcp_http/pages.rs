//! The two HTML pages the OAuth flow shows a person: consent and error.

use std::collections::HashMap;

/// The authorize parameters the consent form carries through to its POST.
const FORWARDED_FIELDS: [&str; 8] = [
    "response_type",
    "client_id",
    "redirect_uri",
    "code_challenge",
    "code_challenge_method",
    "state",
    "scope",
    "resource",
];

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
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

/// The page that asks for the secret, naming the host the code will go to.
pub(super) fn consent(form: &HashMap<String, String>, error: Option<&str>) -> String {
    let hidden: String = FORWARDED_FIELDS
        .iter()
        .filter_map(|key| {
            form.get(*key).map(|value| {
                format!(
                    "<input type=\"hidden\" name=\"{key}\" value=\"{}\">",
                    escape(value)
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
        .map(|message| format!("<p class=\"error\">{}</p>", escape(message)))
        .unwrap_or_default();
    page(
        "Connect to Kore",
        &format!(
            "<h1>Connect to Kore</h1><p><strong>{}</strong> is asking to use your notes. \
Paste the token you set in <code>KORE_MCP_TOKEN</code> to allow it.</p>{error}\
<form method=\"post\" action=\"/authorize\">{hidden}\
<input type=\"password\" name=\"secret\" autocomplete=\"current-password\" placeholder=\"Token\" autofocus required>\
<button type=\"submit\">Allow</button></form>",
            escape(host)
        ),
    )
}

pub(super) fn error(message: &str) -> String {
    page(
        "Kore",
        &format!(
            "<h1>Can't connect</h1><p class=\"error\">{}</p>",
            escape(message)
        ),
    )
}
