import {
  companySeedTypes,
  createNoteIfAbsent,
  noteExists,
  TAG_TYPE_MARKER,
  tagDefinitionPath,
  upsertFrontmatter,
} from '@reflect/core'

/**
 * Write the company starter types when missing. Idempotent: existing
 * `tags/*.md` and `templates/*.md` are left alone so a teammate's edits win.
 */
export async function ensureCompanyGraphSeed(generation: number): Promise<void> {
  for (const entry of companySeedTypes()) {
    const definitionPath = tagDefinitionPath(entry.tag)
    if (!(await noteExists(definitionPath))) {
      const source = upsertFrontmatter(`# ${entry.tag}\n\n${entry.definitionBody}\n`, {
        lore: TAG_TYPE_MARKER,
        template: entry.templatePath,
        properties: entry.properties.map((property) => ({
          name: property.name,
          key: property.key,
          type: property.type,
          ...(property.options === undefined ? {} : { options: property.options }),
        })),
      })
      await createNoteIfAbsent(definitionPath, source, generation)
    }
    if (!(await noteExists(entry.templatePath))) {
      await createNoteIfAbsent(entry.templatePath, `${entry.templateBody}\n`, generation)
    }
  }
}
