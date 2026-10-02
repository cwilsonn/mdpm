import { defineCommand } from 'citty'
import { matches, parseLinkedFilter, parseWhere, removalVersion, TASK_PRIORITIES, TASK_STATUSES, WHERE_FIELDS } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { csv, oneOf } from '../../io'
import { CliError, emit, ExitCode, table } from '../../output'
import { projectArgs, scopeProject, shortRef } from './shared'

export default defineCommand({
  meta: { name: 'list', description: 'List tasks (current repo\'s project by default; --all for every project)' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'List across all projects', default: false },
    status: { type: 'string', description: `Comma-separated: ${TASK_STATUSES.join(', ')}` },
    priority: { type: 'string', description: `Comma-separated: ${TASK_PRIORITIES.join(', ')}` },
    tags: { type: 'string', description: 'Comma-separated; matches tasks with any of them' },
    assignee: { type: 'string', description: 'Only tasks assigned to this name' },
    linked: { type: 'string', description: 'Only tasks with a link matching provider[:kind[:ref]], e.g. github, jira, github:change, gitlab:change:group/proj!9' },
    'github-issue': { type: 'string', description: 'Deprecated: use --linked github:issue. Only tasks linked to this GitHub issue number' },
    'github-pr': { type: 'string', description: 'Deprecated: use --linked github:change. Only tasks linked to this GitHub PR number' },
    where: { type: 'string', description: `Further filter: ${WHERE_FIELDS.join(', ')} with = != ~, joined by commas, | for alternatives` },
    'include-archived': { type: 'boolean', description: 'Include archived tasks', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = scopeProject(ctx, args)
    const status = csv(args.status)?.map(s => oneOf(s, TASK_STATUSES, '--status')!)
    const priority = csv(args.priority)?.map(p => oneOf(p, TASK_PRIORITIES, '--priority')!)
    const clauses = args.where === undefined ? undefined : parseWhere(args.where)
    for (const flag of ['github-issue', 'github-pr'] as const) {
      if (args[flag]) console.error(`${ctx.style.yellow('note:')} --${flag} is deprecated; use --linked github:${flag === 'github-pr' ? 'change' : 'issue'}. Removal planned for ${removalVersion()}.`)
    }
    let linked
    try {
      linked = args.linked === undefined ? undefined : parseLinkedFilter(args.linked)
    }
    catch (err) {
      throw new CliError((err as Error).message, ExitCode.usage)
    }
    const tasks = ctx.core.listTasks({
      project,
      status,
      priority,
      tags: csv(args.tags),
      assignee: args.assignee,
      githubIssue: args['github-issue'] ? Number(args['github-issue']) : undefined,
      githubPR: args['github-pr'] ? Number(args['github-pr']) : undefined,
      linked,
      includeArchived: args['include-archived'],
    }).filter(t => !clauses || matches(t, clauses))
    emit(ctx.json, tasks.map(({ body: _, ...t }) => t), () => {
      if (!tasks.length) return ctx.style.dim('no tasks')
      const slugsByProject = new Map<string, string[]>()
      for (const t of ctx.core.listTasks({ project, includeArchived: true })) {
        slugsByProject.set(t.project, [...slugsByProject.get(t.project) ?? [], t.slug])
      }
      const rows = tasks.map(t => [
        ...(project ? [] : [t.project]),
        t.status,
        t.priority,
        shortRef(t.slug, slugsByProject.get(t.project) ?? []),
        t.archivedAt ? `${t.title} ${ctx.style.dim('(archived)')}` : t.title,
      ])
      return `${table(rows, [...(project ? [] : ['PROJECT']), 'STATUS', 'PRIORITY', 'REF', 'TITLE'])}\n${ctx.style.dim(`${tasks.length} task${tasks.length === 1 ? '' : 's'}`)}`
    })
  },
})
