import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { emit } from '../../output'
import { bulkArgs, optionalRefArg, projectArgs, runBulk, selectTargets } from './shared'

export default defineCommand({
  meta: { name: 'done', description: 'Mark a task done (shorthand for `task set <ref> --status done`)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...optionalRefArg,
    ...bulkArgs,
  },
  async run({ args }) {
    const ctx = createContext(args)
    const { tasks, bulk } = selectTargets(ctx, args)
    if (bulk) return runBulk(ctx, args, tasks, 'marked done', t => ctx.core.updateTask(t.project, t.slug, { status: 'done' }))
    const task = tasks[0]!
    await ctx.core.updateTask(task.project, task.slug, { status: 'done' })
    emit(ctx.json, { project: task.project, slug: task.slug, status: 'done' }, () => `${ctx.style.green('✓')} done: ${task.project}/${task.slug}`)
  },
})
