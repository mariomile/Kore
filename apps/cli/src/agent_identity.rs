//! Who an agent's write is attributed to (Plan 33, A1). The one rule for the
//! name, commit address and trailer an agent's commits carry: the always-on
//! host signs its commits with it, and the journal the app commits from
//! records it already resolved, so the app never re-derives it.

use serde::{Deserialize, Serialize};

/// Trailer naming the agent on its commits, read by the app's activity log.
pub const TRAILER: &str = "Kore-Agent";

/// Domain of the address an agent's commits carry.
const EMAIL_DOMAIN: &str = "agents.kore";

/// The agent behind a tool call from a caller without its own key (the
/// local stdio client, or the HTTP server's own secret).
pub const UNNAMED: &str = "MCP";

/// An agent as a git author.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentIdentity {
    pub name: String,
    pub email: String,
}

impl AgentIdentity {
    /// The agent behind an MCP caller. A caller without a usable name is the
    /// generic [`UNNAMED`] agent, never the vault's owner.
    pub fn for_caller(name: Option<&str>) -> Self {
        let name = name
            .map(display_name)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| UNNAMED.to_string());
        let email = format!("{}@{EMAIL_DOMAIN}", slug(&name));
        Self { name, email }
    }

    /// The `Kore-Agent: <name>` line closing the agent's commit messages.
    pub fn trailer(&self) -> String {
        format!("{TRAILER}: {}", self.name)
    }
}

/// One line, none of the characters git reserves for the address.
fn display_name(agent: &str) -> String {
    agent
        .chars()
        .map(|ch| {
            if ch.is_control() || "<>".contains(ch) {
                ' '
            } else {
                ch
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Lowercase ASCII letters, digits and dashes.
fn slug(name: &str) -> String {
    let slug = name
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "agent".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_cleaned_and_an_unnamed_caller_is_the_mcp_agent() {
        let grok = AgentIdentity::for_caller(Some("  Grok <bot>\n"));
        assert_eq!(grok.name, "Grok bot");
        assert_eq!(grok.email, "grok-bot@agents.kore");
        assert_eq!(grok.trailer(), "Kore-Agent: Grok bot");
        for unnamed in [None, Some(""), Some(" <> ")] {
            let identity = AgentIdentity::for_caller(unnamed);
            assert_eq!(identity.name, "MCP");
            assert_eq!(identity.email, "mcp@agents.kore");
        }
        assert_eq!(
            AgentIdentity::for_caller(Some("Ünïcode")).email,
            "n-code@agents.kore"
        );
    }
}
