/**
 * Human-readable size: one decimal of GB at gigabyte scale, whole MB at
 * megabyte scale, whole KB below it. Resident sets reach gigabytes, where
 * "1229 MB" reads worse than "1.2 GB".
 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  }
  if (bytes >= 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024))} MB`
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}
