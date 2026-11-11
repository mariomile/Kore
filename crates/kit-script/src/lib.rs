//! The vault's own memory kit (Plan 35), shared by the desktop shell and the
//! `kore` CLI. A vault opts in by declaring `cyber_brain:` in the frontmatter
//! of its `AGENTS.md`; memory is then written only by the vault's own script
//! (`<system>/scripts/brain.mjs`), the same code every other agent runs, so
//! Kore never re-implements the kit's formats.
//!
//! The script is code that arrives with the vault, and a synced vault can
//! change it from another machine. So nothing here runs it until the user
//! has allowed that exact content: [`digest`] hashes the whole scripts
//! folder (the entry point imports its siblings), and [`trust_state`] says
//! whether the digest matches the one the user last allowed on this
//! machine ([`TRUST_PATH`], beside the index, never synced as a note).
//!
//! What this crate does not do: spawn Node (each surface has its own
//! process plumbing) or decide which memory a turn writes (policy lives with
//! the callers). It answers three questions the same way for both: is the
//! kit on, which script, and may it run.

use std::fmt::Write as _;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use kore_note_policy::{parse_frontmatter, split_frontmatter};
use saphyr::{LoadableYamlNode, Scalar, Yaml};
use sha2::{Digest, Sha256};

/// The contract file whose frontmatter switches the kit on.
pub const CONTRACT_PATH: &str = "AGENTS.md";

/// Where this machine keeps the digest of the script the user allowed.
pub const TRUST_PATH: &str = ".kore/kit-trust.json";

/// The kit's own default for `paths.system`.
const DEFAULT_SYSTEM: &str = "System";

/// The script, relative to the system folder.
const SCRIPT_IN_SYSTEM: &str = "scripts/brain.mjs";

/// Bounds on the scripts folder the digest walks: a kit is a handful of
/// modules, so anything bigger is not a kit and is refused, not hashed.
const MAX_DIGEST_FILES: usize = 400;
const MAX_DIGEST_DEPTH: usize = 12;

/// Arguments are one memory item each, never documents.
pub const MAX_ARGS: usize = 64;
pub const MAX_ARG_BYTES: usize = 16 * 1024;

/// The kit subcommands Kore may run: the writes the kit's skills teach, and
/// `check`. Reads such as `facts` stay out: they print lines from any note,
/// private ones included, and Kore's own read paths already gate privacy.
pub const KIT_COMMANDS: &[&[&str]] = &[
    &["remember"],
    &["loop", "open"],
    &["loop", "update"],
    &["loop", "close"],
    &["decision", "new"],
    &["check"],
];

/// The kit as the vault declares it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Kit {
    /// The `cyber_brain:` value (the kit's contract version).
    pub version: String,
    /// `paths.system`, graph-relative.
    pub system: String,
    /// The entry script, graph-relative (`<system>/scripts/brain.mjs`).
    pub script: String,
}

impl Kit {
    /// The folder the digest covers: the entry script's own.
    pub fn scripts_dir(&self) -> String {
        match self.script.rsplit_once('/') {
            Some((dir, _)) => dir.to_string(),
            None => String::new(),
        }
    }
}

/// A graph-relative folder that cannot leave the graph: no absolute path,
/// no backslash, no empty, `.` or `..` segment. Mirrors `isSafeVaultFolder`
/// in `packages/core/src/cyber-brain/config.ts`.
pub fn is_safe_vault_folder(path: &str) -> bool {
    // `C:…` is a drive on Windows: `Path::join` would replace the vault.
    let drive = path.as_bytes().get(1) == Some(&b':') && path.as_bytes()[0].is_ascii_alphabetic();
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || drive {
        return false;
    }
    path.split('/')
        .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn scalar_text(node: &Yaml) -> Option<String> {
    match node {
        Yaml::Value(Scalar::String(text)) => Some(text.trim().to_string()),
        Yaml::Value(Scalar::Integer(number)) => Some(number.to_string()),
        Yaml::Value(Scalar::FloatingPoint(number)) => Some(number.into_inner().to_string()),
        _ => None,
    }
}

/// The kit declared by a contract's source, or `None` when the frontmatter
/// has no `cyber_brain:` key, does not parse, or marks the contract private
/// (the user withheld the rules, so Kore does not act on them). A bad
/// `paths.system` falls back to the kit's default, as the TS loader does.
pub fn parse_contract(source: &str) -> Option<Kit> {
    let raw = split_frontmatter(source).raw?;
    if parse_frontmatter(Some(raw)).private {
        return None;
    }
    let documents = Yaml::load_from_str(raw).ok()?;
    let document = documents.first()?;
    let version = document
        .as_mapping_get("cyber_brain")
        .and_then(scalar_text)?;
    let system = document
        .as_mapping_get("paths")
        .and_then(|paths| paths.as_mapping_get("system"))
        .and_then(scalar_text)
        .filter(|path| is_safe_vault_folder(path))
        .unwrap_or_else(|| DEFAULT_SYSTEM.to_string());
    let script = format!("{system}/{SCRIPT_IN_SYSTEM}");
    Some(Kit {
        version,
        system,
        script,
    })
}

/// The kit of the graph at `root`, read from its `AGENTS.md`.
pub fn detect(root: &Path) -> Option<Kit> {
    let source = fs::read_to_string(root.join(CONTRACT_PATH)).ok()?;
    parse_contract(&source)
}

/// Whether a file outside `node_modules` is code Node could load: a module,
/// a native addon, WebAssembly, JSON, or an extensionless file `require`
/// resolves. Notes beside the scripts (`README.md`) are not.
fn is_code(name: &str) -> bool {
    let stem = name.trim_start_matches('.');
    !stem.contains('.')
        || [
            ".mjs", ".js", ".cjs", ".json", ".mts", ".cts", ".ts", ".node", ".wasm",
        ]
        .iter()
        .any(|suffix| name.ends_with(suffix))
}

/// Bytes the digest reads at most: a kit is a few small scripts, so a
/// folder past this is refused rather than half pinned.
const MAX_DIGEST_BYTES: u64 = 32 * 1024 * 1024;

struct Collected {
    /// `(path relative to the vault, absolute path)`.
    files: Vec<(String, PathBuf)>,
    bytes: u64,
}

impl Collected {
    fn push(&mut self, relative: String, path: PathBuf) -> io::Result<()> {
        // A symlink counts by what it points at, and by the bytes Node
        // would load through it; a link to a folder is refused, since
        // following it could leave the vault or loop.
        let target = fs::metadata(&path)?;
        if !target.is_file() {
            return Err(io::Error::other(format!(
                "the kit's {relative} links to something that is not a file"
            )));
        }
        self.bytes += target.len();
        self.files.push((relative, path));
        if self.files.len() > MAX_DIGEST_FILES || self.bytes > MAX_DIGEST_BYTES {
            return Err(io::Error::other(format!(
                "the kit's code is larger than Kore pins ({MAX_DIGEST_FILES} files, {} MB)",
                MAX_DIGEST_BYTES / (1024 * 1024)
            )));
        }
        Ok(())
    }
}

/// Every file under `dir` Node could load, hidden ones included. Inside a
/// `node_modules` folder every file counts, whatever its name.
fn collect(
    dir: &Path,
    prefix: &str,
    depth: usize,
    in_modules: bool,
    out: &mut Collected,
) -> io::Result<()> {
    if depth > MAX_DIGEST_DEPTH {
        return Err(io::Error::other(format!(
            "the kit's code nests deeper than {MAX_DIGEST_DEPTH} folders"
        )));
    }
    let mut entries: Vec<_> = fs::read_dir(dir)?.collect::<io::Result<_>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name().to_string_lossy().into_owned();
        let relative = format!("{prefix}/{name}");
        let kind = entry.file_type()?;
        if kind.is_dir() {
            let modules = in_modules || name == "node_modules";
            collect(&entry.path(), &relative, depth + 1, modules, out)?;
        } else if (kind.is_symlink() || kind.is_file()) && (in_modules || is_code(&name)) {
            out.push(relative, entry.path())?;
        }
    }
    Ok(())
}

/// Every quoted relative specifier (`'./x.mjs'`, `"../y"`) in `source`: a
/// superset of what its `import`, `import()` and `require` name, so a
/// module the kit pulls in from outside its folder is pinned too.
fn relative_specifiers(source: &str) -> Vec<&str> {
    let mut found = Vec::new();
    for quote in ['"', '\'', '`'] {
        let mut rest = source;
        while let Some(start) = rest.find(quote) {
            let after = &rest[start + 1..];
            let Some(end) = after.find([quote, '\n']) else {
                break;
            };
            let literal = &after[..end];
            if literal.starts_with("./") || literal.starts_with("../") {
                found.push(literal);
            }
            rest = &after[end..];
            rest = rest.strip_prefix(quote).unwrap_or(rest);
        }
    }
    found
}

/// Add, transitively, every vault file a pinned module names by a relative
/// specifier, the way Node resolves it (exact, then `.js`/`.mjs`/`.cjs`/
/// `.json`, then `index.js`). A specifier that resolves outside the vault
/// is refused: Kore cannot pin it. A computed `import(x)` is out of reach of
/// any static scan; the kit's own scripts use none.
fn follow_relative_imports(root: &Path, out: &mut Collected) -> io::Result<()> {
    let base = fs::canonicalize(root)?;
    let mut seen: std::collections::HashSet<PathBuf> = out
        .files
        .iter()
        .filter_map(|(_, path)| fs::canonicalize(path).ok())
        .collect();
    let mut queue: Vec<PathBuf> = seen.iter().cloned().collect();
    while let Some(file) = queue.pop() {
        let Ok(source) = fs::read_to_string(&file) else {
            continue;
        };
        let Some(dir) = file.parent() else {
            continue;
        };
        for specifier in relative_specifiers(&source) {
            let plain = dir.join(specifier);
            let candidates = [
                plain.clone(),
                plain.with_extension("js"),
                plain.with_extension("mjs"),
                plain.with_extension("cjs"),
                plain.with_extension("json"),
                plain.join("index.js"),
            ];
            let Some(found) = candidates
                .iter()
                .find_map(|candidate| fs::canonicalize(candidate).ok().filter(|p| p.is_file()))
            else {
                continue;
            };
            if !found.starts_with(&base) {
                return Err(io::Error::other(format!(
                    "the kit's code loads {specifier}, which is outside the vault"
                )));
            }
            if seen.insert(found.clone()) {
                let relative = found
                    .strip_prefix(&base)
                    .map(|path| path.to_string_lossy().replace('\\', "/"))
                    .unwrap_or_default();
                out.push(relative, found.clone())?;
                queue.push(found);
            }
        }
    }
    Ok(())
}

/// Lowercase-hex SHA-256 over the code the kit's script can load: every
/// code file of the scripts folder (hidden files, `node_modules` and the
/// files symlinks point at included), plus the `package.json` and
/// `node_modules` of each folder above it up to the vault root, where Node
/// resolves packages and module settings. Each entry's vault path and bytes,
/// in path order: any edit, added or removed module changes it. Code past
/// the size limits fails, so it can never be allowed half pinned.
pub fn digest(root: &Path, kit: &Kit) -> io::Result<String> {
    let scripts = kit.scripts_dir();
    let mut out = Collected {
        files: Vec::new(),
        bytes: 0,
    };
    let label = if scripts.is_empty() { "." } else { &scripts };
    collect(&root.join(&scripts), label, 0, false, &mut out)?;
    let mut ancestor = Path::new(&scripts).parent();
    while let Some(folder) = ancestor {
        let label = folder.to_string_lossy();
        let prefix = if label.is_empty() {
            ".".to_string()
        } else {
            label.into_owned()
        };
        let path = root.join(folder);
        let manifest = path.join("package.json");
        if fs::symlink_metadata(&manifest).is_ok() {
            out.push(format!("{prefix}/package.json"), manifest)?;
        }
        let modules = path.join("node_modules");
        if fs::symlink_metadata(&modules).is_ok() {
            collect(
                &modules,
                &format!("{prefix}/node_modules"),
                0,
                true,
                &mut out,
            )?;
        }
        ancestor = folder.parent();
    }
    follow_relative_imports(root, &mut out)?;
    out.files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut hasher = Sha256::new();
    for (relative, path) in out.files {
        hasher.update(relative.as_bytes());
        hasher.update([0]);
        if fs::symlink_metadata(&path)?.file_type().is_symlink() {
            hasher.update(b"symlink:");
            hasher.update(fs::read_link(&path)?.to_string_lossy().as_bytes());
            hasher.update([0]);
        }
        let bytes = fs::read(&path)?;
        hasher.update((bytes.len() as u64).to_le_bytes());
        hasher.update(&bytes);
        hasher.update([0]);
    }
    let mut hex = String::with_capacity(64);
    for byte in hasher.finalize() {
        let _ = write!(hex, "{byte:02x}");
    }
    Ok(hex)
}

/// The note a kit command writes, from its `--target=` (a vault path, `.md`
/// optional, or `NOW`/`SOUL`/`USER` for a block), or `None` when it names
/// none (the kit then queues the memory in its own inbox).
fn kit_target(kit: &Kit, args: &[String]) -> Option<String> {
    let target = args.iter().find_map(|arg| arg.strip_prefix("--target="))?;
    let block = args.first().is_some_and(|word| word == "remember")
        && args.iter().any(|arg| arg == "--kind=block");
    if block {
        let key = target.rsplit('/').next().unwrap_or(target);
        let key = key.strip_suffix(".md").unwrap_or(key).to_ascii_uppercase();
        return Some(format!("{}/identity/{key}.md", kit.system));
    }
    Some(if target.ends_with(".md") {
        target.to_string()
    } else {
        format!("{target}.md")
    })
}

/// Kore's privacy rule for kit writes: a command may not write into a note
/// marked `private: true` or `sensitivity: private`, nor outside the vault,
/// whoever asks. The kit itself does not know Kore's rule, so the gate runs
/// before it, on the note the command names.
pub fn check_kit_target(root: &Path, kit: &Kit, args: &[String]) -> Result<(), String> {
    let Some(target) = kit_target(kit, args) else {
        return Ok(());
    };
    if !is_safe_vault_folder(&target) {
        return Err(format!("`{target}` is not a note path inside the vault"));
    }
    let path = root.join(&target);
    // The nearest part of the path that exists must resolve inside the
    // vault, so neither the note nor a folder link on the way leaves it.
    let existing = path
        .ancestors()
        .find(|ancestor| fs::symlink_metadata(ancestor).is_ok())
        .unwrap_or(root);
    let inside = match (fs::canonicalize(existing), fs::canonicalize(root)) {
        (Ok(resolved), Ok(base)) => resolved.starts_with(base),
        _ => false,
    };
    if !inside {
        return Err(format!("`{target}` is not a note path inside the vault"));
    }
    let Ok(source) = fs::read_to_string(&path) else {
        // A note that does not exist yet is new, so it is not private.
        return Ok(());
    };
    if parse_frontmatter(split_frontmatter(&source).raw).private {
        return Err(format!(
            "`{target}` is private: Kore never lets an agent write into a private note"
        ));
    }
    Ok(())
}

/// The digest the user last allowed on this machine, if any.
pub fn trusted_digest(root: &Path) -> Option<String> {
    let text = fs::read_to_string(root.join(TRUST_PATH)).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("digest")
        .and_then(|digest| digest.as_str())
        .map(str::to_string)
}

/// Record `digest` as allowed. Written whole through a temp file, so a crash
/// leaves the old answer, never half of one.
pub fn trust(root: &Path, digest: &str) -> io::Result<()> {
    let path = root.join(TRUST_PATH);
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::other("no trust folder"))?;
    fs::create_dir_all(dir)?;
    let temp = dir.join("kit-trust.json.tmp");
    fs::write(&temp, serde_json::json!({ "digest": digest }).to_string())?;
    fs::rename(&temp, &path)
}

/// Whether the kit may run as it is on disk now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrustState {
    /// The scripts match what the user allowed.
    Trusted { digest: String },
    /// Never allowed on this machine.
    New { digest: String },
    /// Allowed once, and the scripts changed since.
    Changed { digest: String },
}

impl TrustState {
    pub fn digest(&self) -> &str {
        match self {
            Self::Trusted { digest } | Self::New { digest } | Self::Changed { digest } => digest,
        }
    }

    pub fn is_trusted(&self) -> bool {
        matches!(self, Self::Trusted { .. })
    }

    /// `trusted`, `new` or `changed`, for JSON surfaces.
    pub fn label(&self) -> &'static str {
        match self {
            Self::Trusted { .. } => "trusted",
            Self::New { .. } => "new",
            Self::Changed { .. } => "changed",
        }
    }
}

/// Compare the scripts on disk with the allowed digest.
pub fn trust_state(root: &Path, kit: &Kit) -> io::Result<TrustState> {
    let digest = digest(root, kit)?;
    Ok(match trusted_digest(root) {
        Some(allowed) if allowed == digest => TrustState::Trusted { digest },
        Some(_) => TrustState::Changed { digest },
        None => TrustState::New { digest },
    })
}

/// The refusal a caller relays when the kit may not run.
pub fn untrusted_message(state: &TrustState) -> String {
    let what = match state {
        TrustState::Trusted { .. } => return String::new(),
        TrustState::New { .. } => "is new on this Mac",
        TrustState::Changed { .. } => "changed since you last allowed it",
    };
    format!(
        "the vault's memory script {what}: allow it in Kore (Settings → Agents) or run `kore brain trust`, then try again"
    )
}

/// Size and shape limits, then the allowlist: the argv must start with one
/// of [`KIT_COMMANDS`] and carry only `--option` or `--option=value`
/// entries after it, so no positional can smuggle a path or a subcommand.
pub fn check_kit_args(args: &[String]) -> Result<(), String> {
    if args.len() > MAX_ARGS {
        return Err(format!("too many arguments (at most {MAX_ARGS})"));
    }
    for arg in args {
        if arg.len() > MAX_ARG_BYTES {
            return Err(format!(
                "an argument is longer than {} KB",
                MAX_ARG_BYTES / 1024
            ));
        }
        if arg.contains('\0') {
            return Err("an argument contains a NUL byte".to_string());
        }
    }
    let command = KIT_COMMANDS
        .iter()
        .find(|command| {
            args.len() >= command.len() && command.iter().zip(args).all(|(word, arg)| *word == arg)
        })
        .ok_or_else(|| {
            let names: Vec<String> = KIT_COMMANDS.iter().map(|c| c.join(" ")).collect();
            format!(
                "not a memory command Kore runs (one of: {})",
                names.join(", ")
            )
        })?;
    match args[command.len()..]
        .iter()
        .find(|arg| !arg.starts_with("--") || arg.len() < 3)
    {
        Some(arg) => Err(format!("unexpected argument {arg:?}: pass --option=value")),
        None => Ok(()),
    }
}

/// The agent slug the kit's run records use: lowercase letters, digits and
/// dashes, so a name can never become a path. The same rule as
/// `brainAgentSlug` in `packages/core/src/cyber-brain/script.ts` for ASCII
/// names (non-ASCII letters become dashes here, not their base letter).
pub fn agent_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut dash = false;
    for ch in name.to_lowercase().chars() {
        if ch.is_ascii_alphanumeric() {
            slug.push(ch);
            dash = false;
        } else if !dash && !slug.is_empty() {
            slug.push('-');
            dash = true;
        }
    }
    let slug: String = slug.trim_end_matches('-').chars().take(40).collect();
    let slug = slug.trim_end_matches('-').to_string();
    if slug.is_empty() {
        "kore".to_string()
    } else {
        slug
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MARIO: &str = "---\ncyber_brain: \"0.1\"\nwriters: inbox\npaths:\n  system: System\n  inbox: _inbox\n---\n# Vault\n";

    #[test]
    fn detects_the_kit_from_the_contract_frontmatter() {
        let kit = parse_contract(MARIO).expect("kit");
        assert_eq!(kit.version, "0.1");
        assert_eq!(kit.script, "System/scripts/brain.mjs");
        assert_eq!(kit.scripts_dir(), "System/scripts");
    }

    #[test]
    fn no_key_private_contract_or_bad_yaml_means_no_kit() {
        assert_eq!(parse_contract("---\ntitle: x\n---\n"), None);
        assert_eq!(parse_contract("# no frontmatter"), None);
        assert_eq!(
            parse_contract("---\ncyber_brain: 0.1\nsensitivity: private\n---\n"),
            None
        );
        assert_eq!(parse_contract("---\ncyber_brain: [\n---\n"), None);
    }

    #[test]
    fn an_unsafe_system_path_falls_back_to_the_default() {
        let kit =
            parse_contract("---\ncyber_brain: 0.1\npaths:\n  system: ../etc\n---\n").expect("kit");
        assert_eq!(kit.script, "System/scripts/brain.mjs");
        let numeric = parse_contract("---\ncyber_brain: 1\n---\n").expect("kit");
        assert_eq!(numeric.version, "1");
    }

    fn vault() -> (tempfile::TempDir, Kit) {
        let dir = tempfile::tempdir().expect("tempdir");
        fs::write(dir.path().join(CONTRACT_PATH), MARIO).expect("contract");
        fs::create_dir_all(dir.path().join("System/scripts/lib")).expect("scripts");
        fs::write(
            dir.path().join("System/scripts/brain.mjs"),
            "import './core.mjs'\n",
        )
        .expect("brain");
        fs::write(dir.path().join("System/scripts/core.mjs"), "export {}\n").expect("core");
        let kit = detect(dir.path()).expect("kit");
        (dir, kit)
    }

    #[test]
    fn trust_follows_the_scripts_content() {
        let (dir, kit) = vault();
        let root = dir.path();
        let first = trust_state(root, &kit).expect("state");
        assert!(matches!(first, TrustState::New { .. }));
        trust(root, first.digest()).expect("trust");
        assert!(trust_state(root, &kit).expect("state").is_trusted());

        // A sibling module the entry point imports counts, not just brain.mjs.
        fs::write(root.join("System/scripts/core.mjs"), "export const x = 1\n").expect("edit");
        let changed = trust_state(root, &kit).expect("state");
        assert!(matches!(changed, TrustState::Changed { .. }));
        assert!(untrusted_message(&changed).contains("changed"));

        // A new nested module counts too; notes beside the scripts do not.
        trust(root, changed.digest()).expect("trust");
        fs::write(root.join("System/scripts/README.md"), "notes").expect("readme");
        assert!(trust_state(root, &kit).expect("state").is_trusted());
        fs::write(root.join("System/scripts/lib/extra.mjs"), "1").expect("extra");
        assert!(!trust_state(root, &kit).expect("state").is_trusted());
    }

    #[test]
    fn hidden_files_packages_and_link_targets_are_pinned() {
        let (dir, kit) = vault();
        let root = dir.path();
        let allow = |root: &Path| {
            let state = trust_state(root, &kit).expect("state");
            trust(root, state.digest()).expect("trust");
        };
        let pinned = |root: &Path| trust_state(root, &kit).expect("state").is_trusted();

        // A hidden module and a package Node would resolve count.
        allow(root);
        fs::write(root.join("System/scripts/.hidden.mjs"), "1").expect("hidden");
        assert!(!pinned(root));
        allow(root);
        fs::create_dir_all(root.join("System/scripts/node_modules/dep")).expect("dep");
        fs::write(root.join("System/scripts/node_modules/dep/index"), "1").expect("dep file");
        assert!(!pinned(root));
        allow(root);
        // So do a package manifest or packages above the scripts folder.
        fs::write(root.join("System/package.json"), "{}").expect("manifest");
        assert!(!pinned(root));
        allow(root);
        fs::create_dir_all(root.join("node_modules/up")).expect("root modules");
        fs::write(root.join("node_modules/up/index.js"), "1").expect("up");
        assert!(!pinned(root));

        // A symlink pins the bytes it points at, not only its target path.
        #[cfg(unix)]
        {
            let target = root.join("outside.mjs");
            fs::write(&target, "export const a = 1\n").expect("target");
            std::os::unix::fs::symlink(&target, root.join("System/scripts/linked.mjs"))
                .expect("link");
            allow(root);
            fs::write(&target, "export const a = 2\n").expect("retarget bytes");
            assert!(!pinned(root));

            // A link to a folder is refused outright.
            std::os::unix::fs::symlink(root.join("System"), root.join("System/scripts/loop"))
                .expect("dir link");
            assert!(trust_state(root, &kit).is_err());
        }
    }

    #[test]
    fn writes_into_private_notes_or_outside_the_vault_are_refused() {
        let (dir, kit) = vault();
        let root = dir.path();
        fs::create_dir_all(root.join("CRM")).expect("crm");
        fs::write(
            root.join("CRM/Alice.md"),
            "---\nsensitivity: private\n---\n# A\n",
        )
        .expect("a");
        fs::write(root.join("CRM/Bob.md"), "# Bob\n").expect("b");
        fs::create_dir_all(root.join("System/identity")).expect("identity");
        fs::write(
            root.join("System/identity/SOUL.md"),
            "---\nprivate: true\n---\n",
        )
        .expect("soul");
        let check = |words: &[&str]| check_kit_target(root, &kit, &args(words));

        assert!(check(&["remember", "--text=x", "--target=CRM/Alice"]).is_err());
        assert!(check(&["remember", "--text=x", "--target=CRM/Alice.md"]).is_err());
        assert!(check(&["remember", "--kind=block", "--text=x", "--target=SOUL"]).is_err());
        assert!(check(&["remember", "--text=x", "--target=../outside"]).is_err());
        assert!(check(&["remember", "--text=x", "--target=/etc/passwd"]).is_err());
        assert!(check(&["remember", "--text=x", "--target=CRM/Bob"]).is_ok());
        assert!(check(&["remember", "--text=x", "--target=CRM/New person"]).is_ok());
        assert!(check(&["remember", "--kind=block", "--text=x", "--target=NOW"]).is_ok());
        assert!(check(&["remember", "--text=x"]).is_ok());
        assert!(check(&["remember", "--text=x", "--target=C:/Users/x"]).is_err());

        // A folder link on the way to a new note cannot lead out of the vault.
        #[cfg(unix)]
        {
            let outside = tempfile::tempdir().expect("outside");
            std::os::unix::fs::symlink(outside.path(), root.join("Linked")).expect("link");
            assert!(check(&["remember", "--text=x", "--target=Linked/new"]).is_err());
        }
    }

    #[test]
    fn modules_the_kit_imports_from_outside_its_folder_are_pinned() {
        let (dir, kit) = vault();
        let root = dir.path();
        fs::write(
            root.join("System/scripts/brain.mjs"),
            "import { hook } from '../hooks.mjs'\nimport x from \"./core.mjs\"\n",
        )
        .expect("brain");
        fs::write(root.join("System/hooks.mjs"), "export const hook = 1\n").expect("hooks");
        let state = trust_state(root, &kit).expect("state");
        trust(root, state.digest()).expect("trust");
        fs::write(root.join("System/hooks.mjs"), "export const hook = 2\n").expect("swap");
        assert!(!trust_state(root, &kit).expect("state").is_trusted());

        // An import that resolves outside the vault cannot be pinned at all.
        let outside = tempfile::tempdir().expect("outside");
        fs::write(outside.path().join("evil.mjs"), "1").expect("evil");
        fs::write(
            root.join("System/scripts/brain.mjs"),
            format!("import '{}'\n", {
                let up = "../".repeat(root.components().count() + 2);
                format!(
                    "./{up}{}/evil.mjs",
                    outside.path().display().to_string().trim_start_matches('/')
                )
            }),
        )
        .expect("brain");
        assert!(trust_state(root, &kit).is_err());
    }

    fn args(words: &[&str]) -> Vec<String> {
        words.iter().map(|word| (*word).to_string()).collect()
    }

    #[test]
    fn only_listed_commands_with_inline_options_pass() {
        assert!(check_kit_args(&args(&["remember", "--text=a", "--now"])).is_ok());
        assert!(check_kit_args(&args(&["loop", "close", "--id=x", "--outcome=done"])).is_ok());
        assert!(check_kit_args(&args(&["check", "--json"])).is_ok());
        assert!(check_kit_args(&args(&["facts", "Alice"])).is_err());
        assert!(check_kit_args(&args(&["loop", "delete"])).is_err());
        assert!(check_kit_args(&args(&["remember", "/etc/passwd"])).is_err());
        assert!(check_kit_args(&args(&["remember", "--"])).is_err());
        assert!(check_kit_args(&args(&["remember", "--text=a\0b"])).is_err());
        assert!(check_kit_args(&[]).is_err());
    }

    #[test]
    fn agent_slugs_match_the_ts_rule() {
        assert_eq!(agent_slug("Claude Desktop"), "claude-desktop");
        assert_eq!(agent_slug("  ChatGPT (work)  "), "chatgpt-work");
        assert_eq!(agent_slug("../.."), "kore");
        assert_eq!(agent_slug(""), "kore");
    }
}
