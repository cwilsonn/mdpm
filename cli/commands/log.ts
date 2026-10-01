import { defineCommand } from 'citty'
import { buildLog, parseSince } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, emit, ExitCode, table } from '../output'

export default defineCommand({
  meta: { name: 'log', description: 'Recent activity: task notes (with author) and tasks created or updated, newest first' },
  args: {
    ...globalArgs,
    project: { type: 'string', description: 'Project slug (default: inferred from the current repo)' },
    all: { type: 'boolean', description: 'Across all projects', default: false },
    since: { type: 'string', description: 'Only activity since then: 30m, 12h, 2d, 1w, or a date such as 2026-10-01' },
    author: { type: 'string', description: 'Only notes by this author (case-insensitive)' },
    limit: { type: 'string', description: 'Maximum entries', default: '30' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = args.project ?? (args.all ? undefined : ctx.inferProject()?.slug)
    if (args.project) ctx.core.getProject(args.project)
    const since = args.since ? parseSince(args.since) : undefined
    if (args.since && !since) throw new CliError(`--since: '${args.since}' is not a duration (30m, 12h, 2d, 1w) or a date`, ExitCode.usage)
    const limit = Number(args.limit)
    if (!Number.isInteger(limit) || limit < 1) throw new CliError(`--limit: '${args.limit}' is not a positive integer`, ExitCode.usage)

    const entries = buildLog(ctx.core, { project, since, author: args.author, limit })
    emit(ctx.json, entries, () => {
      if (!entries.length) return ctx.style.dim('no activity')
      const stamp = (iso: string) => iso.slice(0, 16).replace('T', ' ')
      const rows = entries.map(e => [
        stamp(e.at),
        e.type === 'note' ? ctx.style.cyan('note') : e.type,
        ...(project ? [] : [e.project]),
        e.task.length > 34 ? `${e.task.slice(0, 33)}…` : e.task,
        e.author ?? '',
        e.type === 'note' ? e.detail : e.type === 'updated' ? `now ${e.detail}` : e.detail,
      ])
      return `${table(rows, ['WHEN (UTC)', 'TYPE', ...(project ? [] : ['PROJECT']), 'TASK', 'BY', 'DETAIL'])}\n${ctx.style.dim(`${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`)}`
    })
  },
})
