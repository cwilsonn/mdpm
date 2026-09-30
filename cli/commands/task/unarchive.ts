import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'
import { projectArgs, refArg, resolveRef } from './shared'

export default defineCommand({
  meta: { name: 'unarchive', description: 'Restore an archived task' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...refArg,
  },
  async run({ args }) {
    const ctx = createContext(args)
    const task = resolveRef(ctx, args.ref, args)
    await ctx.core.archiveTask(task.project, task.slug, false)
    emit(ctx.json, { project: task.project, slug: task.slug, archived: false }, () => `${ctx.style.green('✓')} unarchived ${task.project}/${task.slug}`)
  },
})
