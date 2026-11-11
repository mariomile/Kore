import type { TaskRepeat } from '@kore/core'

/** A Quick Add repeat rule as chip text: every week → "Every week", every 2 weeks → "Every 2 weeks". */
export function quickAddRepeatLabel(repeat: TaskRepeat | null): string {
  if (repeat === null) {
    return 'Repeats'
  }
  return repeat.every === 1 ? `Every ${repeat.unit}` : `Every ${repeat.every} ${repeat.unit}s`
}
