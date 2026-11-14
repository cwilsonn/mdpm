import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { resolveAuthor, TASK_PRIORITIES, TASK_STATUSES, type BatchItem } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { readStdin } from '../../io'
import { CliError, emit, ExitCode } from '../../output'
import { projectArgs, scopeProject } from './shared'

// Several task writes in one process and one request: the way to record a whole session.
export default defineCommand({
  meta: {
    name: 'batch',
    description: 'Apply several task writes at once from JSON on stdin (or --file): [{"op":"update","ref":"slug","status":"done","note":"..."},{"op":"create","title":"...","status":"in-progress"},{"op":"note","ref":"slug","note":"..."}]',
  },
  args: {
    ...globalArgs,
    ...projectArgs,
    file: { type: 'string', description: 'Read the operations from this file instead of stdin' },
    author: { type: 'string', description: 'Author for notes without their own (default: $MDPM_AUTHOR, "claude" under Claude Code, git user.name)' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const raw = args.file ? readFileSync(args.file, 'utf8') : await readStdin()
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    }
    catch (err) {
      throw new CliError(`batch input is not valid JSON: ${(err as Error).message}`, ExitCode.usage)
    }
    const items = (Array.isArray(parsed) ? parsed : (parsed as { ops?: unknown })?.ops) as BatchItem[] | undefined
    if (!Array.isArray(items) || !items.length) throw new CliError('batch input must be a non-empty JSON array of operations (or {"ops": [...]})', ExitCode.usage)
    const author = resolveAuthor({ flag: args.author })
    for (const [i, item] of items.entries()) {
      if (item?.op === 'note' || (item as { note?: string })?.note) (item as { author?: string }).author ??= author
      const status = (item as { status?: string }).status
      if (status !== undefined && !(TASK_STATUSES as readonly string[]).includes(status)) throw new CliError(`op ${i}: status '${status}' is not one of ${TASK_STATUSES.join(', ')}`, ExitCode.usage)
      const priority = (item as { priority?: string }).priority
      if (priority !== undefined && !(TASK_PRIORITIES as readonly string[]).includes(priority)) throw new CliError(`op ${i}: priority '${priority}' is not one of ${TASK_PRIORITIES.join(', ')}`, ExitCode.usage)
    }
    const r = await ctx.core.batchTasks(scopeProject(ctx, args), items)
    emit(ctx.json, r, () => [
      `${r.failed ? ctx.style.yellow('!') : ctx.style.green('✓')} ${r.ok} of ${r.results.length} applied`,
      ...r.results.map(x => x.ok ? `  ${x.id} -> ${x.status}` : `  ${ctx.style.red('✗')} #${x.index}: ${x.error}`),
    ].join('\n'))
    if (r.failed) process.exitCode = ExitCode.error
  },
})
