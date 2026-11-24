import { useQuery } from '@tanstack/react-query'
import { HTML_TITLE_SCAN_CHARS, htmlDocumentTitle } from '@kore/core'

/** The first `chars` characters of a response, without reading the rest. */
async function readTextPrefix(response: Response, chars: number): Promise<string> {
  if (response.body === null) {
    return (await response.text()).slice(0, chars)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (text.length < chars) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      text += decoder.decode(value, { stream: true })
    }
  } finally {
    void reader.cancel()
  }
  return text.slice(0, chars)
}

async function fetchHtmlTitle(url: string): Promise<string | null> {
  const response = await fetch(url)
  if (!response.ok) {
    return null
  }
  return htmlDocumentTitle(await readTextPrefix(response, HTML_TITLE_SCAN_CHARS))
}

/**
 * The title an HTML file shows its reader (`<title>`, else its first
 * heading), read off its asset URL. Only the page's head is read, once per
 * `version` (pass the file's modified time so an edit refreshes it).
 * Undefined while loading, null when the page has none.
 */
export function useHtmlTitle(
  url: string | null,
  version: number | null = null,
): string | null | undefined {
  const { data } = useQuery({
    queryKey: ['html-title', url, version],
    queryFn: () => (url === null ? null : fetchHtmlTitle(url)),
    enabled: url !== null,
    staleTime: Infinity,
  })
  return url === null ? null : data
}
