import { buildGraph, taskId, wouldCreateCycle } from '../../../lib/core'
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


// Dependencies are computed over every project (they can be written as `project/slug`), archived tasks included.
export const loadGraph = (ctx: Context) => buildGraph(ctx.core.listTasks({ includeArchived: true }))

// Turn user-typed dependency refs into the strings stored in frontmatter: bare slugs for the same project,
// `project/slug` across projects. Refuses self-dependencies and anything that would create a cycle.
// `none` clears the list.
export function resolveDependencies(ctx: Context, owner: { project: string; slug: string } | undefined, project: string, refs: string[]): string[] {
  if (refs.length === 1 && refs[0] === 'none') return []
  const resolved = refs.map((ref) => {
    const dep = ctx.core.resolveTask(ref, ref.includes('/') ? undefined : project)
    return { id: taskId(dep), stored: dep.project === project ? dep.slug : taskId(dep) }
  })
  if (owner) {
    const graph = loadGraph(ctx)
    const cycle = wouldCreateCycle(graph, taskId(owner), resolved.map(d => d.id))
    if (cycle) throw new CliError(`that would create a dependency cycle: ${cycle.join(' → ')}`, ExitCode.usage)
  }
  return [...new Set(resolved.map(d => d.stored))]
}
