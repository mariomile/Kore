//! `reflect tasks` — the graph's open tasks (round `+ [ ]` checkboxes), read
//! from the index's tasks projection. Like `search`, this command requires
//! the index (exit 4 when missing) — the CLI never builds it — and re-checks
//! each source note's own frontmatter so a note flagged private after the
//! last index run never surfaces.

use std::collections::HashMap;

use crate::commands::output::{print_json, TaskJson, TasksJson};
use crate::commands::{require_index, still_public_on_disk};
use crate::error::CliError;
use crate::graph::Graph;

struct TaskRow {
    path: String,
    title: String,
    text: String,
    checked: bool,
    due_date: Option<String>,
    due_time: Option<String>,
}

pub fn run(graph: &Graph, json: bool, all: bool, limit: usize) -> Result<(), CliError> {
    let (opened, staleness) = require_index(&graph.root)?;

    let mut statement = opened.conn.prepare(
        "SELECT tasks.note_path, notes.title, tasks.text, tasks.checked, tasks.due_date, tasks.due_time
         FROM tasks JOIN notes ON notes.path = tasks.note_path
         WHERE ?1 OR tasks.checked = 0
         ORDER BY tasks.note_path, tasks.marker_offset",
    )?;
    let rows = statement.query_map([all], |row| {
        Ok(TaskRow {
            path: row.get(0)?,
            title: row.get(1)?,
            text: row.get(2)?,
            checked: row.get::<_, i64>(3)? != 0,
            due_date: row.get(4)?,
            due_time: row.get(5)?,
        })
    })?;

    // One frontmatter re-check per source note, not per task.
    let mut public: HashMap<String, bool> = HashMap::new();
    let mut tasks: Vec<TaskRow> = Vec::new();
    for row in rows {
        let row = row?;
        let keep = *public
            .entry(row.path.clone())
            .or_insert_with_key(|path| still_public_on_disk(&graph.root, path));
        if keep {
            tasks.push(row);
            if tasks.len() >= limit {
                break;
            }
        }
    }

    if json {
        return print_json(&TasksJson {
            stale: staleness.is_stale(),
            tasks: tasks
                .into_iter()
                .map(|task| TaskJson {
                    path: task.path,
                    title: task.title,
                    text: task.text,
                    checked: task.checked,
                    due_date: task.due_date,
                    due_time: task.due_time,
                })
                .collect(),
        });
    }
    let mut current_path: Option<&str> = None;
    for task in &tasks {
        if current_path != Some(task.path.as_str()) {
            println!("{}\t{}", task.path, task.title);
            current_path = Some(task.path.as_str());
        }
        let marker = if task.checked { "[x]" } else { "[ ]" };
        match (&task.due_date, &task.due_time) {
            (Some(due), Some(time)) => println!("  {marker} {}  (due {due} {time})", task.text),
            (Some(due), None) => println!("  {marker} {}  (due {due})", task.text),
            (None, _) => println!("  {marker} {}", task.text),
        }
    }
    Ok(())
}
