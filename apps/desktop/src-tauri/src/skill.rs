//! Agent-skill install (Settings → Agents): writes the bundled skills under
//! `~/.agents/skills/` so coding agents (Claude Code and friends) discover
//! the open graph, read it through the bundled `reflect` CLI, and know the
//! formats Kore renders.
//!
//! Four skills ship in `../skills/`: one **per graph** (`reflect-<slug>`,
//! rendered with the graph root and the CLI's on-disk path baked in) and
//! three **shared** format skills (`kore-markdown`, `kore-collections`,
//! `kore-agent-memory`) installed verbatim once, whichever graph is open. A
//! managed marker — an HTML comment carrying the sha256 of the rendered
//! content — makes updates safe: a file without the marker (or with the
//! right marker but edited content) was not written by us and is never
//! overwritten or deleted.

use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{Manager, State};

use crate::capture::atomic_write_to;
use crate::error::{AppError, AppResult};
use crate::fs::{current_root, root_for_generation, GraphState};

/// The per-graph skill template; placeholders are `{{SKILL_NAME}}`,
/// `{{GRAPH_NAME}}`, `{{GRAPH_ROOT}}`, and `{{CLI_PATH}}`.
const GRAPH_SKILL_TEMPLATE: &str = include_str!("../skills/graph/SKILL.md");

/// The shared format skills, installed as-is under their own names.
const SHARED_SKILLS: [(&str, &str); 3] = [
    (
        "kore-markdown",
        include_str!("../skills/kore-markdown/SKILL.md"),
    ),
    (
        "kore-collections",
        include_str!("../skills/kore-collections/SKILL.md"),
    ),
    (
        "kore-agent-memory",
        include_str!("../skills/kore-agent-memory/SKILL.md"),
    ),
];

const MANAGED_PREFIX: &str = "<!-- reflect-managed: sha256=";
const MANAGED_SUFFIX: &str = " -->";

/// The CLI sidecar, staged beside the app binary by the Tauri bundler (and
/// beside the dev binary by `tauri dev`) — same layout as the capture host.
const CLI_BINARY: &str = if cfg!(windows) {
    "reflect.exe"
} else {
    "reflect"
};

/// Where an installed skill file stands relative to what this app would
/// write today.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillInstallState {
    /// No file at the target path.
    Missing,
    /// Byte-identical to what we would write.
    Current,
    /// Ours (marker present) but rendered from older inputs — a template
    /// change, an app move, or a graph rename/move. Safe to rewrite.
    Stale,
    /// A file we don't manage: no marker, or marker with edited content.
    /// Never overwritten, never deleted.
    Conflict,
}

/// One skill's name, target path, and install state.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStatus {
    pub skill_name: String,
    pub skill_path: String,
    pub install_state: SkillInstallState,
}

/// Answer for the settings card: where the skills go, which CLI they name,
/// and where each one stands on disk (the per-graph skill first).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillsStatus {
    pub skills_root: String,
    pub cli_path: String,
    pub skills: Vec<SkillStatus>,
}

/// Everything derived for one skill that the three commands share.
struct SkillContext {
    skill_name: String,
    dir: PathBuf,
    target: PathBuf,
    rendered_hash: String,
    managed_content: String,
}

/// The full install set for one open graph.
struct SkillSet {
    skills_root: PathBuf,
    cli_path: PathBuf,
    contexts: Vec<SkillContext>,
}

/// Kebab-case ASCII slug of a graph name; `"graph"` when nothing survives.
fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut gap = false;
    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            if gap && !slug.is_empty() {
                slug.push('-');
            }
            gap = false;
            slug.push(character.to_ascii_lowercase());
        } else {
            gap = true;
        }
    }
    if slug.is_empty() {
        "graph".to_string()
    } else {
        slug
    }
}

fn render_graph_skill(
    skill_name: &str,
    graph_name: &str,
    graph_root: &str,
    cli_path: &str,
) -> String {
    GRAPH_SKILL_TEMPLATE
        .replace("{{SKILL_NAME}}", skill_name)
        .replace("{{GRAPH_NAME}}", graph_name)
        .replace("{{GRAPH_ROOT}}", graph_root)
        .replace("{{CLI_PATH}}", cli_path)
}

/// Lowercase hex sha256 (same encoding as the CLI's `hash.rs`).
fn content_hash(content: &str) -> String {
    use std::fmt::Write;
    let digest = Sha256::digest(content.as_bytes());
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

/// Insert the managed marker after the YAML frontmatter (agent runtimes parse
/// the frontmatter block first, so the marker must not sit above it).
fn insert_marker(source: &str, hash: &str) -> String {
    let marker = format!("{MANAGED_PREFIX}{hash}{MANAGED_SUFFIX}");
    if let Some(rest) = source.strip_prefix("---\n") {
        if let Some(index) = rest.find("\n---\n") {
            let split = "---\n".len() + index + "\n---\n".len();
            let (frontmatter, body) = source.split_at(split);
            return format!("{frontmatter}{marker}\n{body}");
        }
    }
    format!("{marker}\n{source}")
}

fn managed_hash(content: &str) -> Option<&str> {
    content.lines().find_map(|line| {
        line.trim()
            .strip_prefix(MANAGED_PREFIX)?
            .strip_suffix(MANAGED_SUFFIX)
    })
}

/// `content` with the marker's whole line removed — the inverse of
/// [`insert_marker`], so a clean install restores the exact rendered text.
fn without_marker_line(content: &str) -> Option<String> {
    let start = content.find(MANAGED_PREFIX)?;
    let line_start = content[..start].rfind('\n').map_or(0, |index| index + 1);
    let line_end = content[start..]
        .find('\n')
        .map_or(content.len(), |index| start + index + 1);
    let mut rest = String::with_capacity(content.len());
    rest.push_str(&content[..line_start]);
    rest.push_str(&content[line_end..]);
    Some(rest)
}

/// The marker is self-validating: it records the sha256 of the content it was
/// inserted into, so an edit anywhere in the file breaks the match and the
/// file classifies as [`SkillInstallState::Conflict`] — even when the app's
/// current inputs have also changed. Only a clean old install may be `Stale`.
fn classify(
    installed: Option<&str>,
    rendered_hash: &str,
    managed_content: &str,
) -> SkillInstallState {
    let Some(installed) = installed else {
        return SkillInstallState::Missing;
    };
    if installed == managed_content {
        return SkillInstallState::Current;
    }
    let (Some(hash), Some(body)) = (managed_hash(installed), without_marker_line(installed)) else {
        return SkillInstallState::Conflict;
    };
    if content_hash(&body) != hash {
        // Edited since we wrote it — the recorded hash no longer matches the
        // file's own body. Never overwrite, regardless of staleness.
        return SkillInstallState::Conflict;
    }
    if hash != rendered_hash {
        return SkillInstallState::Stale;
    }
    // Self-consistent and current by hash, yet not byte-identical (e.g. a
    // moved marker line): treat any deviation we can't explain as not ours.
    SkillInstallState::Conflict
}

/// The staged CLI sidecar, next to the running executable in both dev
/// (`target/debug/`) and the bundle (`Reflect.app/Contents/MacOS/`).
fn cli_path() -> AppResult<PathBuf> {
    let exe = std::env::current_exe().map_err(|err| AppError::io(err.to_string()))?;
    let dir = exe
        .parent()
        .ok_or_else(|| AppError::io("executable has no parent directory"))?;
    Ok(dir.join(CLI_BINARY))
}

/// One skill's context from its final rendered text.
fn skill_context(skills_root: &Path, skill_name: &str, rendered: &str) -> SkillContext {
    let rendered_hash = content_hash(rendered);
    let managed_content = insert_marker(rendered, &rendered_hash);
    let dir = skills_root.join(skill_name);
    let target = dir.join("SKILL.md");
    SkillContext {
        skill_name: skill_name.to_string(),
        dir,
        target,
        rendered_hash,
        managed_content,
    }
}

/// The install set for `root`: the per-graph skill first, then the shared
/// format skills.
fn skill_set(root: &Path, skills_root: &Path, cli: PathBuf) -> SkillSet {
    let graph_name = root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let graph_skill_name = format!("reflect-{}", slugify(&graph_name));
    let rendered = render_graph_skill(
        &graph_skill_name,
        &graph_name,
        &root.to_string_lossy(),
        &cli.to_string_lossy(),
    );
    let mut contexts = vec![skill_context(skills_root, &graph_skill_name, &rendered)];
    contexts.extend(
        SHARED_SKILLS
            .iter()
            .map(|(name, template)| skill_context(skills_root, name, template)),
    );
    SkillSet {
        skills_root: skills_root.to_path_buf(),
        cli_path: cli,
        contexts,
    }
}

fn skill_set_for_graph(root: &Path) -> AppResult<SkillSet> {
    let home = dirs::home_dir().ok_or_else(|| AppError::io("no home directory"))?;
    let skills_root = home.join(".agents").join("skills");
    Ok(skill_set(root, &skills_root, cli_path()?))
}

fn status_of(context: &SkillContext) -> AppResult<SkillStatus> {
    let installed = match fs::read_to_string(&context.target) {
        Ok(content) => Some(content),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => None,
        Err(err) => return Err(err.into()),
    };
    Ok(SkillStatus {
        skill_name: context.skill_name.clone(),
        skill_path: context.target.to_string_lossy().into_owned(),
        install_state: classify(
            installed.as_deref(),
            &context.rendered_hash,
            &context.managed_content,
        ),
    })
}

fn statuses_of(set: &SkillSet) -> AppResult<SkillsStatus> {
    let skills = set
        .contexts
        .iter()
        .map(status_of)
        .collect::<AppResult<Vec<_>>>()?;
    Ok(SkillsStatus {
        skills_root: set.skills_root.to_string_lossy().into_owned(),
        cli_path: set.cli_path.to_string_lossy().into_owned(),
        skills,
    })
}

/// Command: every bundled skill's name, target path, and install state for
/// the open graph. Read-only.
#[tauri::command]
pub async fn skill_status<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> AppResult<SkillsStatus> {
    crate::blocking::run_blocking(move || {
        let state = app.state::<GraphState>();
        let root = current_root(&state)?;
        statuses_of(&skill_set_for_graph(&root)?)
    })
    .await
}

/// Command: write (or refresh) every bundled skill file. Generation-pinned
/// so an install racing a graph switch can't write the wrong graph's skill.
/// A file we don't manage is left alone and reported as a conflict in the
/// returned statuses; the other skills still install.
#[tauri::command]
pub async fn skill_install<R: tauri::Runtime>(
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<SkillsStatus> {
    crate::blocking::run_blocking(move || skill_install_for(&app.state::<GraphState>(), generation))
        .await
}

/// The install itself, off the command's threading shell so each
/// classify-then-write sequence stays on one thread: the no-clobber create
/// below is only meaningful if nothing re-classifies between the two.
fn skill_install_for(state: &State<'_, GraphState>, generation: u64) -> AppResult<SkillsStatus> {
    let root = root_for_generation(state, generation)?;
    let set = skill_set_for_graph(&root)?;
    for context in &set.contexts {
        install_one(context)?;
    }
    statuses_of(&set)
}

fn install_one(context: &SkillContext) -> AppResult<()> {
    match status_of(context)?.install_state {
        SkillInstallState::Conflict | SkillInstallState::Current => Ok(()),
        SkillInstallState::Missing => {
            // No-clobber create: a file appearing between the classify above
            // and this write fails loudly instead of being replaced.
            atomic_create_new(&context.target, &context.managed_content)
        }
        SkillInstallState::Stale => atomic_write_to(&context.target, &context.managed_content),
    }
}

/// Atomic create that refuses to replace an existing file (the missing-state
/// counterpart of `capture::atomic_write_to`).
fn atomic_create_new(path: &Path, contents: &str) -> AppResult<()> {
    use std::io::Write;
    let dir = path
        .parent()
        .ok_or_else(|| AppError::io(format!("no parent directory for {}", path.display())))?;
    fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    tmp.write_all(contents.as_bytes())?;
    tmp.flush()?;
    tmp.persist_noclobber(path)
        .map_err(|err| AppError::io(err.to_string()))?;
    Ok(())
}

/// Command: remove every managed skill file (and its directory when that
/// leaves it empty). Files without our managed marker are left in place.
#[tauri::command]
pub async fn skill_uninstall<R: tauri::Runtime>(
    generation: u64,
    app: tauri::AppHandle<R>,
) -> AppResult<SkillsStatus> {
    crate::blocking::run_blocking(move || {
        skill_uninstall_for(&app.state::<GraphState>(), generation)
    })
    .await
}

fn skill_uninstall_for(state: &State<'_, GraphState>, generation: u64) -> AppResult<SkillsStatus> {
    let root = root_for_generation(state, generation)?;
    let set = skill_set_for_graph(&root)?;
    for context in &set.contexts {
        uninstall_one(context)?;
    }
    statuses_of(&set)
}

fn uninstall_one(context: &SkillContext) -> AppResult<()> {
    match status_of(context)?.install_state {
        SkillInstallState::Missing | SkillInstallState::Conflict => Ok(()),
        SkillInstallState::Current | SkillInstallState::Stale => {
            fs::remove_file(&context.target)?;
            // Only removes an empty directory — anything else the user put
            // beside the skill file survives.
            let _ = fs::remove_dir(&context.dir);
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_kebab_cases_graph_names() {
        assert_eq!(slugify("Personal"), "personal");
        assert_eq!(slugify("Alex's Notes"), "alex-s-notes");
        assert_eq!(slugify("  Work 2026  "), "work-2026");
        assert_eq!(slugify("日本語"), "graph");
        assert_eq!(slugify(""), "graph");
    }

    fn test_set(dir: &Path, graph: &Path) -> SkillSet {
        skill_set(
            graph,
            dir,
            PathBuf::from("/Applications/Reflect.app/Contents/MacOS/reflect"),
        )
    }

    fn graph_context(set: &SkillSet) -> &SkillContext {
        &set.contexts[0]
    }

    #[test]
    fn render_bakes_in_the_graph_and_cli() {
        let set = test_set(Path::new("/skills"), Path::new("/graphs/Personal"));
        let context = graph_context(&set);
        assert_eq!(context.skill_name, "reflect-personal");
        assert_eq!(
            context.target,
            Path::new("/skills/reflect-personal/SKILL.md")
        );
        assert!(context.managed_content.contains("name: reflect-personal"));
        assert!(context.managed_content.contains("/graphs/Personal"));
        assert!(context
            .managed_content
            .contains("/Applications/Reflect.app/Contents/MacOS/reflect"));
        assert!(context
            .managed_content
            .contains("git -C \"/graphs/Personal\""));
        // Renderer placeholders must all be filled; the template-placeholder
        // documentation ({{date}}, {{title}}, …) legitimately stays literal.
        for placeholder in [
            "{{SKILL_NAME}}",
            "{{GRAPH_NAME}}",
            "{{GRAPH_ROOT}}",
            "{{CLI_PATH}}",
        ] {
            assert!(!context.managed_content.contains(placeholder));
        }
    }

    #[test]
    fn shared_skills_install_verbatim_under_their_own_names() {
        let set = test_set(Path::new("/skills"), Path::new("/graphs/Personal"));
        let names: Vec<&str> = set
            .contexts
            .iter()
            .map(|context| context.skill_name.as_str())
            .collect();
        assert_eq!(
            names,
            [
                "reflect-personal",
                "kore-markdown",
                "kore-collections",
                "kore-agent-memory"
            ]
        );
        for (context, (name, template)) in set.contexts[1..].iter().zip(SHARED_SKILLS) {
            assert_eq!(
                context.target,
                Path::new("/skills").join(name).join("SKILL.md")
            );
            assert!(context.managed_content.contains(&format!("name: {name}")));
            assert_eq!(
                without_marker_line(&context.managed_content).as_deref(),
                Some(template)
            );
            // Shared skills are graph-independent: no renderer placeholders,
            // and nothing about this particular graph.
            assert!(!template.contains("{{SKILL_NAME}}"));
            assert!(!template.contains("{{GRAPH_ROOT}}"));
            assert!(!context.managed_content.contains("/graphs/Personal"));
        }
        // Every shared skill's frontmatter declares the name agents load it by.
        for (name, template) in SHARED_SKILLS {
            assert!(
                template.starts_with(&format!("---\nname: {name}\n")),
                "{name}"
            );
        }
    }

    #[test]
    fn marker_sits_after_the_frontmatter() {
        let set = test_set(Path::new("/skills"), Path::new("/graphs/Personal"));
        for context in &set.contexts {
            let close = context
                .managed_content
                .find("\n---\n")
                .expect("frontmatter closes");
            let marker = context
                .managed_content
                .find(MANAGED_PREFIX)
                .expect("marker present");
            assert!(marker > close, "marker must not sit above the frontmatter");
            assert_eq!(
                managed_hash(&context.managed_content),
                Some(context.rendered_hash.as_str())
            );
        }
    }

    #[test]
    fn classify_walks_the_state_machine() {
        let set = test_set(Path::new("/skills"), Path::new("/graphs/Personal"));
        let context = graph_context(&set);
        let hash = &context.rendered_hash;
        let managed = &context.managed_content;

        assert_eq!(classify(None, hash, managed), SkillInstallState::Missing);
        assert_eq!(
            classify(Some(managed), hash, managed),
            SkillInstallState::Current
        );
        // No marker → not ours.
        assert_eq!(
            classify(Some("# hand-written skill"), hash, managed),
            SkillInstallState::Conflict
        );
        // Right marker, edited body → not ours either.
        let edited = format!("{managed}\nuser addition\n");
        assert_eq!(
            classify(Some(&edited), hash, managed),
            SkillInstallState::Conflict
        );
        // Rendered from other inputs (graph moved, template changed) → stale,
        // but only while the old install is untouched.
        let moved = test_set(Path::new("/skills"), Path::new("/elsewhere/Personal"));
        assert_eq!(
            classify(Some(&graph_context(&moved).managed_content), hash, managed),
            SkillInstallState::Stale
        );
        // A user-edited old install must stay a conflict — staleness never
        // downgrades edit protection (the marker validates its own body).
        let stale_edited = format!("{}\nuser addition\n", graph_context(&moved).managed_content);
        assert_eq!(
            classify(Some(&stale_edited), hash, managed),
            SkillInstallState::Conflict
        );
    }

    #[test]
    fn create_new_refuses_to_replace_an_existing_file() {
        let temp = tempfile::tempdir().expect("tempdir");
        let target = temp.path().join("SKILL.md");
        atomic_create_new(&target, "first").expect("create");
        assert!(atomic_create_new(&target, "second").is_err());
        assert_eq!(std::fs::read_to_string(&target).expect("read"), "first");
    }

    #[test]
    fn install_round_trip_on_disk() {
        let temp = tempfile::tempdir().expect("tempdir");
        let set = test_set(temp.path(), Path::new("/graphs/Personal"));

        let before = statuses_of(&set).expect("status");
        assert_eq!(before.skills.len(), 4);
        assert!(before
            .skills
            .iter()
            .all(|skill| skill.install_state == SkillInstallState::Missing));

        // A hand-written file where a shared skill would go survives the
        // install untouched while the other three land.
        let taken = &set.contexts[2];
        std::fs::create_dir_all(&taken.dir).expect("mkdir");
        std::fs::write(&taken.target, "# my own collections skill\n").expect("write");
        for context in &set.contexts {
            install_one(context).expect("install");
        }
        let after = statuses_of(&set).expect("status");
        let states: Vec<SkillInstallState> = after
            .skills
            .iter()
            .map(|skill| skill.install_state)
            .collect();
        assert_eq!(
            states,
            [
                SkillInstallState::Current,
                SkillInstallState::Current,
                SkillInstallState::Conflict,
                SkillInstallState::Current
            ]
        );
        assert_eq!(
            std::fs::read_to_string(&taken.target).expect("read"),
            "# my own collections skill\n"
        );

        // A graph rename changes the per-graph skill's name; the shared
        // skills are unaffected.
        let renamed = skill_set(
            Path::new("/graphs/Personal Renamed"),
            temp.path(),
            PathBuf::from("/Applications/Reflect.app/Contents/MacOS/reflect"),
        );
        assert_eq!(
            graph_context(&renamed).skill_name,
            "reflect-personal-renamed"
        );
        assert_eq!(renamed.contexts[1].skill_name, "kore-markdown");

        // User edits below the marker turn a managed file into a conflict.
        let graph = graph_context(&set);
        let mut edited = graph.managed_content.clone();
        edited.push_str("\n## My notes\n");
        std::fs::write(&graph.target, &edited).expect("edit");
        assert_eq!(
            status_of(graph).expect("status").install_state,
            SkillInstallState::Conflict
        );

        // Uninstall removes only what we manage.
        for context in &set.contexts {
            uninstall_one(context).expect("uninstall");
        }
        assert!(graph.target.exists(), "edited file kept");
        assert!(taken.target.exists(), "foreign file kept");
        assert!(!set.contexts[1].target.exists());
        assert!(!set.contexts[3].target.exists());
    }
}
