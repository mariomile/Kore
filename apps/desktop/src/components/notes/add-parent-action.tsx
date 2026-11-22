import type { ReactElement } from "react";
import { Note } from "@/components/icons";
import { RelationPropertyEditor } from "@/components/tags/relation-property-editor";
import { PARENT_NOTE_PROPERTY } from "@/lib/notes/parent-note";
import { useCommitNoteProperty } from "@/lib/tags/use-commit-note-property";

interface AddParentActionProps {
  /** Graph-relative path of the note that gets the parent. */
  path: string;
  /** The hover row's shared action look ("Add icon", "Add cover"). */
  className: string;
}

/**
 * "Add parent" in the title's hover row: the relation note picker, writing
 * the pick to `up:`. The parent then shows as the breadcrumb above the title
 * and as the `up` row in the properties, where it is changed or cleared.
 */
export function AddParentAction({
  path,
  className,
}: AddParentActionProps): ReactElement {
  const commitProperty = useCommitNoteProperty();
  return (
    // The picker's trigger fills its parent; the wrapper sizes it to the label.
    <div className="w-fit">
      <RelationPropertyEditor
        property={PARENT_NOTE_PROPERTY}
        value={undefined}
        onCommit={(value) =>
          commitProperty(path, PARENT_NOTE_PROPERTY.key, value)
        }
      >
        <span className={className}>
          <Note aria-hidden className="size-3.5" />
          Add parent
        </span>
      </RelationPropertyEditor>
    </div>
  );
}
