import { PARENT_PROPERTY_KEY, type TagProperty } from "@kore/core";

/**
 * The note's `up:` parent as a relation field, so "Add parent" (Mac) and
 * "Parent note" (iPhone ⋯) reuse the relation pickers every property row
 * uses: one verified note search, one `[[link]]` write, the breadcrumb above
 * the title follows through the index.
 */
export const PARENT_NOTE_PROPERTY: TagProperty = {
  name: "Parent note",
  key: PARENT_PROPERTY_KEY,
  type: "relation",
};
