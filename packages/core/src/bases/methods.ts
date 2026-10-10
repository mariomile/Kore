import { formatBaseDate } from './dates'
import {
  asNumber,
  asText,
  htmlText,
  isTruthy,
  rowHasTag,
  rowInFolder,
  type BaseDuration,
  type BaseEvaluationContext,
  type BaseNoteRow,
  baseValuesEqual,
  compareBaseValues,
  DAY_MS,
  fail,
  isKind,
  type BaseList,
  type BaseValue,
} from './values'

/** Methods on plain values: numbers, text and lists (`.round()`, `.split()`, `.join()`…). */

export function numberMethod(target: number, name: string, args: readonly BaseValue[]): BaseValue {
  const digits = args[0] === undefined ? 0 : asNumber(args[0], name)
  const factor = 10 ** digits
  switch (name) {
    case 'round':
      return Math.round(target * factor) / factor
    case 'floor':
      return Math.floor(target)
    case 'ceil':
      return Math.ceil(target)
    case 'abs':
      return Math.abs(target)
    case 'toFixed':
      return target.toFixed(digits)
    default:
      return fail(`unknown number method ${name}`)
  }
}

export function stringMethod(target: string, name: string, args: readonly BaseValue[]): BaseValue {
  const first = args[0] ?? null
  const texts = args.map(asText)
  switch (name) {
    case 'contains':
      return target.includes(asText(first))
    case 'containsAll':
      return texts.every((text) => target.includes(text))
    case 'containsAny':
      return texts.some((text) => target.includes(text))
    case 'startsWith':
      return target.startsWith(asText(first))
    case 'endsWith':
      return target.endsWith(asText(first))
    case 'lower':
      return target.toLowerCase()
    case 'upper':
      return target.toUpperCase()
    case 'title':
      return target.replaceAll(/\b\p{L}/gu, (letter) => letter.toUpperCase())
    case 'trim':
      return target.trim()
    case 'reverse':
      return [...target].reverse().join('')
    case 'repeat':
      return target.repeat(Math.max(0, asNumber(first, 'repeat')))
    case 'replace':
      return target.replaceAll(asText(first), asText(args[1] ?? ''))
    case 'slice':
      return target.slice(
        args[0] === undefined ? 0 : asNumber(args[0], 'slice'),
        args[1] === undefined ? undefined : asNumber(args[1], 'slice'),
      )
    case 'split': {
      const parts = target.split(asText(first))
      const limit = args[1] === undefined ? undefined : asNumber(args[1], 'split')
      return { kind: 'list', items: limit === undefined ? parts : parts.slice(0, limit) }
    }
    default:
      return fail(`unknown text method ${name}`)
  }
}

export function listMethod(target: BaseList, name: string, args: readonly BaseValue[]): BaseValue {
  const first = args[0] ?? null
  switch (name) {
    case 'contains':
      return target.items.some((item) => baseValuesEqual(item, first))
    case 'containsAll':
      return args.every((arg) => target.items.some((item) => baseValuesEqual(item, arg)))
    case 'containsAny':
      return args.some((arg) => target.items.some((item) => baseValuesEqual(item, arg)))
    case 'join':
      return target.items.map(asText).join(first === null ? ',' : asText(first))
    case 'reverse':
      return { kind: 'list', items: [...target.items].reverse() }
    case 'sort':
      return {
        kind: 'list',
        items: [...target.items].sort((left, right) => compareBaseValues(left, right) ?? 0),
      }
    case 'unique': {
      const seen: BaseValue[] = []
      for (const item of target.items) {
        if (!seen.some((existing) => baseValuesEqual(existing, item))) {
          seen.push(item)
        }
      }
      return { kind: 'list', items: seen }
    }
    case 'flat':
      return {
        kind: 'list',
        items: target.items.flatMap((item) => (isKind(item, 'list') ? item.items : [item])),
      }
    case 'slice':
      return {
        kind: 'list',
        items: target.items.slice(
          args[0] === undefined ? 0 : asNumber(args[0], 'slice'),
          args[1] === undefined ? undefined : asNumber(args[1], 'slice'),
        ),
      }
    default:
      return fail(`unknown list method ${name}`)
  }
}

export function relativeText(deltaMs: number): string {
  const days = Math.round(Math.abs(deltaMs) / DAY_MS)
  if (days === 0) {
    return 'today'
  }
  const amount = days === 1 ? '1 day' : `${days} days`
  return deltaMs < 0 ? `${amount} ago` : `in ${amount}`
}

export function durationField(duration: BaseDuration, name: string): BaseValue {
  const units: Record<string, number> = {
    milliseconds: 1,
    seconds: 1000,
    minutes: 60_000,
    hours: 3_600_000,
    days: DAY_MS,
    weeks: 7 * DAY_MS,
    months: 30 * DAY_MS,
    years: 365 * DAY_MS,
  }
  const unit = units[name]
  return unit === undefined ? null : duration.ms / unit
}

export function valueMethod(
  target: BaseValue,
  name: string,
  args: readonly BaseValue[],
  context: BaseEvaluationContext,
): BaseValue {
  const first = args[0] ?? null
  // Methods every value has.
  switch (name) {
    case 'toString':
      return asText(target)
    case 'isEmpty':
      return !isTruthy(target) || (isKind(target, 'html') && htmlText(target.html) === '')
    case 'isTruthy':
      return isTruthy(target)
  }
  if (isKind(target, 'file')) {
    return fileMethod(target.row, name, args, context)
  }
  if (target === null) {
    return null
  }
  if (typeof target === 'number') {
    return numberMethod(target, name, args)
  }
  if (typeof target === 'string') {
    return stringMethod(target, name, args)
  }
  if (isKind(target, 'list')) {
    return listMethod(target, name, args)
  }
  if (isKind(target, 'date')) {
    switch (name) {
      case 'format':
        return formatBaseDate(target.ms, asText(first))
      case 'date':
        return { kind: 'date', ms: new Date(target.ms).setHours(0, 0, 0, 0), time: false }
      case 'time':
        return formatBaseDate(target.ms, 'HH:mm:ss')
      case 'relative':
        return relativeText(target.ms - context.now)
    }
  }
  if (isKind(target, 'link')) {
    if (name === 'linksTo') {
      return false
    }
    if (name === 'asFile') {
      return null
    }
  }
  return fail(`unknown method ${name}`)
}

function fileMethod(
  row: BaseNoteRow,
  name: string,
  args: readonly BaseValue[],
  context: BaseEvaluationContext,
): BaseValue {
  switch (name) {
    case 'hasTag':
      return args.some((tag) => rowHasTag(row, asText(tag)))
    case 'inFolder':
      return rowInFolder(row, asText(args[0] ?? ''))
    case 'hasProperty': {
      const key = asText(args[0] ?? '')
      return Object.hasOwn(row.properties, key)
    }
    case 'hasLink': {
      const target = args[0] ?? null
      const path = isKind(target, 'file')
        ? target.row.path
        : isKind(target, 'link')
          ? target.path
          : context.resolve(asText(target))
      return path !== null && row.links.includes(path)
    }
    case 'asLink': {
      const display = args[0]
      return {
        kind: 'link',
        path: row.path,
        text: display === undefined ? row.title : asText(display),
      }
    }
    default:
      return fail(`unknown file method ${name}`)
  }
}
