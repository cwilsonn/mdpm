import { defineCommand } from 'citty'
import { TASK_STATUSES } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { csv, oneOf } from '../../io'
import { emit, table } from '../../output'
import { projectArgs, scopeProject, shortRef } from './shared'

export default defineCommand({
  meta: { name: 'search', description: 'Full-text search over task titles and bodies' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    status: { type: 'string', description: `Comma-separated: ${TASK_STATUSES.join(', ')}` },
    query: { type: 'positional', description: 'Text to look for (case-insensitive)', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = scopeProject(ctx, args)
    const status = csv(args.status)?.map(s => oneOf(s, TASK_STATUSES, '--status')!)
    const tasks = ctx.core.searchTasks(args.query, project, status)
    emit(ctx.json, tasks, () => {
      if (!tasks.length) return ctx.style.dim('no matches')
      const siblings = new Map<string, string[]>()
      for (const t of ctx.core.listTasks({ project, includeArchived: true })) {
        siblings.set(t.project, [...siblings.get(t.project) ?? [], t.slug])
      }
      return table(
        tasks.map(t => [...(project ? [] : [t.project]), t.status, t.priority, shortRef(t.slug, siblings.get(t.project) ?? []), t.title]),
        [...(project ? [] : ['PROJECT']), 'STATUS', 'PRIORITY', 'REF', 'TITLE'],
      )
    })
  },
})
