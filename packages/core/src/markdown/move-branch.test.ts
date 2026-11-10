import { describe, expect, it } from 'vitest'
import { planBranchMove, retargetBlockLinks, type BranchMoveInput } from './move-branch'

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
  const input = (
    branch: string,
    backlinks: BranchMoveInput['backlinks'] = [],
  ): BranchMoveInput => ({
    branch,
    sourcePath: 'daily/2026-11-10.md',
    sourceTarget: '2026-11-10',
    destinationPath: 'notes/deepagent.md',
    destinationTarget: 'DeepAgent',
    backlinks,
  })

  it('appends the branch to the end of the destination', () => {
    const move = planBranchMove(input('- Idee\n  - voice agent'))
    expect(move.landIn('# DeepAgent\n\nNotes.\n')).toBe(
      '# DeepAgent\n\nNotes.\n\n- Idee\n  - voice agent\n',
    )
    expect(move.leaveFrom('# Today\n\n- call Luca\n')).toBe('# Today\n\n- call Luca\n')
    expect(move.movedIds).toEqual([])
    expect(move.linkingNotes).toEqual([])
  })

  it('points links at moved lines to the destination, and links to lines left behind at the source', () => {
    const move = planBranchMove(input('- Idee ^idee1\n  - see [[#^call1]] and [[#^idee1]]'))
    expect(move.movedIds).toEqual(['idee1'])
    expect(
      move.leaveFrom('- call Luca ^call1\n- back to [[#^idee1]] and [[2026-11-10#^idee1]]\n'),
    ).toBe('- call Luca ^call1\n- back to [[DeepAgent#^idee1]] and [[DeepAgent#^idee1]]\n')
    expect(move.landIn('Old link [[2026-11-10#^idee1|ideas]]\n')).toBe(
      'Old link [[#^idee1|ideas]]\n\n- Idee ^idee1\n  - see [[2026-11-10#^call1]] and [[#^idee1]]\n',
    )
  })

  it('lists and repoints the other notes that link to a moved line, however they name the source', () => {
    const move = planBranchMove(
      input('- Idee ^idee1', [
        { sourcePath: 'notes/a.md', targetRaw: 'Today alias#^idee1' },
        { sourcePath: 'notes/b.md', targetRaw: '2026-11-10#^call1' },
        { sourcePath: 'notes/deepagent.md', targetRaw: '2026-11-10#^idee1' },
        { sourcePath: 'daily/2026-11-10.md', targetRaw: '#^idee1' },
      ]),
    )
    expect(move.linkingNotes).toEqual(['notes/a.md'])
    expect(
      move.follow('[[Today alias#^idee1]] [[2026-11-10#^call1]] [[Other#^idee1]] [[#^idee1]]'),
    ).toBe('[[DeepAgent#^idee1]] [[2026-11-10#^call1]] [[Other#^idee1]] [[#^idee1]]')
  })
})
