//! `kore brain` — write memory through the vault's own kit script (Plan 35).
//!
//! A vault that declares `cyber_brain:` in its `AGENTS.md` frontmatter keeps
//! memory with its own `brain.mjs`; this command runs that script with the
//! kit's own argv (`kore brain remember --kind=fact --text=…`), so a fact,
//! loop or decision written through Kore (its chat, `kore mcp` for ChatGPT
//! or Grok) lands exactly as one Claude Code writes, with its run record
//! and commit. Kore adds three things and nothing else: only the kit's
//! write commands pass ([`kore_kit_script::check_kit_args`]), the run
//! record is signed with the calling agent's name, and the script runs only
//! once the user allowed its current content (`kore brain trust`).
//!
//! `kore brain` alone (or `kore brain status`) reports whether the kit is on
//! and whether its script is allowed.

use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use kore_kit_script::{
    agent_slug, check_kit_args, check_kit_target, detect, trust, trust_state, untrusted_message,
    Kit,
};
use serde_json::json;

use crate::error::CliError;
use crate::graph::Graph;

/// A kit command writes a few lines and commits; anything slower is stuck.
const TIMEOUT: Duration = Duration::from_secs(30);

/// Output a kit command may print before the rest is dropped.
const MAX_OUTPUT_BYTES: usize = 64 * 1024;

const NO_KIT: &str =
    "this vault has no cyber-brain contract (`cyber_brain:` in the frontmatter of AGENTS.md)";

pub fn run(graph: &Graph, json: bool, args: &[String]) -> Result<(), CliError> {
    let kit = detect(&graph.root).ok_or_else(|| CliError::Usage(NO_KIT.to_string()))?;
    match args.first().map(String::as_str) {
        None | Some("status") => status(&graph.root, &kit, json),
        Some("trust") => allow(&graph.root, &kit, json),
        Some(_) => write(&graph.root, &kit, json, args),
    }
}

fn status(root: &Path, kit: &Kit, json: bool) -> Result<(), CliError> {
    let state = trust_state(root, kit)
        .map_err(|err| CliError::runtime(format!("could not read {}: {err}", kit.scripts_dir())))?;
    if json {
        println!(
            "{}",
            json!({
                "kit": "cyber-brain",
                "version": kit.version,
                "script": kit.script,
                "trust": state.label(),
                "digest": state.digest(),
            })
        );
    } else {
        println!(
            "cyber-brain {} · {} · script {}",
            kit.version,
            kit.script,
            state.label()
        );
    }
    Ok(())
}

fn allow(root: &Path, kit: &Kit, json: bool) -> Result<(), CliError> {
    let state = trust_state(root, kit)
        .map_err(|err| CliError::runtime(format!("could not read {}: {err}", kit.scripts_dir())))?;
    trust(root, state.digest())
        .map_err(|err| CliError::runtime(format!("could not record the allowed script: {err}")))?;
    if json {
        println!(
            "{}",
            json!({ "trust": "trusted", "digest": state.digest(), "script": kit.script })
        );
    } else {
        println!("allowed {} ({})", kit.script, &state.digest()[..12]);
    }
    Ok(())
}

/// The kit's argv with the run record signed by the calling agent: the
/// agent's own name when a tool call runs this (`kore mcp` sets it), else
/// `kore`. A caller-supplied `--agent` never survives, so an agent cannot
/// sign as another.
fn signed_args(args: &[String], agent: Option<&str>) -> Vec<String> {
    let words = args.iter().take_while(|arg| !arg.starts_with("--")).count();
    let mut signed: Vec<String> = args[..words].to_vec();
    signed.push(format!("--agent={}", agent_slug(agent.unwrap_or("kore"))));
    signed.extend(
        args[words..]
            .iter()
            .filter(|arg| *arg != "--agent" && !arg.starts_with("--agent="))
            .cloned(),
    );
    signed
}

fn write(root: &Path, kit: &Kit, json: bool, args: &[String]) -> Result<(), CliError> {
    check_kit_args(args).map_err(CliError::Usage)?;
    check_kit_target(root, kit, args).map_err(CliError::runtime)?;
    let state = trust_state(root, kit)
        .map_err(|err| CliError::runtime(format!("could not read {}: {err}", kit.scripts_dir())))?;
    if !state.is_trusted() {
        return Err(CliError::runtime(untrusted_message(&state)));
    }
    let script = script_path(root, kit)?;
    let node = resolve_node().ok_or_else(|| {
        CliError::runtime("Node.js was not found: install Node 18 or newer to write memory")
    })?;
    let agent = std::env::var(crate::write::AGENT_ENV).ok();
    let argv = signed_args(args, agent.as_deref());
    let outcome = run_bounded(&node, &script, root, &argv)?;
    if outcome.timed_out {
        return Err(CliError::runtime(
            "the memory script did not finish in time",
        ));
    }
    if outcome.code != Some(0) {
        let last = failure_line(&outcome.stderr);
        return Err(CliError::runtime(if last.is_empty() {
            format!(
                "the memory script exited with code {}",
                outcome
                    .code
                    .map_or("?".to_string(), |code| code.to_string())
            )
        } else {
            last.to_string()
        }));
    }
    let output = outcome.stdout.trim();
    if json {
        println!(
            "{}",
            json!({ "ok": true, "output": output, "commit": commit_of(output) })
        );
    } else if !output.is_empty() {
        println!("{output}");
    }
    Ok(())
}

/// The line that says why the kit failed: its own `error: …` refusal, or a
/// crash's `Error: …` (the last line of a Node stack is only its version).
fn failure_line(stderr: &str) -> &str {
    let lines: Vec<&str> = stderr
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let line = lines
        .iter()
        .rev()
        .find(|line| {
            line.starts_with("error:") || line.starts_with("Error:") || line.contains("Error: ")
        })
        .or(lines.last())
        .copied()
        .unwrap_or("");
    line.strip_prefix("error:").unwrap_or(line).trim()
}

/// The commit the kit reports as `(commit <sha>)` at the end of a line.
fn commit_of(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        let rest = line.trim_end().strip_suffix(')')?;
        let at = rest.rfind("(commit ")?;
        let sha = &rest[at + "(commit ".len()..];
        (sha.len() >= 4 && sha.chars().all(|ch| ch.is_ascii_hexdigit())).then(|| sha.to_string())
    })
}

/// The entry script as a file inside the graph (a symlink out is refused).
fn script_path(root: &Path, kit: &Kit) -> Result<PathBuf, CliError> {
    let missing = || CliError::NotFound(format!("the vault has no {}", kit.script));
    let canonical = root
        .join(&kit.script)
        .canonicalize()
        .map_err(|_| missing())?;
    let inside = root
        .canonicalize()
        .map(|root| canonical.starts_with(root))
        .unwrap_or(false);
    if !inside {
        return Err(CliError::Usage(format!(
            "{} resolves outside the vault",
            kit.script
        )));
    }
    if !canonical.is_file() {
        return Err(missing());
    }
    Ok(canonical)
}

/// `node` on PATH, then where installers put it when PATH is a GUI app's
/// minimal one (the desktop's `resolve_node` probes the same places).
fn resolve_node() -> Option<PathBuf> {
    let name = if cfg!(windows) { "node.exe" } else { "node" };
    let mut probes: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| {
            std::env::split_paths(&path)
                .map(|dir| dir.join(name))
                .collect()
        })
        .unwrap_or_default();
    probes.extend(
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
            .iter()
            .map(|dir| Path::new(dir).join(name)),
    );
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        probes.extend(
            [".volta/bin", ".local/bin", ".bun/bin"]
                .iter()
                .map(|dir| home.join(dir).join(name)),
        );
    }
    probes.into_iter().find(|path| path.is_file())
}

struct Outcome {
    code: Option<i32>,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

fn drain(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<String> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(pipe) = pipe {
            let _ = pipe.take(MAX_OUTPUT_BYTES as u64).read_to_end(&mut bytes);
        }
        String::from_utf8_lossy(&bytes).into_owned()
    })
}

/// Run the script with no shell and no stdin, killed at [`TIMEOUT`].
fn run_bounded(
    node: &Path,
    script: &Path,
    root: &Path,
    args: &[String],
) -> Result<Outcome, CliError> {
    let mut child = Command::new(node)
        .arg(script)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| CliError::runtime(format!("could not start Node: {err}")))?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    let deadline = Instant::now() + TIMEOUT;
    let (code, timed_out) = loop {
        match child.try_wait() {
            Ok(Some(status)) => break (status.code(), false),
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                break (None, true);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(err) => {
                let _ = child.kill();
                return Err(CliError::runtime(format!(
                    "could not wait for the memory script: {err}"
                )));
            }
        }
    };
    Ok(Outcome {
        code,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
        timed_out,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| (*word).to_string()).collect()
    }

    #[test]
    fn the_calling_agent_signs_and_a_forged_agent_is_dropped() {
        let signed = signed_args(
            &strings(&["loop", "open", "--agent=boss", "--title=x", "--agent"]),
            Some("ChatGPT"),
        );
        assert_eq!(
            signed,
            strings(&["loop", "open", "--agent=chatgpt", "--title=x"])
        );
        let plain = signed_args(&strings(&["remember", "--text=a"]), None);
        assert_eq!(plain, strings(&["remember", "--agent=kore", "--text=a"]));
    }

    #[test]
    fn a_crash_reports_its_error_not_the_node_version() {
        let crash = "node:fs:440\n    return binding.readFileUtf8(path);\n\nError: ENOENT: no such file, open 'System/memory/loops.md'\n    at loopOpen (brain.mjs:450:42)\n\nNode.js v22.23.4\n";
        assert_eq!(
            failure_line(crash),
            "Error: ENOENT: no such file, open 'System/memory/loops.md'"
        );
        assert_eq!(
            failure_line("error: looks like a secret\n"),
            "looks like a secret"
        );
        assert_eq!(failure_line("something odd\n"), "something odd");
    }

    #[test]
    fn reads_the_commit_the_kit_reports() {
        assert_eq!(
            commit_of("stored fact in CRM/Alice.md (commit 1a2b3c4)"),
            Some("1a2b3c4".to_string())
        );
        assert_eq!(commit_of("queued to inbox"), None);
        assert_eq!(commit_of("(commit nothex)"), None);
    }

    #[cfg(unix)]
    #[test]
    fn runs_only_an_allowed_script_and_relays_its_refusal() {
        let dir = tempfile::tempdir().expect("tempdir");
        let root = dir.path();
        std::fs::write(
            root.join("AGENTS.md"),
            "---\ncyber_brain: \"0.1\"\n---\n# Vault\n",
        )
        .expect("contract");
        std::fs::create_dir_all(root.join("System/scripts")).expect("scripts");
        std::fs::write(
            root.join("System/scripts/brain.mjs"),
            "const a = process.argv.slice(2);\n\
             if (a.some((x) => x.includes('secret'))) { console.error('error: looks like a secret'); process.exit(2) }\n\
             console.log('stored ' + a.join(' ') + ' (commit abc1234)')\n",
        )
        .expect("brain");
        let kit = detect(root).expect("kit");
        let args = strings(&["remember", "--text=hello"]);

        // Never allowed: refused before Node runs.
        let refused = write(root, &kit, false, &args).expect_err("untrusted");
        assert!(refused.to_string().contains("new on this Mac"));

        if resolve_node().is_none() {
            return;
        }
        allow(root, &kit, false).expect("allow");
        write(root, &kit, true, &args).expect("runs");
        let secret = write(root, &kit, false, &strings(&["remember", "--text=secret"]))
            .expect_err("kit refusal");
        assert_eq!(secret.to_string(), "looks like a secret");

        // Editing the script takes the permission back.
        std::fs::write(root.join("System/scripts/brain.mjs"), "console.log(1)\n").expect("edit");
        let changed = write(root, &kit, false, &args).expect_err("changed");
        assert!(changed.to_string().contains("changed since"));
    }
}
