import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { emit } from '../../output'
import { bulkArgs, optionalRefArg, projectArgs, runBulk, selectTargets } from './shared'

export default defineCommand({
  meta: { name: 'unarchive', description: 'Restore an archived task' },
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
    if (bulk) return runBulk(ctx, args, tasks, 'unarchived', t => ctx.core.archiveTask(t.project, t.slug, false))
    const task = tasks[0]!
    await ctx.core.archiveTask(task.project, task.slug, false)
    emit(ctx.json, { project: task.project, slug: task.slug, archived: false }, () => `${ctx.style.green('✓')} unarchived ${task.project}/${task.slug}`)
  },
})
