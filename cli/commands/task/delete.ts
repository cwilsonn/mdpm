import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { confirm } from '../../io'
import { CliError, emit, ExitCode } from '../../output'
import { bulkArgs, optionalRefArg, projectArgs, runBulk, selectTargets } from './shared'

export default defineCommand({
  meta: { name: 'delete', description: 'Permanently delete a task (asks for confirmation unless --yes)' },
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
    if (bulk) return runBulk(ctx, args, tasks, 'deleted', t => ctx.core.deleteTask(t.project, t.slug))
    const task = tasks[0]!
    if (!args.yes && !await confirm(`Delete ${task.project}/${task.slug} ("${task.title}")? This cannot be undone.`)) {
      throw new CliError('aborted', ExitCode.error)
    }
    await ctx.core.deleteTask(task.project, task.slug)
    emit(ctx.json, { project: task.project, slug: task.slug, deleted: true }, () => `${ctx.style.green('✓')} deleted ${task.project}/${task.slug}`)
  },
})
