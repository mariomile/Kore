import { useEffect, useState } from 'react'

/**
 * A vault file read ahead as a `File`, so a Share tap can hand it to
 * `navigator.share` at once: the share sheet needs the tap's transient
 * activation, which an `await` between the tap and the call would spend.
 * Null while reading, when reading fails, or when `url` is null.
 */
export function useShareableFile(url: string | null, name: string, type: string): File | null {
  const [file, setFile] = useState<{ url: string; file: File } | null>(null)
  useEffect(() => {
    if (url === null) {
      return
    }
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal })
        if (response.ok) {
          setFile({ url, file: new File([await response.blob()], name, { type }) })
        }
      } catch {
        // No file to share: the Share button stays disabled.
      }
    })()
    return () => {
      controller.abort()
    }
  }, [url, name, type])
  return file !== null && file.url === url ? file.file : null
}
