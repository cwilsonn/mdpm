import { defineCommand } from 'citty'
import { TASK_PRIORITIES } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { csv, oneOf, textOrStdin } from '../../io'
import { emit } from '../../output'
import { projectArgs, requireProject } from './shared'

export default defineCommand({
  meta: { name: 'start', description: 'Begin a unit of work in one call: resume the open task with exactly this slug or title, or create it, and mark it in-progress' },
  args: {
    ...globalArgs,
    ...projectArgs,
    title: { type: 'positional', description: 'Task title, or the exact slug of an existing task', required: true },
    priority: { type: 'string', description: TASK_PRIORITIES.join(' | ') + ' (only when it creates the task)' },
    tags: { type: 'string', description: 'Comma-separated (only when it creates the task)' },
    description: { type: 'string', description: 'Scope and why; use - for stdin (only when it creates the task)' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = requireProject(ctx, args)
    const r = await ctx.core.startTask(project, args.title, {
      priority: oneOf(args.priority, TASK_PRIORITIES, '--priority'),
      tags: csv(args.tags),
      description: args.description === undefined ? undefined : await textOrStdin(args.description),
    })
    emit(ctx.json, r, () => `${ctx.style.green('✓')} ${r.created ? 'created and started' : r.was === 'in-progress' ? 'already in progress' : `resumed (was ${r.was})`}: ${r.id}`)
  },
})
