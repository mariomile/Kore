import {
  propertyKeyForName,
  withPropertyType,
  type TagProperty,
  type TagPropertyType,
} from '@kore/core'
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
  await saveTagType(tag, [...definition.properties, property], generation)
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
  await saveTagType(tag, remaining, generation)
}

/**
 * Switch the property under `key` to `type` (`withPropertyType`): the
 * note's field-label menu. The schema changes for every note of the tag;
 * stored values stay under the same key. A key the schema no longer has, or
 * a type it already has, is a no-op.
 */
export async function setTagPropertyType(
  tag: string,
  generation: number,
  key: string,
  type: TagPropertyType,
): Promise<void> {
  const definition = await readTagDefinition(tag)
  const current = definition.properties.find((property) => property.key === key)
  if (current === undefined || current.type === type) {
    return
  }
  const next = definition.properties.map((property) =>
    property.key === key ? withPropertyType(property, type) : property,
  )
  await saveTagType(tag, next, generation)
}
