import { CliError, ExitCode } from '../../output'
import type { Context } from '../../context'

export const projectArgs = {
  project: { type: 'string', description: 'Project slug (default: inferred from the current repo)' },
} as const

export const refArg = {
  ref: { type: 'positional', description: 'Task slug, unique slug prefix/substring, title fragment, or project/slug', required: true },
} as const

// An explicit --project wins, then the project for the current repo; undefined means "all projects".
export function scopeProject(ctx: Context, flags: { project?: string; all?: boolean }) {
  if (flags.project) {
    ctx.core.getProject(flags.project)
    return flags.project
  }
  return flags.all ? undefined : ctx.inferProject()?.slug
}

export function requireProject(ctx: Context, flags: { project?: string }) {
  const project = scopeProject(ctx, flags)
  if (!project) throw new CliError('no project: pass --project or run inside a repo registered in mdpm (see `mdpm config show`)', ExitCode.usage)
  return project
}

export function resolveRef(ctx: Context, ref: string, flags: { project?: string; all?: boolean }) {
  return ctx.core.resolveTask(ref, scopeProject(ctx, { ...flags }))
}

// Shortest prefix (>= min chars) that is unique among all of a project's slugs, like a short git SHA.
export function shortRef(slug: string, siblings: string[], min = 10) {
  for (let n = Math.min(min, slug.length); n < slug.length; n++) {
    const prefix = slug.slice(0, n)
    if (siblings.filter(s => s.startsWith(prefix)).length === 1) return prefix
  }
  return slug
}
