//! The vault's own kit script (Plan 34): run one Node script that lives in
//! the open graph — cyber-brain's `System/scripts/brain.mjs` — with an argv
//! the caller builds, never through a shell. Which script and which
//! arguments is `@reflect/core`'s policy (`cyber-brain/script.ts`); this
//! module owns only the capability: find `node`, keep the script inside the
//! graph, run it in the graph root, bound it, and hand back exit code and
//! capped output.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use tauri::Manager;

use crate::error::{AppError, AppResult};
use crate::process_tree;
use crate::routine_script::{run_bounded, ScriptTickOutcome};

/// A kit command writes a few lines and commits; anything slower is stuck.
const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MAX_TIMEOUT_MS: u64 = 60_000;
/// Arguments are one memory item each, not documents.
const MAX_ARGS: usize = 64;
const MAX_ARG_BYTES: usize = 16 * 1024;

/// Run `script` (graph-relative) under Node in the generation-pinned graph.
#[tauri::command]
pub async fn kit_script_run<R: tauri::Runtime>(
    script: String,
    args: Vec<String>,
    generation: u64,
    timeout_ms: Option<u64>,
    app: tauri::AppHandle<R>,
) -> AppResult<ScriptTickOutcome> {
    crate::blocking::run_blocking(move || {
        let root =
            crate::fs::root_for_generation(&app.state::<crate::fs::GraphState>(), generation)?;
        let node = crate::agent_cli::resolve_node().ok_or_else(|| {
            AppError::io("Node.js was not found: install Node 18 or newer to write memory")
        })?;
        run_kit_script(&node, &root, &script, &args, timeout_ms)
    })
    .await
}

fn run_kit_script(
    node: &Path,
    root: &Path,
    script: &str,
    args: &[String],
    timeout_ms: Option<u64>,
) -> AppResult<ScriptTickOutcome> {
    let script_path = kit_script_path(root, script)?;
    check_args(args)?;
    let mut command = Command::new(node);
    command.arg(&script_path).args(args).current_dir(root);
    crate::agent_cli::apply_gui_path(&mut command, node);
    process_tree::own_process_group(&mut command);
    let timeout =
        Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).min(MAX_TIMEOUT_MS));
    run_bounded(command, timeout, &AtomicBool::new(false))
        .map_err(|err| AppError::io(format!("could not start Node: {err}")))?
}

/// The script as an absolute path that stays inside the graph (traversal and
/// symlink guarded by `resolve`), is a regular file, and is a JS module.
fn kit_script_path(root: &Path, script: &str) -> AppResult<PathBuf> {
    if !(script.ends_with(".mjs") || script.ends_with(".js")) {
        return Err(AppError::io(format!("not a script: {script}")));
    }
    let resolved = crate::fs::resolve(root, script)?;
    let canonical = resolved
        .canonicalize()
        .map_err(|_| AppError::not_found(format!("the vault has no {script}")))?;
    if !canonical.starts_with(root.canonicalize()?) {
        return Err(AppError::traversal(format!(
            "script resolves outside the graph: {script:?}"
        )));
    }
    if !canonical.is_file() {
        return Err(AppError::not_found(format!("the vault has no {script}")));
    }
    Ok(canonical)
}

fn check_args(args: &[String]) -> AppResult<()> {
    if args.len() > MAX_ARGS {
        return Err(AppError::io("too many script arguments"));
    }
    if args
        .iter()
        .any(|arg| arg.len() > MAX_ARG_BYTES || arg.contains('\0'))
    {
        return Err(AppError::io("a script argument is too long or not text"));
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::fs;

    fn node() -> Option<PathBuf> {
        crate::agent_cli::resolve_node()
    }

    fn vault() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("System/scripts")).unwrap();
        fs::write(
            dir.path().join("System/scripts/brain.mjs"),
            "console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2) }));\n\
             if (process.argv.includes('--fail')) { console.error('error: nope'); process.exit(2) }\n",
        )
        .unwrap();
        dir
    }

    #[test]
    fn runs_the_vault_script_with_the_exact_argv_in_the_root() {
        let Some(node) = node() else { return };
        let dir = vault();
        let args = vec![
            "remember".to_string(),
            "--text=a; rm -rf / $(whoami)".to_string(),
        ];
        let outcome =
            run_kit_script(&node, dir.path(), "System/scripts/brain.mjs", &args, None).unwrap();
        assert_eq!(outcome.code, Some(0));
        let printed: serde_json::Value = serde_json::from_str(outcome.stdout.trim()).unwrap();
        assert_eq!(printed["args"], serde_json::json!(args));
        assert_eq!(
            PathBuf::from(printed["cwd"].as_str().unwrap())
                .canonicalize()
                .unwrap(),
            dir.path().canonicalize().unwrap()
        );
    }

    #[test]
    fn exit_code_and_stderr_pass_through() {
        let Some(node) = node() else { return };
        let dir = vault();
        let outcome = run_kit_script(
            &node,
            dir.path(),
            "System/scripts/brain.mjs",
            &["--fail".to_string()],
            None,
        )
        .unwrap();
        assert_eq!(outcome.code, Some(2));
        assert_eq!(outcome.stderr.trim(), "error: nope");
    }

    #[test]
    fn refuses_scripts_outside_the_graph_or_not_scripts() {
        let dir = vault();
        let outside = tempfile::tempdir().unwrap();
        fs::write(outside.path().join("evil.mjs"), "").unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("evil.mjs"),
            dir.path().join("System/scripts/link.mjs"),
        )
        .unwrap();
        for bad in [
            "../evil.mjs",
            "/etc/passwd.mjs",
            "System/scripts/link.mjs",
            "System/scripts/missing.mjs",
            "AGENTS.md",
        ] {
            assert!(
                kit_script_path(dir.path(), bad).is_err(),
                "{bad} was accepted"
            );
        }
        assert!(kit_script_path(dir.path(), "System/scripts/brain.mjs").is_ok());
    }

    #[test]
    fn refuses_oversized_or_binary_arguments() {
        assert!(check_args(&vec!["x".to_string(); MAX_ARGS + 1]).is_err());
        assert!(check_args(&["a\0b".to_string()]).is_err());
        assert!(check_args(&["x".repeat(MAX_ARG_BYTES + 1)]).is_err());
        assert!(check_args(&["--text=ciao".to_string()]).is_ok());
    }
}
