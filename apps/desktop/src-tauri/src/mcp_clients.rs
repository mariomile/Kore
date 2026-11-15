//! The MCP servers other apps on this Mac are configured to launch (Claude
//! Desktop, Claude Code, Cursor, Windsurf), read from each client's own config
//! file. One read-only capability: which servers are configured, as written.
//! Whether one of them is Kore's, and which vault it is tied to, is
//! `@kore/core` policy (`app/agent-skill.ts`).

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::error::AppResult;

/// One configured server entry.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpClientServer {
    /// The client's display name ("Claude Desktop").
    pub client: String,
    /// The server's key in the client's config.
    pub name: String,
    pub command: String,
    pub args: Vec<String>,
    /// The entry's `env`, string values only.
    pub env: BTreeMap<String, String>,
}

/// Where each client keeps its JSON config. Missing files are skipped.
fn client_configs() -> Vec<(&'static str, PathBuf)> {
    let mut configs = Vec::new();
    if let Some(config) = dirs::config_dir() {
        configs.push((
            "Claude Desktop",
            config.join("Claude").join("claude_desktop_config.json"),
        ));
    }
    if let Some(home) = dirs::home_dir() {
        configs.push(("Claude Code", home.join(".claude.json")));
        configs.push(("Cursor", home.join(".cursor").join("mcp.json")));
        configs.push((
            "Windsurf",
            home.join(".codeium")
                .join("windsurf")
                .join("mcp_config.json"),
        ));
    }
    configs
}

/// Every entry under any `mcpServers` object in `value`, at any depth
/// (Claude Code keeps one per project as well as a global one).
fn collect(client: &str, value: &Value, out: &mut Vec<McpClientServer>) {
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                if key == "mcpServers" {
                    if let Value::Object(servers) = child {
                        for (name, server) in servers {
                            if let Some(entry) = entry(client, name, server) {
                                out.push(entry);
                            }
                        }
                    }
                } else {
                    collect(client, child, out);
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect(client, item, out)),
        _ => {}
    }
}

fn entry(client: &str, name: &str, server: &Value) -> Option<McpClientServer> {
    let command = server.get("command")?.as_str()?.to_string();
    let strings = |value: Option<&Value>| -> Vec<String> {
        value
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default()
    };
    let env = server
        .get("env")
        .and_then(Value::as_object)
        .map(|env| {
            env.iter()
                .filter_map(|(key, value)| Some((key.clone(), value.as_str()?.to_string())))
                .collect()
        })
        .unwrap_or_default();
    Some(McpClientServer {
        client: client.to_string(),
        name: name.to_string(),
        command,
        args: strings(server.get("args")),
        env,
    })
}

/// The servers configured in one client's file. An unreadable or malformed
/// file is no servers: this is a hint for the user, never a failure.
fn servers_in(client: &str, path: &Path) -> Vec<McpClientServer> {
    let mut out = Vec::new();
    if let Some(value) = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
    {
        collect(client, &value, &mut out);
    }
    out
}

/// Command: every MCP server the known clients on this machine launch.
#[tauri::command]
pub async fn mcp_client_servers() -> AppResult<Vec<McpClientServer>> {
    crate::blocking::run_blocking(|| {
        Ok(client_configs()
            .iter()
            .flat_map(|(client, path)| servers_in(client, path))
            .collect())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn reads_global_and_per_project_servers() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        let config = serde_json::json!({
            "mcpServers": { "kore": {
                "command": "/Applications/Kore.app/Contents/MacOS/kore",
                "args": ["--graph", "/Vaults/Brain", "mcp"],
            } },
            "projects": { "/code/app": { "mcpServers": { "other": {
                "type": "stdio", "command": "npx", "args": ["server"],
                "env": { "KORE_GRAPH": "/Vaults/Brain", "PORT": 1 },
            } } } },
        });
        std::fs::write(&path, config.to_string()).unwrap();
        let servers = servers_in("Claude Code", &path);
        assert_eq!(servers.len(), 2);
        assert_eq!(servers[0].args, ["--graph", "/Vaults/Brain", "mcp"]);
        assert_eq!(servers[1].name, "other");
        assert_eq!(
            servers[1].env,
            BTreeMap::from([("KORE_GRAPH".to_string(), "/Vaults/Brain".to_string())])
        );
        assert!(servers_in("Cursor", &dir.path().join("missing.json")).is_empty());
    }
}
