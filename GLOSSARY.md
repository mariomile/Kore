# Kore

Kore is an offline-first, Markdown-backed note-taking and personal knowledge workspace.

## Language

**Tag**:
A `#tag` assigned to a note to classify it. Every tag starts as a lightweight label and can optionally carry an icon, properties, a template, a default folder, explicit inheritance (`extends`), and saved views.
_Avoid_: Type, supertag, category, label

**Sub-tag**:
A tag nested under a parent tag with `/` (such as `#book/sci-fi`). A note carrying a sub-tag belongs to every ancestor tag and inherits their properties automatically.
_Avoid_: Nested type, child category

**Property**:
A structured key-value fact stored on a note, either declared by one of the note's tags or carried directly on the note.
_Avoid_: Field, attribute, metadata

**Folder**:
A directory on disk where a note's Markdown file lives. Folders organize physical storage independently of tags; a tag may optionally specify a default folder for newly created notes.
_Avoid_: Notebook, space

**Collection**:
A reusable saved selection of notes across one or more tags, relations, or explicit includes and excludes.
_Avoid_: Database, smart folder

**View**:
A presentation of a tag's notes or a collection (table, board, calendar, gallery, timeline, or list) with its own sort, grouping, and filters.
_Avoid_: Layout, lens

**Mention**:
An inline `#tag` written inside prose. It appears in the tag's mentions without assigning the tag or its properties to the note.
_Avoid_: Inline tag, body tag
