import { z } from 'zod'
import { Document, isMap, parseDocument } from 'yaml'
import { isTagName, parseNote, splitFrontmatter, type Frontmatter } from '../markdown'
import { isPropertyKey } from './tag-type'

/** Scalar marker used by the generic property index to discover definitions. */
export const COLLECTION_DEFINITION_MARKER_KEY = 'koreCollection'
/** Namespace holding Kore-owned note configuration. */
export const KORE_CONFIG_KEY = 'kore'

const collectionPropertyValueSchema = z.union([
  z.string(),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string(), z.number().finite(), z.boolean()])),
])

const collectionRelationSchema = z.object({
  key: z.string().refine(isPropertyKey),
  target: z.string().trim().min(1),
})

const collectionSourcesSchema = z.object({
  tags: z.array(z.string().refine(isTagName)).default([]),
  relation: collectionRelationSchema.optional(),
  include: z.array(z.string().trim().min(1)).default([]),
  exclude: z.array(z.string().trim().min(1)).default([]),
})

const collectionCreateSchema = z
  .object({
    tag: z.string().refine(isTagName).optional(),
    properties: z.record(z.string(), collectionPropertyValueSchema).default({}),
  })
  .superRefine((value, context) => {
    for (const key of Object.keys(value.properties)) {
      if (!isPropertyKey(key)) {
        context.addIssue({
          code: 'custom',
          path: ['properties', key],
          message: 'invalid or reserved property key',
        })
      }
    }
  })

export const collectionDefinitionConfigSchema = z.object({
  version: z.literal(1),
  sources: collectionSourcesSchema,
  create: collectionCreateSchema.optional(),
})

/** Portable, note-owned selection rules for a reusable collection. */
export type CollectionDefinitionConfig = z.infer<typeof collectionDefinitionConfigSchema>

/** A parsed collection definition and the ordinary note that owns it. */
export interface CollectionDefinition {
  readonly id: string | null
  readonly path: string
  readonly title: string
  readonly config: CollectionDefinitionConfig
}

/** Parse the namespaced config when the explicit discovery marker is present. */
export function parseCollectionDefinitionFrontmatter(
  frontmatter: Frontmatter,
): CollectionDefinitionConfig | null {
  if (frontmatter[COLLECTION_DEFINITION_MARKER_KEY] !== true) {
    return null
  }
  const kore = frontmatter[KORE_CONFIG_KEY]
  if (kore === null || typeof kore !== 'object' || Array.isArray(kore)) {
    return null
  }
  const parsed = collectionDefinitionConfigSchema.safeParse(
    (kore as Record<string, unknown>)['collection'],
  )
  return parsed.success ? parsed.data : null
}

/** Parse one definition note from its Markdown source. */
export function parseCollectionDefinitionSource(
  source: string,
  path: string,
): CollectionDefinition | null {
  const parsed = parseNote({ path, source })
  const config = parseCollectionDefinitionFrontmatter(parsed.frontmatter)
  return config === null
    ? null
    : {
        id: parsed.id ?? null,
        path,
        title: parsed.title,
        config,
      }
}

/**
 * Set a note's collection definition while preserving its body, other
 * frontmatter, and sibling keys in the `kore` namespace.
 */
export function updateCollectionDefinitionSource(
  source: string,
  config: CollectionDefinitionConfig,
): string {
  const validated = collectionDefinitionConfigSchema.parse(config)
  const split = splitFrontmatter(source)
  if (split.raw === null) {
    const document = new Document({
      [COLLECTION_DEFINITION_MARKER_KEY]: true,
      [KORE_CONFIG_KEY]: { collection: validated },
    })
    return `---\n${String(document).trimEnd()}\n---\n${source}`
  }

  const document = parseDocument(split.raw)
  if (document.errors.length > 0 || !isMap(document.contents)) {
    throw new Error('cannot update malformed frontmatter')
  }
  document.set(COLLECTION_DEFINITION_MARKER_KEY, true)
  const kore = document.get(KORE_CONFIG_KEY, true)
  if (isMap(kore)) {
    document.setIn([KORE_CONFIG_KEY, 'collection'], validated)
  } else {
    document.set(KORE_CONFIG_KEY, { collection: validated })
  }
  return `---\n${String(document).trimEnd()}\n---\n${split.body}`
}
