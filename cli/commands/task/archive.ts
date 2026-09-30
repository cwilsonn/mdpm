import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { emit } from '../../output'
import { projectArgs, refArg, resolveRef } from './shared'

export default defineCommand({
  meta: { name: 'archive', description: 'Archive a task (hidden from lists unless --include-archived)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...refArg,
  },
  async run({ args }) {
    const ctx = createContext(args)
    const task = resolveRef(ctx, args.ref, args)
    await ctx.core.archiveTask(task.project, task.slug, true)
    emit(ctx.json, { project: task.project, slug: task.slug, archived: true }, () => `${ctx.style.green('✓')} archived ${task.project}/${task.slug}`)
  },
})
