import { propertyKeyForName, type TagProperty, type TagPropertyType } from '@reflect/core'
import { readTagDefinition, saveTagType } from '@/lib/tags/tag-type-write'

/**
 * One-gesture schema edits from a collection surface (the table header's "+"
 * and column menus): read the tag's definition, change one property, save
 * through the same writer the config dialog uses. The definition note is
 * born on the first add when the tag had none — every tag is a collection,
 * and its first property is what makes the schema exist.
 */

/** Append a property named `name` of `type`; returns the property written. */
export async function addTagProperty(
  tag: string,
  generation: number,
  name: string,
  type: TagPropertyType,
): Promise<TagProperty> {
  const trimmed = name.trim()
  const key = propertyKeyForName(trimmed)
  if (trimmed === '' || key === '') {
    throw new Error('A property needs a name made of letters or numbers.')
  }
  const definition = await readTagDefinition(tag)
  if (definition.properties.some((property) => property.key === key)) {
    throw new Error(`#${tag} already has a "${trimmed}" property.`)
  }
  const property: TagProperty = { name: trimmed, key, type }
  await saveTagType(tag, [...definition.properties, property], generation, definition.template)
  return property
}

/** Drop the property under `key`; a key the schema no longer has is a no-op. */
export async function removeTagProperty(
  tag: string,
  generation: number,
  key: string,
): Promise<void> {
  const definition = await readTagDefinition(tag)
  const remaining = definition.properties.filter((property) => property.key !== key)
  if (remaining.length === definition.properties.length) {
    return
  }
  await saveTagType(tag, remaining, generation, definition.template)
}
