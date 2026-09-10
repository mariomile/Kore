import {
  COLLECTION_DEFINITION_MARKER_KEY,
  type IndexedPropertyValueType,
  type TagProperty,
  type TagPropertyType,
  type TagType,
} from '../tags'
import type { CollectionEntry, TagTypeEntry } from './collections'

export type CollectionSchemaConflict = 'schema' | 'value-type'

/** One merged column from source-tag declarations and actual note values. */
export interface CollectionSchemaField {
  readonly key: string
  /** Canonical display/editor shape; conflict fields are display-only. */
  readonly property: TagProperty
  readonly declaredBy: readonly string[]
  readonly valueTypes: readonly IndexedPropertyValueType[]
  readonly editable: boolean
  readonly conflict: CollectionSchemaConflict | null
}

/** Schema union for a mixed collection, with conflicts kept visible. */
export interface CollectionPropertySchema {
  readonly fields: readonly CollectionSchemaField[]
  /** Existing collection surfaces can consume the same ordered columns. */
  readonly type: TagType
}

function inferredProperty(key: string, valueType: IndexedPropertyValueType): TagProperty {
  const type: TagPropertyType =
    valueType === 'number'
      ? 'number'
      : valueType === 'boolean'
        ? 'checkbox'
        : valueType === 'list'
          ? 'multiselect'
          : 'text'
  return { name: key, key, type }
}

function expectedValueType(type: TagPropertyType): IndexedPropertyValueType | null {
  if (type === 'number' || type === 'rating') {
    return 'number'
  }
  if (type === 'checkbox') {
    return 'boolean'
  }
  if (type === 'multiselect' || type === 'relations' || type === 'files') {
    return 'list'
  }
  if (type === 'rollup' || type === 'reverse' || type === 'formula' || type === 'updated') {
    return null
  }
  return 'string'
}

function samePropertyContract(left: TagProperty, right: TagProperty): boolean {
  return (
    left.type === right.type &&
    left.target === right.target &&
    JSON.stringify(left.rollup) === JSON.stringify(right.rollup) &&
    JSON.stringify(left.reverse) === JSON.stringify(right.reverse) &&
    JSON.stringify(left.formula) === JSON.stringify(right.formula)
  )
}

function mergePropertyOptions(
  property: TagProperty,
  declarations: readonly TagProperty[],
): TagProperty {
  const options = [...new Set(declarations.flatMap((declaration) => declaration.options ?? []))]
  return options.length === 0 ? property : { ...property, options }
}

/**
 * Merge source-tag declarations with the properties actually present on rows.
 * A semantic-schema or storage-type disagreement remains visible and read-only.
 */
export function deriveCollectionPropertySchema(
  tagTypes: readonly TagTypeEntry[],
  entries: readonly Pick<CollectionEntry, 'properties'>[],
): CollectionPropertySchema {
  const declarations = new Map<string, Array<{ tagKey: string; property: TagProperty }>>()
  const order: string[] = []
  for (const tagType of tagTypes) {
    for (const property of tagType.type.properties) {
      if (!declarations.has(property.key)) {
        order.push(property.key)
      }
      const values = declarations.get(property.key) ?? []
      values.push({ tagKey: tagType.tagKey, property })
      declarations.set(property.key, values)
    }
  }

  const valueTypes = new Map<string, Set<IndexedPropertyValueType>>()
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.properties)) {
      if (key === COLLECTION_DEFINITION_MARKER_KEY) {
        continue
      }
      if (!valueTypes.has(key) && !declarations.has(key)) {
        order.push(key)
      }
      const types = valueTypes.get(key) ?? new Set<IndexedPropertyValueType>()
      types.add(value.valueType)
      valueTypes.set(key, types)
    }
  }

  const fields = order.flatMap((key): CollectionSchemaField[] => {
    const declared = declarations.get(key) ?? []
    const actualTypes = [...(valueTypes.get(key) ?? [])].sort()
    if (declared.length === 0) {
      if (actualTypes.length === 0) {
        return []
      }
      const property = inferredProperty(key, actualTypes[0]!)
      const conflict = actualTypes.length > 1 ? 'value-type' : null
      return [
        {
          key,
          property,
          declaredBy: [],
          valueTypes: actualTypes,
          editable: conflict === null,
          conflict,
        },
      ]
    }

    const declarationProperties = declared.map((entry) => entry.property)
    const property = mergePropertyOptions(declarationProperties[0]!, declarationProperties)
    const schemaConflict = declarationProperties.some(
      (candidate) => !samePropertyContract(property, candidate),
    )
    const expected = expectedValueType(property.type)
    const valueConflict = actualTypes.some((valueType) => valueType !== expected)
    const conflict: CollectionSchemaConflict | null = schemaConflict
      ? 'schema'
      : valueConflict
        ? 'value-type'
        : null
    return [
      {
        key,
        property,
        declaredBy: declared.map((entry) => entry.tagKey),
        valueTypes: actualTypes,
        editable: conflict === null && expected !== null,
        conflict,
      },
    ]
  })
  return { fields, type: { properties: fields.map((field) => field.property) } }
}
