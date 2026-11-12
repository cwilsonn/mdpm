import { defineCommand } from 'citty'
import { parseSince, readUsage, summarizeUsage, usageLogPath } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, emit, ExitCode, table } from '../output'

export default defineCommand({
  meta: { name: 'usage', description: 'Response sizes per CLI command and MCP tool (what costs the most tokens)' },
  args: {
    ...globalArgs,
    since: { type: 'string', description: 'Only calls since then: 30m, 12h, 2d, 1w, or a date' },
    limit: { type: 'string', description: 'Rows to show (0 = all)', default: '15' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const since = args.since ? parseSince(args.since) : undefined
    if (args.since && !since) throw new CliError(`--since: '${args.since}' is not a duration (30m, 12h, 2d, 1w) or a date`, ExitCode.usage)
    const limit = Number(args.limit)
    if (!Number.isInteger(limit) || limit < 0) throw new CliError(`--limit: '${args.limit}' is not a non-negative integer`, ExitCode.usage)
    const entries = readUsage({ since })
    const all = summarizeUsage(entries)
    const rows = limit ? all.slice(0, limit) : all
    emit(ctx.json, { log: usageLogPath(), calls: entries.length, tokens: entries.reduce((n, e) => n + e.tokens, 0), rows }, () => {
      if (!rows.length) return ctx.style.dim(`no calls logged yet (${usageLogPath()})`)
      const out = table(
        rows.map(r => [r.surface, r.name, String(r.calls), String(r.tokens), String(r.avgTokens), String(r.maxTokens)]),
        ['SURFACE', 'NAME', 'CALLS', '~TOKENS', 'AVG', 'MAX'],
      )
      const more = all.length > rows.length ? `, ${all.length - rows.length} more (--limit 0)` : ''
      return `${out}\n${ctx.style.dim(`${entries.length} calls, ~${entries.reduce((n, e) => n + e.tokens, 0)} tokens${more}`)}`
    })
  },
})
