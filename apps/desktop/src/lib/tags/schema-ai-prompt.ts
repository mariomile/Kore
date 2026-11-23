/**
 * The chat request the tag config surfaces draft for "Suggest with AI": the
 * chat already knows how to read a tag's notes and propose its schema
 * (`set_tag_schema` on BYOK models, the `kore-collections` skill on the CLI
 * engines), so the config dialog only has to ask. Drafted, never sent: the
 * user reads it, adds what they care about, and sends it themselves.
 */
export function tagSchemaAiPrompt(tagKey: string): string {
  return `Read the notes tagged #${tagKey} and propose the properties this tag should track: a name and a type for each, with the options for select and status properties. Show me the schema before changing anything.`
}
