import { splitNotes } from './log'

// Presentation-layer shaping shared by the CLI and the MCP server: how many rows, which fields, how much text.
// Nothing here touches `ops`: bulk operations, the log, hooks, the dependency graph and export all need the
// full, unbounded lists, so limits are applied only to what is printed.

// First prose line of a markdown body: skips blank lines, headings, and rules, and trims markup noise.
export function summarize(text: string, max = 140) {
  const line = text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !/^[-*_]{3,}$/.test(l)) ?? ''
  const plain = line.replace(/[*`]/g, '').replace(/\s+/g, ' ')
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

export const DEFAULT_LIMIT = 20
/** Hard cap on one body returned by a read; the rest is one explicit flag away. */
export const DEFAULT_MAX_CHARS = 8000

/** Fields a task list row carries unless asked for more. No body, no links: those are what `show` is for. */
export const TASK_LIST_FIELDS = ['project', 'slug', 'title', 'status', 'priority', 'tags', 'assignees', 'due', 'updatedAt'] as const
export const DOC_LIST_FIELDS = ['project', 'slug', 'title', 'tags', 'parent', 'updatedAt'] as const

export interface Page<T> {
  total: number
  offset: number
  returned: number
  /** Offset of the next page, or null when this is the last. */
  nextOffset: number | null
  items: T[]
}

// limit 0 means "everything". Offsets past the end give an empty page, not an error.
export function paginate<T>(all: T[], opts: { limit?: number; offset?: number } = {}): Page<T> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const offset = Math.max(0, opts.offset ?? 0)
  const items = limit > 0 ? all.slice(offset, offset + limit) : all.slice(offset)
  const end = offset + items.length
  return { total: all.length, offset, returned: items.length, nextOffset: end < all.length ? end : null, items }
}

// "20 of 57 shown (offset 0). More: --offset 20, or --limit 0 for all."
export function pageFooter(page: Page<unknown>, noun = 'item', flags = { offset: '--offset', all: '--limit 0' }) {
  const plural = page.total === 1 ? noun : `${noun}s`
  if (page.nextOffset === null && page.offset === 0) return `${page.total} ${plural}`
  const more = page.nextOffset === null ? '' : ` More: ${flags.offset} ${page.nextOffset}, or ${flags.all} for all.`
  return `${page.returned} of ${page.total} ${plural} shown (offset ${page.offset}).${more}`
}

// `--fields a,b,c`. `*` means every field. Unknown names are rejected so a typo isn't an empty column.
export function parseFields(value: string | string[] | undefined, allowed: readonly string[], fallback: readonly string[]): string[] {
  if (value === undefined) return [...fallback]
  const list = (Array.isArray(value) ? value : value.split(',')).map(f => f.trim()).filter(Boolean)
  if (list.includes('*')) return [...allowed]
  const bad = list.filter(f => !allowed.includes(f))
  if (bad.length) throw new RangeError(`unknown field${bad.length === 1 ? '' : 's'}: ${bad.join(', ')} (known: ${allowed.join(', ')}, or *)`)
  return list
}

export function pickFields<T extends Record<string, unknown>>(item: T, fields: readonly string[]) {
  return Object.fromEntries(fields.filter(f => f in item).map(f => [f, item[f]])) as Partial<T>
}

const tsvCell = (v: unknown) => {
  if (v === null || v === undefined) return ''
  const s = Array.isArray(v) ? v.join(',') : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return s.replace(/\t/g, ' ').replace(/\r?\n/g, ' ')
}

// Header once, then one tab-separated line per row. Keys are not repeated per row, which is most of the saving.
export function toTsv(rows: Record<string, unknown>[], fields: readonly string[]) {
  return [fields.join('\t'), ...rows.map(r => fields.map(f => tsvCell(r[f])).join('\t'))].join('\n')
}

export function truncateChars(text: string, max: number, offset = 0) {
  const start = Math.min(Math.max(0, offset), text.length)
  if (max <= 0 || text.length - start <= max) return { text: text.slice(start), truncated: false, total: text.length, nextOffset: null as number | null }
  return { text: text.slice(start, start + max), truncated: true, total: text.length, nextOffset: start + max as number | null }
}

/** First line of a note, for list views and digests. */
export const noteSummary = (text: string, max = 100) => summarize(text, max)

const NOTE_CHARS = 600

// One task for a read. The spec is capped; notes (appended history) are reduced to the newest few, each
// shortened, with a count of what was left out. `full` returns the body untouched.
export type ShapedTask<T> = T & { truncated: boolean; olderNotes?: number; note?: string }

export function shapeTask<T extends { body: string }>(task: T, opts: { full?: boolean; maxChars?: number; notes?: number } = {}): ShapedTask<T> {
  if (opts.full) return { ...task, truncated: false }
  const max = opts.maxChars ?? DEFAULT_MAX_CHARS
  const keep = opts.notes ?? 3
  const { spec, notes } = splitNotes(task.body)
  const specOut = truncateChars(spec, max)
  const recent = notes.slice(-keep)
  const stamp = (n: (typeof notes)[number]) => n.at.toISOString().replace('T', ' ').slice(0, 16)
  const noteText = recent.map((n) => {
    const t = truncateChars(n.text, NOTE_CHARS)
    return `**Note** _(${stamp(n)})_${n.author ? ` by ${n.author}` : ''}\n\n${t.text}${t.truncated ? ' …' : ''}`
  })
  const hidden = notes.length - recent.length
  const body = [specOut.text + (specOut.truncated ? '\n\n…' : ''), ...noteText].filter(Boolean).join('\n\n---\n')
  const truncated = specOut.truncated || hidden > 0 || recent.some(n => n.text.length > NOTE_CHARS)
  return {
    ...task,
    body,
    truncated,
    ...(hidden > 0 && { olderNotes: hidden }),
    ...(truncated && { note: `body shortened (spec ${specOut.total} chars, ${notes.length} notes); pass full to read it all` }),
  }
}

// A doc for a read: body capped, `offset` pages through the rest.
export function shapeDoc<T extends { body: string }>(doc: T, opts: { maxChars?: number; offset?: number } = {}) {
  const t = truncateChars(doc.body, opts.maxChars ?? DEFAULT_MAX_CHARS, opts.offset)
  return {
    ...doc,
    body: t.text,
    truncated: t.truncated || (opts.offset ?? 0) > 0,
    ...(t.truncated && { totalChars: t.total, nextOffset: t.nextOffset, note: `body cut at ${t.nextOffset} of ${t.total} chars; pass offset=${t.nextOffset} for the next part, or maxChars=0 for all` }),
  }
}

/** Every field a task list row may carry (`--fields`). `summary` and `noteCount` are derived from the body. */
export const TASK_FIELDS = ['project', 'slug', 'title', 'status', 'priority', 'tags', 'assignees', 'due', 'dependencies', 'links', 'githubIssues', 'githubPRs', 'githubRepo', 'createdAt', 'updatedAt', 'archivedAt', 'order', 'summary', 'noteCount', 'match'] as const
export const DOC_FIELDS = ['project', 'slug', 'title', 'tags', 'parent', 'createdAt', 'updatedAt', 'archivedAt', 'links', 'excerpt', 'summary'] as const

// A task as a list row: everything but the body, plus derived `summary` (first prose line of the spec),
// `noteCount`, and, for a search, `match` (the first line containing the query).
export function taskRow<T extends { body: string }>(task: T, query?: string) {
  const { body, ...rest } = task
  const { spec, notes } = splitNotes(body)
  const q = query?.toLowerCase()
  const line = q ? body.split('\n').find(l => l.toLowerCase().includes(q))?.trim() : undefined
  return {
    ...rest,
    summary: summarize(spec),
    noteCount: notes.length,
    match: line ? (line.length > 120 ? `${line.slice(0, 119)}…` : line) : '',
  }
}

export function docRow<T extends { body: string }>(doc: T) {
  const { body, ...rest } = doc
  return { ...rest, summary: summarize(body) }
}
