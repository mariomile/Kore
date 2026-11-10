import { describe, expect, it } from 'vitest'
import {
  followMovedIds,
  planBranchMove,
  retargetBlockLinks,
  sourceLinkMatcher,
} from './move-branch'

const isDaily = (note: string): boolean => note.toLowerCase() === '2026-11-10'

describe('retargetBlockLinks', () => {
  it('rewrites the note half only, keeping the id, label and embeds', () => {
    const md = 'See [[Plan#^abcd|the plan]], ![[Plan#^abcd]] and [[Plan#Heading]].'
    expect(retargetBlockLinks(md, () => 'Pricing')).toBe(
      'See [[Pricing#^abcd|the plan]], ![[Pricing#^abcd]] and [[Plan#Heading]].',
    )
  })

  it('leaves links in code alone', () => {
    const md = 'Code `[[Plan#^abcd]]` and [[Plan#^abcd]]'
    expect(retargetBlockLinks(md, () => 'X')).toBe('Code `[[Plan#^abcd]]` and [[X#^abcd]]')
  })
})

describe('planBranchMove', () => {
  const base = {
    sourceTarget: '2026-11-10',
    destinationTarget: 'DeepAgent',
    pointsAtSource: isDaily,
  }

  it('appends the branch to the end of the destination', () => {
    const result = planBranchMove({
      ...base,
      branch: '- Idee\n  - voice agent',
      remaining: '# Today\n\n- call Luca\n',
      destination: '# DeepAgent\n\nNotes.\n',
    })
    expect(result.destination).toBe('# DeepAgent\n\nNotes.\n\n- Idee\n  - voice agent\n')
    expect(result.source).toBe('# Today\n\n- call Luca\n')
    expect(result.movedIds).toEqual([])
  })

  it('points links at moved lines to the destination, and links to lines left behind at the source', () => {
    const result = planBranchMove({
      ...base,
      branch: '- Idee ^idee1\n  - see [[#^call1]] and [[#^idee1]]',
      remaining: '- call Luca ^call1\n- back to [[#^idee1]] and [[2026-11-10#^idee1]]\n',
      destination: 'Old link [[2026-11-10#^idee1|ideas]]\n',
    })
    expect(result.movedIds).toEqual(['idee1'])
    expect(result.source).toBe(
      '- call Luca ^call1\n- back to [[DeepAgent#^idee1]] and [[DeepAgent#^idee1]]\n',
    )
    expect(result.destination).toBe(
      'Old link [[#^idee1|ideas]]\n\n- Idee ^idee1\n  - see [[2026-11-10#^call1]] and [[#^idee1]]\n',
    )
  })
})

describe('followMovedIds', () => {
  it('repoints only links to the source whose id moved', () => {
    const md = '[[2026-11-10#^idee1]] [[2026-11-10#^call1]] [[Other#^idee1]] [[#^idee1]]'
    expect(followMovedIds(md, ['idee1'], isDaily, 'DeepAgent')).toBe(
      '[[DeepAgent#^idee1]] [[2026-11-10#^call1]] [[Other#^idee1]] [[#^idee1]]',
    )
  })
})

describe('sourceLinkMatcher', () => {
  it("matches the source title, its backlinks' spellings, and nothing else", () => {
    const matches = sourceLinkMatcher('Weekly Plan', ['weekly plan#^abcd|x', 'WP alias#^efgh'])
    expect(matches('Weekly Plan')).toBe(true)
    expect(matches('WEEKLY PLAN')).toBe(true)
    expect(matches('WP alias')).toBe(true)
    expect(matches('Other')).toBe(false)
    expect(matches('')).toBe(false)
  })
})
