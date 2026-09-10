import {
  createNoteIfAbsent,
  createNoteWithTitle,
  foldTag,
  getNoteIdsByPath,
  getTagType,
  parseNote,
  parseCollectionDefinitionSource,
  readNote,
  resolveCollectionNoteReference,
  untitledNotePath,
  untitledNoteSeed,
  updateCollectionDefinitionSource,
  type CollectionDefinition,
  type CollectionDefinitionConfig,
  type TemplatePlaceholderValues,
} from '@reflect/core'
import {
  commitNoteBodyTransform,
  commitNoteFrontmatter,
  readNoteSource,
} from '@/lib/note-frontmatter'
import {
  createTitledCollectionNote,
  createTypedCollectionNote,
} from '@/lib/tags/create-collection-note'

/** Create an ordinary named note and mark its nested Kore config as a collection definition. */
export async function createReusableCollectionDefinition(
  title: string,
  config: CollectionDefinitionConfig,
  generation: number,
): Promise<CollectionDefinition> {
  const path = await createNoteWithTitle(title.trim(), generation)
  await saveReusableCollectionDefinition(path, config, generation)
  const definition = parseCollectionDefinitionSource(await readNote(path, generation), path)
  if (definition === null) {
    throw new Error("The collection definition couldn't be read after it was created.")
  }
  return definition
}

/** Update only `kore.collection`, through the live note session when one owns the file. */
export async function saveReusableCollectionDefinition(
  path: string,
  config: CollectionDefinitionConfig,
  generation: number,
): Promise<void> {
  await commitNoteBodyTransform(
    path,
    (source) => updateCollectionDefinitionSource(source, config),
    generation,
  )
}

async function updateReusableCollectionDefinition(
  definitionPath: string,
  generation: number,
  update: (
    config: CollectionDefinitionConfig,
  ) => CollectionDefinitionConfig | Promise<CollectionDefinitionConfig>,
): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const source = await readNoteSource(definitionPath)
    const snapshot = parseCollectionDefinitionSource(source, definitionPath)
    if (snapshot === null) {
      throw new Error('The collection definition is unavailable or invalid.')
    }
    const nextConfig = await update(snapshot.config)
    const snapshotConfig = JSON.stringify(snapshot.config)
    let changedWhileResolving = false
    await commitNoteBodyTransform(
      definitionPath,
      (latestSource) => {
        const latest = parseCollectionDefinitionSource(latestSource, definitionPath)
        if (latest === null) {
          throw new Error('The collection definition is unavailable or invalid.')
        }
        if (JSON.stringify(latest.config) !== snapshotConfig) {
          changedWhileResolving = true
          return latestSource
        }
        return updateCollectionDefinitionSource(latestSource, nextConfig)
      },
      generation,
    )
    if (!changedWhileResolving) {
      return
    }
  }
  throw new Error('The collection definition changed while it was being updated. Try again.')
}

interface CreateReusableCollectionRowOptions {
  readonly definition: CollectionDefinition
  readonly generation: number
  readonly title?: string
  readonly properties?: Record<string, unknown>
  readonly templateValues?: TemplatePlaceholderValues
}

/** Create an original note using explicit collection defaults plus the view seed. */
export async function createReusableCollectionRow({
  definition,
  generation,
  title,
  properties = {},
  templateValues = { title: title ?? '', date: '', dateIso: '', time: '' },
}: CreateReusableCollectionRowOptions): Promise<string> {
  const defaults = definition.config.create
  const tag = defaults?.tag
  const values = { ...(defaults?.properties ?? {}), ...properties }
  let path: string
  if (tag !== undefined) {
    const type = await getTagType(tag)
    path =
      title !== undefined && title.trim() !== ''
        ? await createTitledCollectionNote(tag, generation, title.trim(), type, templateValues)
        : await createTypedCollectionNote(tag, generation, values, type, templateValues)
  } else if (title !== undefined && title.trim() !== '') {
    path = await createNoteWithTitle(title.trim(), generation)
  } else {
    path = untitledNotePath()
    await createNoteIfAbsent(path, untitledNoteSeed(), generation)
  }

  if (Object.keys(values).length > 0 && (tag === undefined || title?.trim())) {
    await commitNoteFrontmatter(path, { properties: values }, generation)
  }

  if (!(await defaultsMatchAutomaticSources(definition.config, tag, values))) {
    await addReusableCollectionMember(definition, path, generation)
  }
  return path
}

/** Add an existing note manually, undoing a prior exclusion of the same path. */
export async function addReusableCollectionMember(
  definition: CollectionDefinition,
  path: string,
  generation: number,
): Promise<void> {
  const reference = await stableCollectionReferenceForPath(path)
  await updateReusableCollectionDefinition(definition.path, generation, async (config) => {
    const equivalentExclusions = await referencesResolvingToPath(config.sources.exclude, path)
    return {
      ...config,
      sources: {
        ...config.sources,
        include: [...new Set([...config.sources.include, reference])],
        exclude: config.sources.exclude.filter(
          (entry) => entry !== reference && entry !== path && !equivalentExclusions.has(entry),
        ),
      },
    }
  })
}

/** Remove a row from the reusable selection, never deleting the original note. */
export async function removeReusableCollectionMember(
  definition: CollectionDefinition,
  path: string,
  generation: number,
): Promise<void> {
  const reference = await stableCollectionReferenceForPath(path)
  await updateReusableCollectionDefinition(definition.path, generation, async (config) => {
    const equivalentIncludes = await referencesResolvingToPath(config.sources.include, path)
    return {
      ...config,
      sources: {
        ...config.sources,
        include: config.sources.include.filter(
          (entry) => entry !== reference && entry !== path && !equivalentIncludes.has(entry),
        ),
        exclude: [...new Set([...config.sources.exclude, reference])],
      },
    }
  })
}

export async function stableCollectionReferenceForPath(path: string): Promise<string> {
  const sourceId = parseNote({ path, source: await readNoteSource(path) }).id
  const id = sourceId ?? (await getNoteIdsByPath([path])).get(path)
  if (id === null || id === undefined) {
    return path
  }
  const resolved = await resolveCollectionNoteReference(id)
  return resolved.status === 'unresolved' ||
    (resolved.status === 'resolved' && resolved.path === path)
    ? id
    : path
}

/** Remove exclusions that resolve to notes explicitly included by path. */
export async function removeReusableCollectionExclusionsForPaths(
  exclusions: readonly string[],
  includedPaths: readonly string[],
): Promise<string[]> {
  const included = new Set(includedPaths)
  const resolutions = await Promise.all(
    exclusions.map((reference) => resolveCollectionNoteReference(reference)),
  )
  return exclusions.filter((_, index) => {
    const resolution = resolutions[index]
    return resolution?.status !== 'resolved' || !included.has(resolution.path)
  })
}

async function referencesResolvingToPath(
  references: readonly string[],
  path: string,
): Promise<Set<string>> {
  const equivalent = new Set<string>()
  await Promise.all(
    references.map(async (reference) => {
      const resolved = await resolveCollectionNoteReference(reference)
      if (resolved.status === 'resolved' && resolved.path === path) {
        equivalent.add(reference)
      }
    }),
  )
  return equivalent
}

async function defaultsMatchAutomaticSources(
  config: CollectionDefinitionConfig,
  tag: string | undefined,
  properties: Record<string, unknown>,
): Promise<boolean> {
  const hasTagSource = config.sources.tags.length > 0
  const relation = config.sources.relation
  if (!hasTagSource && relation === undefined) {
    return false
  }
  const tagMatches =
    !hasTagSource ||
    (tag !== undefined && config.sources.tags.some((entry) => foldTag(entry) === foldTag(tag)))
  if (!tagMatches || relation === undefined) {
    return tagMatches
  }

  const configured = await resolveCollectionNoteReference(relation.target)
  if (configured.status !== 'resolved') {
    return false
  }
  const raw = properties[relation.key]
  const references = Array.isArray(raw) ? raw : [raw]
  for (const reference of references) {
    if (typeof reference !== 'string') continue
    const resolved = await resolveCollectionNoteReference(reference)
    if (resolved.status === 'resolved' && resolved.path === configured.path) {
      return true
    }
  }
  return false
}
