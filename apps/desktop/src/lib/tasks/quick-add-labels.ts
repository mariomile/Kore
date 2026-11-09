/** A Quick Add `@repeat(…)` spec as chip text: `weekly` → "Every week", `2w` → "Every 2 weeks". */
export function quickAddRepeatLabel(spec: string | null): string {
  if (spec === null) {
    return 'Repeats'
  }
  const words: Readonly<Record<string, string>> = {
    daily: 'Every day',
    weekly: 'Every week',
    monthly: 'Every month',
    yearly: 'Every year',
  }
  if (words[spec] !== undefined) {
    return words[spec]
  }
  const counted = /^(\d{1,3})([dwmy])$/.exec(spec)
  if (counted === null) {
    return `Repeats ${spec}`
  }
  const units: Readonly<Record<string, string>> = { d: 'day', w: 'week', m: 'month', y: 'year' }
  const count = Number(counted[1])
  const unit = units[counted[2]!]!
  return count === 1 ? `Every ${unit}` : `Every ${count} ${unit}s`
}
