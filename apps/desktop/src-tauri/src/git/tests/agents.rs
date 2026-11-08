//! Agent-authored commits, the activity log and undo (Plan 33, A1).

use std::fs;

use git2::Repository;

use super::{commit_all, fixture, head_tree_paths, read, write, MAX_FILE_BYTES};

#[test]
fn commit_paths_commits_only_the_agents_notes_under_its_name() {
    use super::super::agent_writes;
    use super::super::commit::{commit_paths, CommitAuthor};

    let fixture = fixture();
    let root = &fixture.graph_a;
    write(root, "notes/a.md", "# A\n");
    commit_all(root, "Update notes", MAX_FILE_BYTES).unwrap();
    write(root, "notes/a.md", "# A\n\nfrom grok\n");
    write(root, "notes/mine.md", "# Mine\n");
    write(
        root,
        ".reflect/agent-writes.jsonl",
        "{\"at\":1,\"agent\":\"Grok\",\"path\":\"notes/a.md\"}\nnot json\n",
    );

    let journal = agent_writes::read(root).unwrap();
    assert_eq!(journal.lines, 2);
    assert_eq!(journal.writes.len(), 1);
    let author = CommitAuthor {
        name: "Grok".into(),
        email: "grok@agents.kore".into(),
        trailer: "Kore-Agent: Grok".into(),
    };
    let outcome = commit_paths(
        root,
        &["notes/a.md".into(), ".reflect/index.sqlite".into()],
        &author,
        "Update notes",
        MAX_FILE_BYTES,
    )
    .unwrap();
    assert!(outcome.committed);
    let repo = Repository::open(root).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.author().name().ok(), Some("Grok"));
    assert!(head.message().unwrap().ends_with("\n\nKore-Agent: Grok"));
    let paths = head_tree_paths(root);
    assert!(!paths.contains(&"notes/mine.md".to_string()));
    assert!(!paths.iter().any(|path| path.starts_with(".reflect")));

    // The owner's own note is still pending for the regular commit.
    assert!(
        commit_all(root, "Update notes", MAX_FILE_BYTES)
            .unwrap()
            .committed
    );
    assert!(head_tree_paths(root).contains(&"notes/mine.md".to_string()));

    agent_writes::clear(root, journal.lines).unwrap();
    assert_eq!(agent_writes::read(root).unwrap().lines, 0);
}

#[test]
fn activity_pages_through_commits_with_authors_trailers_and_files() {
    use super::super::activity::{activity, ActivityFileKind};
    use super::super::commit::{commit_paths, CommitAuthor};

    let fixture = fixture();
    let root = &fixture.graph_a;
    write(root, "notes/a.md", "# A\n");
    commit_all(root, "Update notes", MAX_FILE_BYTES).unwrap();
    write(root, "notes/a.md", "# A\n\nfrom grok\n");
    let author = CommitAuthor {
        name: "Grok".into(),
        email: "grok@agents.kore".into(),
        trailer: "Kore-Agent: Grok".into(),
    };
    commit_paths(
        root,
        &["notes/a.md".into()],
        &author,
        "Update notes",
        MAX_FILE_BYTES,
    )
    .unwrap();
    fs::remove_file(root.join("notes/a.md")).unwrap();
    commit_all(root, "Update notes", MAX_FILE_BYTES).unwrap();

    let first = activity(root, None, 2).unwrap();
    assert_eq!(first.commits.len(), 2);
    assert_eq!(first.commits[0].files[0].kind, ActivityFileKind::Deleted);
    let grok = &first.commits[1];
    assert_eq!(grok.author_name, "Grok");
    assert_eq!(grok.trailers[0].value, "Grok");
    assert_eq!(grok.files[0].path, "notes/a.md");
    assert_eq!(grok.files[0].kind, ActivityFileKind::Modified);

    let rest = activity(root, first.next.as_deref(), 2).unwrap();
    assert_eq!(rest.commits.len(), 1);
    assert!(rest.next.is_none());
    assert_eq!(rest.commits[0].files[0].kind, ActivityFileKind::Added);
}

#[test]
fn undo_preview_takes_back_a_runs_lines_and_keeps_later_edits() {
    use super::super::activity::activity;
    use super::super::undo::{undo_preview, UndoConflictReason, UndoFile};

    let fixture = fixture();
    let root = &fixture.graph_a;
    write(root, "notes/a.md", "one\n\ntwo\n\nthree\n");
    commit_all(root, "Update notes", MAX_FILE_BYTES).unwrap();
    write(root, "notes/a.md", "one\n\nTWO\n\nthree\n");
    write(root, "notes/b.md", "from the agent\n");
    commit_all(root, "Update notes", MAX_FILE_BYTES).unwrap();
    let run = activity(root, None, 1).unwrap().commits[0].commit.clone();

    // A later edit to another line survives the undo.
    write(root, "notes/a.md", "one\n\nTWO\n\nTHREE\n");
    let preview = undo_preview(root, &run, &run).unwrap();
    assert!(preview.conflicts.is_empty());
    assert_eq!(
        preview.files,
        vec![
            UndoFile {
                path: "notes/a.md".into(),
                content: Some("one\n\ntwo\n\nTHREE\n".into()),
            },
            UndoFile {
                path: "notes/b.md".into(),
                content: None,
            },
        ]
    );

    // A later edit to the run's own line is a conflict, and the preview
    // writes nothing.
    write(root, "notes/a.md", "one\n\nTwo again\n\nthree\n");
    let preview = undo_preview(root, &run, &run).unwrap();
    assert_eq!(preview.conflicts.len(), 1);
    assert_eq!(preview.conflicts[0].path, "notes/a.md");
    assert_eq!(
        preview.conflicts[0].reason,
        UndoConflictReason::ChangedSince
    );
    assert_eq!(read(root, "notes/a.md"), "one\n\nTwo again\n\nthree\n");
}
