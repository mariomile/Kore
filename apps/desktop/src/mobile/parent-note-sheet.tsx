import type { ReactElement } from "react";
import { displayNoteTitle } from "@kore/core";
import { useNoteRow } from "@/hooks/use-note-row";
import { PARENT_NOTE_PROPERTY } from "@/lib/notes/parent-note";
import { useCommitNoteProperty } from "@/lib/tags/use-commit-note-property";
import { useNoteTypedProperties } from "@/lib/tags/use-note-typed-properties";
import { useOpenRelation } from "@/lib/tags/use-open-relation";
import { MobileCellEditorDrawer } from "@/mobile/collection/mobile-cell-editor-drawer";

/**
 * The ⋯ menu's "Parent note" sheet: the collection cells' relation sheet,
 * aimed at this note's `up:`. Pick a note to set or change the parent, Open
 * to follow it, Clear to remove it.
 */
export function ParentNoteSheet({
  path,
  onClose,
}: {
  path: string;
  onClose: () => void;
}): ReactElement {
  const { values } = useNoteTypedProperties(path);
  const row = useNoteRow(path);
  const commitProperty = useCommitNoteProperty();
  const openRelation = useOpenRelation();
  return (
    <MobileCellEditorDrawer
      target={{
        entryPath: path,
        entryTitle: row === null ? "" : displayNoteTitle(row.title),
        property: PARENT_NOTE_PROPERTY,
        value: values?.[PARENT_NOTE_PROPERTY.key],
      }}
      onClose={onClose}
      onCommit={commitProperty}
      onOpenRelation={openRelation}
    />
  );
}
