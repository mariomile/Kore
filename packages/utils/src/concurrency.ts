/**
 * Run `each` over `items` with at most `limit` calls in flight, and resolve
 * once every call has settled successfully. Calls start in item order; they
 * may finish in any order, so a caller that needs ordered output writes into
 * slots by `index` instead of pushing.
 */
export async function forEachConcurrent<T>(
  items: readonly T[],
  limit: number,
  each: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      await each(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(limit, 1), items.length) }, worker))
}
