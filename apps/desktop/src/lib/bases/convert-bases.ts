import {
  convertBaseToTypeViews,
  errorMessage,
  inferConvertedFields,
  mergeConvertedViews,
  parseBaseFile,
  readBaseFile,
  type SavedCollectionView,
} from '@kore/core'
import { readTagDefinition, saveTagType } from '@/lib/tags/tag-type-write'

/** What converting one or more bases did, for the summary the user reads. */
export interface BasesConversionReport {
  converted: {
    path: string
    tag: string
    views: number
    fields: number
    notes: string[]
  }[]
  skipped: { path: string; reason: string }[]
}

/**
 * Turn bases into their types' own views (organization point 3). Each base
 * that lists one tag's notes adds its views as tabs of that tag's database
 * and its columns as fields, creating the type when the tag had none. The
 * `.base` files are only read: Obsidian keeps them, and Kore keeps showing
 * them. Bases about the same tag land in one write per type. Converting a
 * base again replaces its earlier tabs instead of adding copies.
 */
export async function convertBasesToTypes(
  paths: readonly string[],
  generation: number,
): Promise<BasesConversionReport> {
  const report: BasesConversionReport = { converted: [], skipped: [] }
  const byTag = new Map<
    string,
    {
      path: string
      views: SavedCollectionView[]
      columns: { key: string; name: string }[]
      notes: string[]
    }[]
  >()
  for (const path of paths) {
    let plan
    try {
      plan = convertBaseToTypeViews(path, parseBaseFile(await readBaseFile(path, generation)))
    } catch (error) {
      report.skipped.push({ path, reason: `it couldn't be read (${errorMessage(error)})` })
      continue
    }
    if (plan.kind === 'skipped') {
      report.skipped.push({ path, reason: plan.reason })
      continue
    }
    const list = byTag.get(plan.tag) ?? []
    list.push({ path, views: plan.views, columns: plan.columns, notes: plan.notes })
    byTag.set(plan.tag, list)
  }

  for (const [tag, plans] of byTag) {
    try {
      const definition = await readTagDefinition(tag)
      if (definition.needsConversion) {
        for (const plan of plans) {
          report.skipped.push({
            path: plan.path,
            reason: `${definition.path} is a regular note, so #${tag} can't become a type without your say`,
          })
        }
        continue
      }
      const views = plans.reduce<SavedCollectionView[]>(
        (merged, plan) => mergeConvertedViews(merged, plan.views),
        definition.views ?? [],
      )
      const fields = await inferConvertedFields(
        tag,
        plans.flatMap((plan) => plan.columns),
        definition.properties,
      )
      await saveTagType(tag, [...definition.properties, ...fields], generation, { views })
      for (const plan of plans) {
        report.converted.push({
          path: plan.path,
          tag,
          views: plan.views.length,
          fields: fields.filter((field) => plan.columns.some((column) => column.key === field.key))
            .length,
          notes: plan.notes,
        })
      }
    } catch (error) {
      for (const plan of plans) {
        report.skipped.push({ path: plan.path, reason: errorMessage(error) })
      }
    }
  }
  return report
}
