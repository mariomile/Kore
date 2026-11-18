/** Just enough of a KV namespace (a Map) for the OAuth provider in tests. */
export function fakeKV(): KVNamespace {
  const entries = new Map<string, string>()
  const kv = {
    get: async (key: string, options?: string | { type?: string }) => {
      const value = entries.get(key)
      if (value === undefined) {
        return null
      }
      const type = typeof options === 'string' ? options : options?.type
      return type === 'json' ? (JSON.parse(value) as unknown) : value
    },
    put: async (key: string, value: string) => {
      entries.set(key, value)
    },
    delete: async (key: string) => {
      entries.delete(key)
    },
    list: async (options?: { prefix?: string }) => ({
      keys: [...entries.keys()]
        .filter((name) => name.startsWith(options?.prefix ?? ''))
        .map((name) => ({ name })),
      list_complete: true,
      cacheStatus: null,
    }),
  }
  return kv as unknown as KVNamespace
}
