import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { textOrStdin } from '../../io'
import { CliError, emit, ExitCode } from '../../output'
import { projectArgs, refArg, resolveRef } from './shared'

export default defineCommand({
  meta: { name: 'note', description: 'Append a timestamped note to a task (text argument, or - for stdin)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...refArg,
    text: { type: 'positional', description: 'Note text, or - to read it from stdin', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const task = resolveRef(ctx, args.ref, args)
    const text = await textOrStdin(args.text)
    if (!text.trim()) throw new CliError('note is empty', ExitCode.usage)
    await ctx.core.appendTaskNote(task.project, task.slug, text)
    emit(ctx.json, { project: task.project, slug: task.slug }, () => `${ctx.style.green('✓')} note added to ${task.project}/${task.slug}`)
  },
})
