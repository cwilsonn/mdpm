import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'
import { projectArgs, refArg, resolveRef } from './shared'

export default defineCommand({
  meta: { name: 'done', description: 'Mark a task done (shorthand for `task set <ref> --status done`)' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...refArg,
  },
  async run({ args }) {
    const ctx = createContext(args)
    const task = resolveRef(ctx, args.ref, args)
    await ctx.core.updateTask(task.project, task.slug, { status: 'done' })
    emit(ctx.json, { project: task.project, slug: task.slug, status: 'done' }, () => `${ctx.style.green('✓')} done: ${task.project}/${task.slug}`)
  },
})
