import type { Context } from '../../context'

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
