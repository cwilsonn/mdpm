import { defineCommand } from 'citty'
import { TASK_PRIORITIES, TASK_STATUSES } from '../../../lib/core'
import { createContext, globalArgs, writeArgs } from '../../context'
import { csv, csvNumbers, oneOf, textOrStdin } from '../../io'
import { addLink, type Link } from '../../../lib/core'
import { repeatedFlag, repoLinks, resolveLinkFlags } from '../../links'
import { CliError, emit, ExitCode } from '../../output'
import { bulkArgs, optionalRefArg, projectArgs, resolveDependencies, runBulk, selectTargets } from './shared'

export default defineCommand({
  meta: { name: 'set', description: 'Update fields on a task (writes via the server)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...optionalRefArg,
    ...bulkArgs,
    title: { type: 'string' },
    status: { type: 'string', description: TASK_STATUSES.join(' | ') },
    priority: { type: 'string', description: TASK_PRIORITIES.join(' | ') },
    tags: { type: 'string', description: 'Comma-separated; replaces the existing tags' },
    assignees: { type: 'string', description: 'Comma-separated; replaces the existing assignees' },
    due: { type: 'string', description: 'YYYY-MM-DD, or "none" to clear' },
    dependencies: { type: 'string', description: 'Comma-separated tasks this one waits on (slug, fragment, or project/slug); replaces the list; "none" clears it' },
    link: { type: 'string', description: 'A URL or short ref (#42, ABC-123) to add to the task\'s links; repeat for several. To remove or tell #42 issue from PR, use `task link`' },
    'github-issues': { type: 'string', description: 'Deprecated: use --link. Comma-separated issue numbers; replaces the existing list' },
    'github-prs': { type: 'string', description: 'Deprecated: use --link. Comma-separated PR numbers; replaces the existing list' },
    description: { type: 'string', description: 'Replace the markdown body; use - to read it from stdin' },
  },
  async run({ args, rawArgs }) {
    const ctx = createContext(args)
    const { tasks, bulk } = selectTargets(ctx, args)
    if (bulk && (args.title !== undefined || args.description !== undefined)) {
      throw new CliError('refusing to set --title or --description on several tasks at once; name one task for those', ExitCode.usage)
    }
    // Everything except dependencies is the same for every task; dependencies resolve per task (same-project
    // slugs, cycle check), so they are computed inside changesFor.
    const common: Record<string, unknown> = {
      title: args.title,
      status: oneOf(args.status, TASK_STATUSES, '--status'),
      priority: oneOf(args.priority, TASK_PRIORITIES, '--priority'),
      tags: csv(args.tags),
      assignees: csv(args.assignees),
      // The API treats null as "remove the field".
      due: args.due === 'none' ? null : args.due,
      githubIssues: csvNumbers(args['github-issues'], '--github-issues'),
      githubPRs: csvNumbers(args['github-prs'], '--github-prs'),
      description: args.description === undefined ? undefined : await textOrStdin(args.description),
    }
    // --link adds to the task's own links, expanding short refs against its project's repo.
    const linksFor = (task: { project: string; links: unknown }) => {
      if (args.link === undefined) return undefined
      const next = (task.links as Link[]).slice()
      let added = false
      for (const link of resolveLinkFlags(repeatedFlag(rawArgs, 'link'), repoLinks(ctx, task.project))) {
        const r = addLink(next, link)
        added ||= r.added
        next.splice(0, next.length, ...r.links)
      }
      return added ? next : undefined
    }
    const changesFor = (task: { project: string; slug: string; links: unknown }) => Object.fromEntries(Object.entries({
      ...common,
      links: linksFor(task),
      dependencies: args.dependencies === undefined ? undefined : resolveDependencies(ctx, task, task.project, csv(args.dependencies) ?? []),
    }).filter(([, v]) => v !== undefined))
    if (args.dependencies === undefined && args.link === undefined && !Object.values(common).some(v => v !== undefined)) {
      throw new CliError('nothing to set: pass at least one field flag (see --help)', ExitCode.usage)
    }

    if (bulk) return runBulk(ctx, args, tasks, 'updated', t => ctx.core.updateTask(t.project, t.slug, changesFor(t)))

    const task = tasks[0]!
    const changed = changesFor(task)
    if (!Object.keys(changed).length) {
      emit(ctx.json, { project: task.project, slug: task.slug, updated: [] }, () => `${task.project}/${task.slug}: nothing changed (already linked)`)
      return
    }
    await ctx.core.updateTask(task.project, task.slug, changed)
    emit(ctx.json, { project: task.project, slug: task.slug, updated: Object.keys(changed) }, () =>
      `${ctx.style.green('✓')} updated ${task.project}/${task.slug} (${Object.keys(changed).join(', ')})`)
  },
})
