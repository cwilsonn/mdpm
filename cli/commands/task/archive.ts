import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { emit } from '../../output'
import { bulkArgs, optionalRefArg, projectArgs, runBulk, selectTargets } from './shared'

export default defineCommand({
  meta: { name: 'archive', description: 'Archive a task (hidden from lists unless --include-archived)' },
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
    if (bulk) return runBulk(ctx, args, tasks, 'archived', t => ctx.core.archiveTask(t.project, t.slug, true))
    const task = tasks[0]!
    await ctx.core.archiveTask(task.project, task.slug, true)
    emit(ctx.json, { project: task.project, slug: task.slug, archived: true }, () => `${ctx.style.green('✓')} archived ${task.project}/${task.slug}`)
  },
})
