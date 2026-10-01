import { userInfo } from 'node:os'
import type { Ops } from './ops'
import { git } from './project'

// ── Authors ───────────────────────────────────────────────────────────────────

// Who is writing a note? Explicit flag, then MDPM_AUTHOR, then "claude" when running under Claude Code
// (it sets CLAUDECODE=1 in the tool shell), then git's user.name, then the OS user.
export function resolveAuthor(opts: { flag?: string; env?: NodeJS.ProcessEnv; cwd?: string } = {}) {
  const env = opts.env ?? process.env
  const clean = (v: string | undefined) => v?.trim() || undefined
  return clean(opts.flag)
    ?? clean(env.MDPM_AUTHOR)
    ?? (clean(env.CLAUDECODE) ? 'claude' : undefined)
    ?? clean(git(opts.cwd ?? process.cwd(), 'config', 'user.name'))
    ?? clean(userInfo().username)
    ?? 'unknown'
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export interface ParsedNote {
  /** UTC; notes are stamped with toISOString(), minute precision. */
  at: Date
  author?: string
  text: string
}

// `**Note** _(2026-10-01 17:47)_` optionally followed by ` by <author>`, then a blank line and the text.
// Notes written before authors existed have no `by`.
const NOTE_RE = /\*\*Note\*\* _\((\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})\)_(?: by ([^\n]+))?\n\n([\s\S]*?)(?=\n\n---\n\*\*Note\*\* _\(|$)/g

export function parseNotes(body: string): ParsedNote[] {
  return [...body.matchAll(NOTE_RE)].map(m => ({
    at: new Date(`${m[1]}T${m[2]}:00Z`),
    author: m[3]?.trim() || undefined,
    text: m[4]!.trim(),
  }))
}

// ── Log ───────────────────────────────────────────────────────────────────────

export interface LogEntry {
  at: string
  type: 'note' | 'created' | 'updated'
  project: string
  task: string
  title: string
  author?: string
  /** note: first line of the note; updated: the task's current status; created: its priority */
  detail: string
}

// Notes carry minute-precision stamps, so several can tie; their position in the body breaks the tie.
type Ranked = LogEntry & { seq: number }

export interface LogOptions {
  project?: string
  since?: Date
  author?: string
  limit?: number
}

// `2d`, `12h`, `30m`, `1w`, or a date/datetime.
export function parseSince(value: string, now = new Date()): Date | undefined {
  const rel = value.match(/^(\d+)([mhdw])$/)
  if (rel) return new Date(now.getTime() - Number(rel[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[rel[2] as 'm' | 'h' | 'd' | 'w'])
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const firstLine = (text: string, max = 100) => {
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

// Recent activity, newest first: notes (with author when known) plus tasks created or updated. Updates that
// are just the write behind a note are folded into the note. Status changes are not recorded anywhere, so an
// "updated" entry shows the task's current status, not a transition.
export function buildLog(ops: Ops, opts: LogOptions = {}): LogEntry[] {
  const entries: Ranked[] = []
  const authorFilter = opts.author?.toLowerCase()
  for (const t of ops.listTasks({ project: opts.project })) {
    const base = { project: t.project, task: t.slug, title: t.title }
    const notes = parseNotes(t.body)
    notes.forEach((n, i) => entries.push({ ...base, at: n.at.toISOString(), type: 'note', author: n.author, detail: firstLine(n.text), seq: i }))

    // Frontmatter dates: createdAt is date-only, updatedAt a full timestamp (set by every API write).
    const created = t.createdAt ? new Date(`${t.createdAt.slice(0, 10)}T00:00:00Z`) : undefined
    if (created && !Number.isNaN(created.getTime())) entries.push({ ...base, at: created.toISOString(), type: 'created', detail: t.priority, seq: -1 })
    const updated = t.updatedAt ? new Date(t.updatedAt) : undefined
    if (updated && !Number.isNaN(updated.getTime())) {
      const behindANote = notes.some(n => Math.abs(n.at.getTime() - updated.getTime()) < 2 * 60_000)
      if (!behindANote) entries.push({ ...base, at: updated.toISOString(), type: 'updated', detail: t.status, seq: notes.length })
    }
  }
  return entries
    .filter(e => !opts.since || Date.parse(e.at) >= opts.since.getTime())
    // Only notes know their author, so an author filter means notes only.
    .filter(e => !authorFilter || (e.type === 'note' && e.author?.toLowerCase() === authorFilter))
    .sort((a, b) => b.at.localeCompare(a.at) || a.task.localeCompare(b.task) || b.seq - a.seq)
    .slice(0, opts.limit ?? 30)
    .map(({ seq: _, ...entry }) => entry)
}
