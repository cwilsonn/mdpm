import { buildGraph, matches, parseWhere, taskId, WHERE_FIELDS, wouldCreateCycle } from '../../../lib/core'
import { confirm } from '../../io'
import { CliError, emit, ExitCode, table } from '../../output'
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

// ── Bulk operations ───────────────────────────────────────────────────────────


export const bulkArgs = {
  where: { type: 'string', description: `Act on every task matching, instead of naming one: ${WHERE_FIELDS.join(', ')} with = != ~, joined by commas, | for alternatives. e.g. "status=todo|blocked,tag=core,priority!=low"` },
  yes: { type: 'boolean', alias: 'y', description: 'Skip the confirmation prompt (required without a terminal)', default: false },
  'dry-run': { type: 'boolean', description: 'With --where: list what would change and stop', default: false },
  'include-archived': { type: 'boolean', description: 'With --where: also match archived tasks', default: false },
} as const

export const optionalRefArg = {
  ref: { type: 'positional', description: 'Task slug, unique prefix/substring, title fragment, or project/slug (or use --where)', required: false },
} as const

type Task = ReturnType<Context['core']['listTasks']>[number]
interface BulkFlags { ref?: string; where?: string; project?: string; all?: boolean; 'include-archived'?: boolean }

// Either the one task named by `ref`, or every task matching `--where` within the usual project scope.
export function selectTargets(ctx: Context, args: BulkFlags): { tasks: Task[]; bulk: boolean } {
  if (args.where !== undefined && args.ref) throw new CliError('pass either a task or --where, not both', ExitCode.usage)
  if (args.where === undefined) {
    if (!args.ref) throw new CliError('name a task, or select several with --where', ExitCode.usage)
    return { tasks: [resolveRef(ctx, args.ref, args)], bulk: false }
  }
  const clauses = parseWhere(args.where)
  const project = scopeProject(ctx, args)
  const tasks = ctx.core.listTasks({ project, includeArchived: !!args['include-archived'] }).filter(t => matches(t, clauses))
  return { tasks, bulk: true }
}

// Show what matched, confirm (or --yes / --dry-run), run the action on each, and summarize.
// A failure on one task doesn't stop the rest; the exit code is 1 if any failed.
export async function runBulk(
  ctx: Context,
  args: { yes?: boolean; 'dry-run'?: boolean },
  tasks: Task[],
  verb: string,
  action: (task: Task) => Promise<unknown>,
) {
  const id = (t: Task) => `${t.project}/${t.slug}`
  if (!tasks.length) {
    emit(ctx.json, { matched: 0, results: [] }, () => ctx.style.dim('no tasks match'))
    return
  }
  const listing = table(tasks.map(t => [t.status, t.priority, id(t), t.title]), ['STATUS', 'PRIORITY', 'TASK', 'TITLE'])
  if (args['dry-run']) {
    emit(ctx.json, { dryRun: true, matched: tasks.length, tasks: tasks.map(id) }, () => `${listing}\n${ctx.style.dim(`${tasks.length} task${tasks.length === 1 ? '' : 's'} would be ${verb} (dry run: nothing changed)`)}`)
    return
  }
  if (!args.yes) {
    if (process.stdin.isTTY) console.error(`${listing}\n`)
    if (!await confirm(`${verb[0]!.toUpperCase()}${verb.slice(1)} ${tasks.length} task${tasks.length === 1 ? '' : 's'}?`)) throw new CliError('aborted', ExitCode.error)
  }
  const results: { task: string; ok: boolean; error?: string }[] = []
  for (const task of tasks) {
    try {
      await action(task)
      results.push({ task: id(task), ok: true })
    }
    catch (err) {
      results.push({ task: id(task), ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  const failed = results.filter(r => !r.ok)
  emit(ctx.json, { matched: tasks.length, succeeded: results.length - failed.length, failed: failed.length, results }, () => [
    `${failed.length ? ctx.style.yellow('!') : ctx.style.green('✓')} ${verb} ${results.length - failed.length} of ${tasks.length} task${tasks.length === 1 ? '' : 's'}`,
    ...failed.map(f => `  ${ctx.style.red('✗')} ${f.task}: ${f.error}`),
  ].join('\n'))
  if (failed.length) process.exitCode = ExitCode.error
}
