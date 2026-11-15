//! The MCP servers other apps on this Mac are configured to launch (Claude
//! Desktop, Claude Code, Cursor, Windsurf), read from each client's own config
//! file. One read-only capability: which servers launch the `kore` CLI, as
//! written. Other servers never leave this module, and of an entry's `env`
//! only `KORE_GRAPH` does: client configs hold other tools' tokens, and the
//! webview has no business seeing them. Which vault an entry is tied to is
//! `@kore/core` policy (`app/agent-skill.ts`).
//!
//! The second capability is the one-click connect: add a server entry to a
//! client's config (Claude Desktop, Cursor: their JSON file, after a backup
//! beside it; Claude Code: its own `claude mcp add --scope user`), removing
//! the entries the caller names. What entry to add and which old ones to
//! replace is core's decision.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::Value;

use crate::error::{AppError, AppResult};

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
    /// The entry's `env`, reduced to `KORE_GRAPH` when set.
    pub env: BTreeMap<String, String>,
}

/// A client the app can connect with one click.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpClient {
    ClaudeDesktop,
    ClaudeCode,
    Cursor,
}

impl McpClient {
    fn label(self) -> &'static str {
        match self {
            Self::ClaudeDesktop => "Claude Desktop",
            Self::ClaudeCode => "Claude Code",
            Self::Cursor => "Cursor",
        }
    }

    /// The JSON config for clients connected by editing a file.
    fn config_file(self) -> Option<PathBuf> {
        client_configs()
            .into_iter()
            .find(|(label, _)| *label == self.label())
            .map(|(_, path)| path)
            .filter(|_| self != Self::ClaudeCode)
    }
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

/// Whether `command` runs the `kore` CLI (by file name, any install path).
fn is_kore_cli(command: &str) -> bool {
    Path::new(command)
        .file_stem()
        .is_some_and(|stem| stem == "kore")
}

fn entry(client: &str, name: &str, server: &Value) -> Option<McpClientServer> {
    let command = server.get("command")?.as_str()?.to_string();
    if !is_kore_cli(&command) {
        return None;
    }
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
                .filter(|(key, _)| key.as_str() == "KORE_GRAPH")
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

/// Command: every `kore` MCP server the known clients on this machine launch.
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

/// Add `name` → `{command, args}` to the top-level `mcpServers` of a client's
/// config text, removing `replace` first. A malformed file is an error, never
/// overwritten. Pure (unit-tested).
fn with_server(
    raw: Option<&str>,
    name: &str,
    command: &str,
    args: &[String],
    replace: &[String],
) -> AppResult<String> {
    let mut config: Value = match raw {
        Some(raw) if !raw.trim().is_empty() => serde_json::from_str(raw).map_err(|err| {
            AppError::io(format!(
                "the config file isn't valid JSON, so Kore left it alone: {err}"
            ))
        })?,
        _ => Value::Object(serde_json::Map::new()),
    };
    let root = config.as_object_mut().ok_or_else(|| {
        AppError::io("the config file isn't a JSON object, so Kore left it alone")
    })?;
    let servers = root
        .entry("mcpServers")
        .or_insert_with(|| Value::Object(serde_json::Map::new()))
        .as_object_mut()
        .ok_or_else(|| AppError::io("mcpServers in the config file isn't an object"))?;
    for old in replace {
        servers.remove(old);
    }
    servers.insert(
        name.to_string(),
        serde_json::json!({ "command": command, "args": args }),
    );
    let mut text =
        serde_json::to_string_pretty(&config).map_err(|err| AppError::io(err.to_string()))?;
    text.push('\n');
    Ok(text)
}

fn connect_file(
    path: &Path,
    name: &str,
    command: &str,
    args: &[String],
    replace: &[String],
) -> AppResult<()> {
    let dir = path
        .parent()
        .ok_or_else(|| AppError::io("the config file has no folder"))?;
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => Some(raw),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(err.into()),
    };
    let next = with_server(raw.as_deref(), name, command, args, replace)?;
    if let Some(raw) = &raw {
        let mut backup = path.as_os_str().to_owned();
        backup.push(".kore-backup");
        std::fs::write(PathBuf::from(backup), raw)?;
    }
    std::fs::create_dir_all(dir)?;
    crate::capture::atomic_write_to(path, &next)
}

fn connect_claude_code(
    name: &str,
    command: &str,
    args: &[String],
    replace: &[String],
) -> AppResult<()> {
    let binary = crate::agent_cli::resolve_binary(crate::agent_cli::AgentCliBinary::Claude)
        .ok_or_else(|| {
            AppError::io("Claude Code isn't installed on this Mac (no `claude` command)")
        })?;
    let run = |argv: &[&str]| -> AppResult<std::process::Output> {
        let mut command = std::process::Command::new(&binary);
        crate::agent_cli::apply_gui_path(&mut command, &binary);
        Ok(command
            .args(argv)
            .stdin(std::process::Stdio::null())
            .output()?)
    };
    let mut removals: Vec<&str> = replace.iter().map(String::as_str).collect();
    if !removals.contains(&name) {
        removals.push(name);
    }
    for old in removals {
        // Absent entries fail here; that is the point of removing first.
        let _ = run(&["mcp", "remove", "--scope", "user", old])?;
    }
    let mut argv = vec!["mcp", "add", "--scope", "user", name, "--", command];
    argv.extend(args.iter().map(String::as_str));
    let output = run(&argv)?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(AppError::io(format!(
        "claude mcp add failed: {}",
        stderr.trim()
    )))
}

/// Command: add a server entry to one client's config, removing `replace`
/// (entry names) first. Claude Desktop and Cursor must already be installed:
/// a missing app folder is an error, not a new folder.
#[tauri::command]
pub async fn mcp_client_connect(
    client: McpClient,
    name: String,
    command: String,
    args: Vec<String>,
    replace: Vec<String>,
) -> AppResult<()> {
    crate::blocking::run_blocking(move || match client.config_file() {
        None => connect_claude_code(&name, &command, &args, &replace),
        Some(path) => {
            if !path.parent().is_some_and(Path::is_dir) {
                return Err(AppError::io(format!(
                    "{} isn't installed on this Mac",
                    client.label()
                )));
            }
            connect_file(&path, &name, &command, &args, &replace)
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn reads_kore_servers_only_and_drops_other_env() {
        let dir = tempdir().unwrap();
        let path = dir.path().join(".claude.json");
        let config = serde_json::json!({
            "mcpServers": { "kore": {
                "command": "/Applications/Kore.app/Contents/MacOS/kore",
                "args": ["--graph", "/Vaults/Brain", "mcp"],
            } },
            "projects": { "/code/app": { "mcpServers": {
                "brain": {
                    "type": "stdio", "command": "kore", "args": ["mcp"],
                    "env": { "KORE_GRAPH": "/Vaults/Brain", "API_TOKEN": "secret", "PORT": 1 },
                },
                "other": { "command": "npx", "args": ["--token", "secret"] },
            } } },
        });
        std::fs::write(&path, config.to_string()).unwrap();
        let servers = servers_in("Claude Code", &path);
        assert_eq!(servers.len(), 2, "other tools' servers never leave Rust");
        assert_eq!(servers[0].args, ["--graph", "/Vaults/Brain", "mcp"]);
        assert_eq!(servers[1].name, "brain");
        assert_eq!(
            servers[1].env,
            BTreeMap::from([("KORE_GRAPH".to_string(), "/Vaults/Brain".to_string())])
        );
        assert!(servers_in("Cursor", &dir.path().join("missing.json")).is_empty());
    }

    #[test]
    fn connect_adds_the_entry_keeps_the_rest_and_replaces_old_ones() {
        let raw = r#"{"globalShortcut":"Cmd+K","mcpServers":{"files":{"command":"npx"},"kore-brain":{"command":"kore","args":["--graph","/v","mcp"]}}}"#;
        let next = with_server(
            Some(raw),
            "kore",
            "/k/kore",
            &["mcp".to_string()],
            &["kore-brain".to_string()],
        )
        .unwrap();
        let value: Value = serde_json::from_str(&next).unwrap();
        assert_eq!(value["globalShortcut"], "Cmd+K");
        assert_eq!(value["mcpServers"]["files"]["command"], "npx");
        assert!(value["mcpServers"].get("kore-brain").is_none());
        assert_eq!(
            value["mcpServers"]["kore"],
            serde_json::json!({ "command": "/k/kore", "args": ["mcp"] })
        );
        assert!(with_server(Some("{ not json"), "kore", "/k/kore", &[], &[]).is_err());
        assert!(with_server(None, "kore", "/k/kore", &[], &[]).is_ok());
    }
}
