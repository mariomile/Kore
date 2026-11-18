//! `kore cloud`: Kore Cloud, the vault always on in the user's own
//! Cloudflare account (Plan 34). The work runs in the bundled
//! `kore-cloud.mjs` under Node, which talks to Cloudflare and to the Worker;
//! this command only finds the script, hands it the vault and the config
//! file, and passes the terminal through so the token prompt stays hidden.
//!
//! The config file holds the Worker's URL and the owner key, mode 0600,
//! outside the vault: `$KORE_CLOUD_FILE`, else
//! `$XDG_CONFIG_HOME/kore/cloud.json`, else `~/.config/kore/cloud.json`.
//! The Cloudflare token is never stored: it comes from
//! `KORE_CLOUDFLARE_TOKEN` or the hidden prompt, and reaches Node through the
//! inherited environment, never the command line.

use std::path::{Path, PathBuf};
use std::process::Command;

use clap::Subcommand;

use crate::error::CliError;

/// The bundled script's file name, looked up next to the `kore` binary.
pub const CLOUD_SCRIPT: &str = "kore-cloud.mjs";

#[derive(Subcommand, Debug)]
pub enum CloudAction {
    /// Create Kore Cloud in your Cloudflare account (or update it) and
    /// upload the vault's notes; opens nothing until you paste a token
    Setup {
        /// The Cloudflare account id, when your token reaches several
        #[arg(long)]
        account: Option<String>,
        /// The Worker's name, which is part of its URL (default kore-cloud)
        #[arg(long)]
        name: Option<String>,
    },
    /// Upload the notes Kore Cloud does not have yet (no token needed)
    Upload,
    /// Print the owner key, which approves an agent on Kore Cloud's sign-in page
    Key,
    /// Print the Cloudflare page that creates a token with the right permissions
    TokenUrl,
}

/// Where the config file lives, from the environment.
pub fn config_path() -> Option<PathBuf> {
    let var = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    if let Some(path) = var("KORE_CLOUD_FILE") {
        return Some(PathBuf::from(path));
    }
    let config = var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .or_else(|| var("HOME").map(|home| PathBuf::from(home).join(".config")))?;
    Some(config.join("kore").join("cloud.json"))
}

fn cloud_script() -> Result<PathBuf, CliError> {
    if let Some(path) = std::env::var_os("KORE_CLOUD_SCRIPT").filter(|path| !path.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let exe = std::env::current_exe()?;
    let beside = exe.with_file_name(CLOUD_SCRIPT);
    if beside.is_file() {
        return Ok(beside);
    }
    Err(CliError::runtime(format!(
        "{CLOUD_SCRIPT} not found next to {}; set KORE_CLOUD_SCRIPT to its path \
         (build it with `pnpm --filter @kore/cloud build:setup`)",
        exe.display()
    )))
}

/// The script's arguments for `action`.
fn script_args(action: &CloudAction, vault: Option<&Path>, config: &Path) -> Vec<String> {
    let mut args = Vec::new();
    let mut push = |values: &[&str]| args.extend(values.iter().map(|value| (*value).to_owned()));
    match action {
        CloudAction::Setup { .. } => push(&["setup"]),
        CloudAction::Upload => push(&["upload"]),
        CloudAction::Key => push(&["key"]),
        CloudAction::TokenUrl => push(&["token-url"]),
    }
    if let Some(vault) = vault {
        args.extend(["--vault".to_owned(), vault.display().to_string()]);
    }
    args.extend(["--config".to_owned(), config.display().to_string()]);
    if let CloudAction::Setup { account, name } = action {
        if let Some(account) = account {
            args.extend(["--account".to_owned(), account.clone()]);
        }
        if let Some(name) = name {
            args.extend(["--name".to_owned(), name.clone()]);
        }
    }
    args
}

/// True for the actions that work on a vault.
pub fn needs_vault(action: &CloudAction) -> bool {
    matches!(action, CloudAction::Setup { .. } | CloudAction::Upload)
}

/// Run `action` through the bundled script, on `vault` when it needs one.
pub fn run(action: &CloudAction, vault: Option<&Path>) -> Result<(), CliError> {
    let config = config_path().ok_or_else(|| {
        CliError::Usage("set KORE_CLOUD_FILE or HOME to say where Kore Cloud's key lives".into())
    })?;
    let script = cloud_script()?;
    let node = std::env::var_os("KORE_NODE")
        .filter(|node| !node.is_empty())
        .unwrap_or_else(|| "node".into());
    let status = Command::new(&node)
        .arg(&script)
        .args(script_args(action, vault, &config))
        .status()
        .map_err(|err| {
            CliError::runtime(format!(
                "could not start Node ({}): {err}; install Node 22 or set KORE_NODE",
                Path::new(&node).display()
            ))
        })?;
    if status.success() {
        Ok(())
    } else {
        // The script has already said what went wrong.
        Err(CliError::runtime("Kore Cloud stopped (see above)"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn setup_passes_vault_config_and_options() {
        let action = CloudAction::Setup {
            account: Some("abc".into()),
            name: None,
        };
        let args = script_args(&action, Some(Path::new("/v")), Path::new("/c.json"));
        assert_eq!(
            args,
            [
                "setup",
                "--vault",
                "/v",
                "--config",
                "/c.json",
                "--account",
                "abc"
            ]
        );
    }

    #[test]
    fn key_needs_no_vault() {
        assert!(!needs_vault(&CloudAction::Key));
        assert!(needs_vault(&CloudAction::Upload));
        let args = script_args(&CloudAction::Key, None, Path::new("/c.json"));
        assert_eq!(args, ["key", "--config", "/c.json"]);
    }
}
