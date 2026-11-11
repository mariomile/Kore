//! `kore skills [name]`: the procedures the user taught their agents, kept
//! in the vault as `agents/skills/<slug>.md` (H1 = name, frontmatter
//! `description` = when to use it; see the `kore-agent-memory` skill).
//! Without a name it lists them (slug, title, description) so an agent can
//! pick one; with a name it returns the whole skill to follow. Works without
//! an index. A skill marked `private: true` is neither listed nor served.

use kore_note_policy::split_frontmatter;

use crate::commands::output::{print_content, print_json, SkillJson, SkillsJson};
use crate::error::CliError;
use crate::frontmatter_values::{extract_properties, PropertyValue};
use crate::graph::Graph;
use crate::note_file::{read_note, walk_notes, Note};

/// Where vault skills live, graph-relative.
pub const SKILLS_DIR: &str = "agents/skills/";

pub fn run(graph: &Graph, json: bool, name: Option<&str>) -> Result<(), CliError> {
    let mut skills: Vec<(SkillJson, String)> = walk_notes(&graph.root)
        .into_iter()
        .filter(|note| !note.placeholder)
        .filter_map(|note| {
            let slug = note
                .rel_path
                .strip_prefix(SKILLS_DIR)?
                .strip_suffix(".md")?;
            if slug.contains('/') {
                return None;
            }
            let slug = slug.to_string();
            let read = read_note(&graph.root, &note.rel_path).ok()?;
            Some((skill(slug, &note.rel_path, &read), read.content))
        })
        .collect();
    skills.sort_by(|left, right| left.0.name.cmp(&right.0.name));

    let Some(name) = name else {
        let skills: Vec<SkillJson> = skills.into_iter().map(|(skill, _)| skill).collect();
        if json {
            return print_json(&SkillsJson { skills });
        }
        for skill in &skills {
            println!("{}\t{}", skill.name, skill.description);
        }
        return Ok(());
    };

    let wanted = name.trim().to_lowercase();
    let Some((skill, content)) = skills.into_iter().find(|(skill, _)| {
        skill.name.to_lowercase() == wanted || skill.title.to_lowercase() == wanted
    }) else {
        return Err(CliError::NotFound(format!(
            "no skill named {name} in {SKILLS_DIR}"
        )));
    };
    if json {
        return print_json(&SkillJson {
            content: Some(content),
            ..skill
        });
    }
    print_content(&content);
    Ok(())
}

fn skill(name: String, rel_path: &str, note: &Note) -> SkillJson {
    let description = extract_properties(split_frontmatter(&note.content).raw)
        .into_iter()
        .find_map(|(key, value)| match value {
            PropertyValue::String(text) if key == "description" => Some(text),
            _ => None,
        })
        .unwrap_or_default();
    SkillJson {
        name,
        path: rel_path.to_string(),
        title: note.meta.title.clone(),
        description,
        content: None,
    }
}
