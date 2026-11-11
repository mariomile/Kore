//! Agents' proposals (Plan 33, A2). The bundled CLI keeps the writes a
//! "propose" key asked for and is the one place that can carry them out
//! (`kore proposals`, which rebuilds each call through its MCP tool table),
//! so the app runs it instead of re-implementing that table. One capability:
//! run `kore proposals <list | accept id | reject id>` on the open graph and
//! hand back its JSON. What to show and when to ask is `@kore/core`.

use std::ffi::OsString;
use std::path::Path;
use std::process::{Command, Stdio};

use serde::Deserialize;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::fs::{root_for_generation, GraphState};

/// What `kore proposals` is asked to do.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ProposalAction {
    List,
    Accept,
    Reject,
}

/// The CLI's argv for `action` on the graph at `root`.
fn proposals_args(
    root: &Path,
    action: ProposalAction,
    id: Option<&str>,
) -> AppResult<Vec<OsString>> {
    let mut args: Vec<OsString> = vec![
        "--graph".into(),
        root.into(),
        "--json".into(),
        "proposals".into(),
    ];
    match (action, id) {
        (ProposalAction::List, _) => args.push("list".into()),
        (ProposalAction::Accept, Some(id)) => args.extend(["accept".into(), id.into()]),
        (ProposalAction::Reject, Some(id)) => args.extend(["reject".into(), id.into()]),
        (_, None) => return Err(AppError::io("a proposal id is needed")),
    }
    Ok(args)
}

/// Command: run `kore proposals` for the graph of `generation` and return
/// its `--json` output. A failure carries the CLI's own message.
#[tauri::command]
pub async fn proposals_run(
    generation: u64,
    action: ProposalAction,
    id: Option<String>,
    graph: State<'_, GraphState>,
) -> AppResult<serde_json::Value> {
    let root = root_for_generation(&graph, generation)?;
    let args = proposals_args(&root, action, id.as_deref())?;
    let cli = crate::skill::cli_path()?;
    crate::blocking::run_blocking(move || {
        let output = Command::new(cli)
            .args(args)
            // The app is the owner: never run as some agent's tool call.
            .env_remove("KORE_AGENT")
            .env_remove("KORE_AGENT_EMAIL")
            .env_remove("KORE_AGENT_GRAPH")
            .env_remove("KORE_GRAPH")
            .stdin(Stdio::null())
            .output()?;
        if !output.status.success() {
            let message = String::from_utf8_lossy(&output.stderr);
            let message = message.trim().trim_start_matches("kore: ");
            return Err(AppError::io(if message.is_empty() {
                format!("kore proposals exited with {}", output.status)
            } else {
                message.to_string()
            }));
        }
        serde_json::from_slice(&output.stdout)
            .map_err(|err| AppError::parse(format!("kore proposals: {err}")))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn each_action_is_one_proposals_subcommand_and_decisions_need_an_id() {
        let root = Path::new("/vault");
        let tail = |action, id| {
            proposals_args(root, action, id).map(|args| {
                args[3..]
                    .iter()
                    .map(|a| a.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
            })
        };
        assert_eq!(
            tail(ProposalAction::List, None).unwrap(),
            ["proposals", "list"]
        );
        assert_eq!(
            tail(ProposalAction::Accept, Some("17-a")).unwrap(),
            ["proposals", "accept", "17-a"]
        );
        assert_eq!(
            tail(ProposalAction::Reject, Some("17-a")).unwrap(),
            ["proposals", "reject", "17-a"]
        );
        assert!(proposals_args(root, ProposalAction::Accept, None).is_err());
        assert_eq!(
            proposals_args(root, ProposalAction::List, None).unwrap()[..3],
            [OsString::from("--graph"), "/vault".into(), "--json".into()]
        );
    }
}
