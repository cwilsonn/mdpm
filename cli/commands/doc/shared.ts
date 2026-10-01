import type { Context } from '../../context'
import { CliError, ExitCode } from '../../output'

export const scopeArgs = {
  project: { type: 'string', description: 'Project slug (default: inferred from the current repo)' },
  standalone: { type: 'boolean', description: 'Only standalone (non-project) docs', default: false },
  all: { type: 'boolean', description: 'All docs: every project plus standalone', default: false },
} as const

// --standalone, else --project, else the current repo's project; with none of those (or --all)
// the scope is everything, which is what core treats as "no project, not standalone".
export function docScope(ctx: Context, flags: { project?: string; standalone?: boolean; all?: boolean }) {
  if (flags.standalone) return { standalone: true as const }
  if (flags.project) {
    ctx.core.getProject(flags.project)
    return { project: flags.project }
  }
  if (flags.all) return {}
  const inferred = ctx.inferProject()?.slug
  return inferred ? { project: inferred } : {}
}

// Creating needs one concrete place to put the doc: --standalone, --project, or the current repo's project.
export function createScope(ctx: Context, flags: { project?: string; standalone?: boolean }) {
  if (flags.standalone) return { standalone: true as const }
  if (flags.project) {
    ctx.core.getProject(flags.project)
    return { project: flags.project }
  }
  const inferred = ctx.inferProject()?.slug
  if (!inferred) throw new CliError('no scope: pass --project or --standalone, or run inside a repo registered in mdpm (see `mdpm config show`)', ExitCode.usage)
  return { project: inferred }
}
