import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stateDir } from './lifecycle'

// Response-size log. Reads go straight to the content files and never reach the server, so the only place
// that sees what an agent actually receives is the client: the CLI (stdout) and the MCP tool handler.
// One JSON line per call: which command or tool, how many chars it returned, and a rough token count.
// Arguments and content are never logged, only the command or tool name.

export interface UsageEntry {
  /** ISO timestamp */
  at: string
  surface: 'cli' | 'mcp'
  /** `task list`, `pickup`, `list_tasks`, ... */
  name: string
  chars: number
  /** chars / 4: a rule of thumb, good enough to rank endpoints */
  tokens: number
}

export interface UsageRow {
  surface: UsageEntry['surface']
  name: string
  calls: number
  chars: number
  tokens: number
  avgTokens: number
  maxTokens: number
}

const MAX_LOG_BYTES = 1_000_000

export const approxTokens = (chars: number) => Math.ceil(chars / 4)
export const usageLogPath = () => join(stateDir(), 'usage.jsonl')

// MDPM_USAGE_LOG=0 turns it off.
const enabled = () => process.env.MDPM_USAGE_LOG !== '0'

// Never throws: logging must not break a command. When the file passes ~1MB the older half is dropped.
export function recordUsage(entry: { surface: UsageEntry['surface']; name: string; chars: number }, now = new Date()) {
  if (!enabled() || !entry.name) return
  try {
    const file = usageLogPath()
    mkdirSync(dirname(file), { recursive: true })
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      writeFileSync(file, `${lines.slice(Math.floor(lines.length / 2)).join('\n')}\n`)
    }
    const line: UsageEntry = { at: now.toISOString(), surface: entry.surface, name: entry.name, chars: entry.chars, tokens: approxTokens(entry.chars) }
    appendFileSync(file, `${JSON.stringify(line)}\n`)
  }
  catch {}
}

export function readUsage(opts: { since?: Date } = {}): UsageEntry[] {
  const file = usageLogPath()
  if (!existsSync(file)) return []
  const entries: UsageEntry[] = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as UsageEntry
      if (!opts.since || Date.parse(e.at) >= opts.since.getTime()) entries.push(e)
    }
    catch {}
  }
  return entries
}

// Heaviest first, by total tokens: what dominates cost, not what is slowest per call.
export function summarizeUsage(entries: UsageEntry[]): UsageRow[] {
  const rows = new Map<string, UsageRow>()
  for (const e of entries) {
    const key = `${e.surface}:${e.name}`
    const row = rows.get(key) ?? { surface: e.surface, name: e.name, calls: 0, chars: 0, tokens: 0, avgTokens: 0, maxTokens: 0 }
    row.calls++
    row.chars += e.chars
    row.tokens += e.tokens
    row.maxTokens = Math.max(row.maxTokens, e.tokens)
    rows.set(key, row)
  }
  return [...rows.values()]
    .map(r => ({ ...r, avgTokens: Math.round(r.tokens / r.calls) }))
    .sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name))
}

// Commands with subcommands; for these the name is two words (`task list`), otherwise one (`pickup`),
// so positional arguments such as a project slug never leak into the log.
const GROUPS = new Set(['task', 'doc', 'project', 'links', 'providers', 'skills', 'hooks', 'config'])

export function commandName(rawArgs: string[]) {
  const words = rawArgs.filter(a => !a.startsWith('-'))
  if (!words.length) return ''
  return GROUPS.has(words[0]!) && words[1] ? `${words[0]} ${words[1]}` : words[0]!
}
