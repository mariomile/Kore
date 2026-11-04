//! Named agents' keys for `kore mcp --http`, kept in a file so a server with
//! no Kore app (an always-on box, a VPS) can still give each agent its own
//! key: `kore keys add/list/remove` edit it, and the server reads it on
//! every request, so adding or removing a key needs no restart.
//!
//! The file is JSON, mode 0600, outside the vault (it holds secrets):
//! `$KORE_MCP_KEYS_FILE`, else `$XDG_CONFIG_HOME/kore/mcp-agents.json`, else
//! `~/.config/kore/mcp-agents.json`. The Kore app keeps its own list in the
//! keychain and hands it to the server it runs as `KORE_MCP_AGENTS`.

use std::path::{Path, PathBuf};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::CliError;

/// Shortest key accepted, the same bar as the owner's secret.
pub const MIN_KEY_LEN: usize = 24;

/// One named agent's key.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentKey {
    /// Stable id: tokens issued from this key name it, so they stop working
    /// the moment the key is removed.
    pub id: String,
    /// The name the agent's writes are signed with.
    pub name: String,
    /// The secret the agent presents (bearer header or the consent page).
    pub key: String,
    /// Whether the agent may use the tools that write.
    #[serde(default)]
    pub write: bool,
}

impl AgentKey {
    fn usable(&self) -> bool {
        !self.id.is_empty() && !self.name.trim().is_empty() && self.key.len() >= MIN_KEY_LEN
    }
}

/// Where the keys file lives, from the environment.
pub fn default_path() -> Option<PathBuf> {
    let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    if let Some(path) = var("KORE_MCP_KEYS_FILE") {
        return Some(PathBuf::from(path));
    }
    let config = var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| var("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(config.join("kore").join("mcp-agents.json"))
}

/// The usable keys in `path`; a missing or unreadable file is none, so a
/// broken edit locks agents out rather than letting anyone in.
pub fn load(path: &Path) -> Vec<AgentKey> {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Vec<AgentKey>>(&bytes).ok())
        .unwrap_or_default()
        .into_iter()
        .filter(AgentKey::usable)
        .collect()
}

/// `KORE_MCP_AGENTS`: the app's list, as JSON. Unusable entries are an error
/// here, since the app wrote them and should hear about it.
pub fn parse_env(raw: &str) -> Result<Vec<AgentKey>, CliError> {
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    let agents: Vec<AgentKey> = serde_json::from_str(raw).map_err(|err| {
        CliError::Usage(format!(
            "KORE_MCP_AGENTS is not a list of agent keys: {err}"
        ))
    })?;
    if let Some(bad) = agents.iter().find(|agent| !agent.usable()) {
        return Err(CliError::Usage(format!(
            "agent key {:?} needs an id, a name and a key of at least {MIN_KEY_LEN} characters",
            bad.id
        )));
    }
    Ok(agents)
}

fn random(bytes: usize) -> String {
    let mut buffer = vec![0u8; bytes];
    getrandom::fill(&mut buffer).expect("the OS random number generator is unavailable");
    URL_SAFE_NO_PAD.encode(buffer)
}

fn save(path: &Path, agents: &[AgentKey]) -> Result<(), CliError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut text = serde_json::to_string_pretty(agents).expect("keys serialize");
    text.push('\n');
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, text)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(0o600))?;
    }
    std::fs::rename(&temp, path)?;
    Ok(())
}

/// Give `name` a new key (read-only unless `write`) and return it.
pub fn add(path: &Path, name: &str, write: bool) -> Result<AgentKey, CliError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(CliError::Usage("give the agent a name".into()));
    }
    let mut agents = load(path);
    if agents
        .iter()
        .any(|agent| agent.name.eq_ignore_ascii_case(name))
    {
        return Err(CliError::Usage(format!(
            "an agent called {name:?} already has a key; remove it first"
        )));
    }
    let agent = AgentKey {
        id: random(9),
        name: name.to_string(),
        key: random(32),
        write,
    };
    agents.push(agent.clone());
    save(path, &agents)?;
    Ok(agent)
}

/// Remove the key named `name` (case-insensitive); false when none matched.
pub fn remove(path: &Path, name: &str) -> Result<bool, CliError> {
    let mut agents = load(path);
    let before = agents.len();
    agents.retain(|agent| !agent.name.eq_ignore_ascii_case(name.trim()));
    if agents.len() == before {
        return Ok(false);
    }
    save(path, &agents)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_are_added_listed_and_removed_by_name_in_a_private_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("kore").join("mcp-agents.json");
        let grok = add(&path, "Grok bot", false).unwrap();
        assert!(grok.key.len() >= MIN_KEY_LEN && !grok.write);
        assert!(add(&path, "grok BOT", true).is_err());
        add(&path, "ChatGPT", true).unwrap();
        assert_eq!(load(&path).len(), 2);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        assert!(remove(&path, "grok bot").unwrap());
        assert!(!remove(&path, "grok bot").unwrap());
        assert_eq!(load(&path)[0].name, "ChatGPT");
    }
}
