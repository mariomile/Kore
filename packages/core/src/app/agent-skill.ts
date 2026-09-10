import { z } from 'zod'
import { call } from '../ipc/invoke'

const agentSkillInstallStateSchema = z.enum(['missing', 'current', 'stale', 'conflict'])

/**
 * Where an installed skill file stands relative to what the app would write
 * today: `missing` (no file), `current` (byte-identical), `stale` (ours, but
 * rendered from older inputs — safe to rewrite), or `conflict` (a file the
 * app doesn't manage; never overwritten or deleted).
 */
export type AgentSkillInstallState = z.infer<typeof agentSkillInstallStateSchema>

const agentSkillStatusSchema = z.object({
  /** The skill's directory name (`reflect-<slug>` for the graph's own, `kore-*` for the shared ones). */
  skillName: z.string(),
  /** Absolute path of the target `SKILL.md` under `~/.agents/skills/`. */
  skillPath: z.string(),
  installState: agentSkillInstallStateSchema,
})

/** One bundled skill's install status. */
export type AgentSkillStatus = z.infer<typeof agentSkillStatusSchema>

const agentSkillsStatusSchema = z.object({
  /** The skills directory (`~/.agents/skills`). */
  skillsRoot: z.string(),
  /** Absolute path of the bundled `reflect` CLI the graph skill references. */
  cliPath: z.string(),
  /** The graph's own skill first, then the shared format skills. */
  skills: z.array(agentSkillStatusSchema),
})

/** Install status of every bundled agent skill (Settings → Agents). */
export type AgentSkillsStatus = z.infer<typeof agentSkillsStatusSchema>

/** The bundled skills' install status for the open graph. Read-only. */
export async function agentSkillStatus(): Promise<AgentSkillsStatus> {
  return await call('skill_status', {}, agentSkillsStatusSchema)
}

/**
 * Write (or refresh) every bundled skill under `~/.agents/skills/`.
 * Generation-pinned like every mutating command; a `conflict` file is left
 * alone and reported, the others still install.
 */
export async function agentSkillInstall(generation: number): Promise<AgentSkillsStatus> {
  return await call('skill_install', { generation }, agentSkillsStatusSchema)
}

/** Remove every managed skill file. `conflict` files are left in place. */
export async function agentSkillUninstall(generation: number): Promise<AgentSkillsStatus> {
  return await call('skill_uninstall', { generation }, agentSkillsStatusSchema)
}
