import { defineCommand } from 'citty'
import { resolveAuthor } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { textOrStdin } from '../../io'
import { emit } from '../../output'
import { bulkArgs, optionalRefArg, projectArgs, runBulk, selectTargets } from './shared'

export default defineCommand({
  meta: { name: 'done', description: 'Mark a task done (shorthand for `task set <ref> --status done`)' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...optionalRefArg,
    ...bulkArgs,
    note: { type: 'string', description: 'Append this note in the same write (text, or - for stdin): status and note in one call' },
    author: { type: 'string', description: 'Who wrote the note (default: $MDPM_AUTHOR, "claude" under Claude Code, git user.name)' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const { tasks, bulk } = selectTargets(ctx, args)
    const note = args.note === undefined ? undefined : (await textOrStdin(args.note)).trim() || undefined
    const fields = { status: 'done', ...(note && { note, noteAuthor: resolveAuthor({ flag: args.author }) }) }
    if (bulk) return runBulk(ctx, args, tasks, 'marked done', t => ctx.core.updateTask(t.project, t.slug, fields))
    const task = tasks[0]!
    await ctx.core.updateTask(task.project, task.slug, fields)
    emit(ctx.json, { id: `${task.project}/${task.slug}`, status: 'done', ...(note && { noted: true }) }, () => `${ctx.style.green('✓')} done: ${task.project}/${task.slug}`)
  },
})
