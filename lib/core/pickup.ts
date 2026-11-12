import { blockedTasks, buildGraph } from './deps'
import { buildLog, parseNotes, splitNotes, type LogEntry } from './log'
import { summarize, truncateChars } from './shape'

export { summarize }
import type { Ops } from './ops'

const OPEN_STATUSES = ['in-progress', 'blocked', 'in-review', 'todo'] as const
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const SUMMARY_CHARS = 90
const HIGH_PRIORITY_TAGS = ['architecture', 'decisions', 'context']

type Task = ReturnType<Ops['listTasks']>[number]
type Doc = ReturnType<Ops['listDocsWithBody']>[number]

function isSessionNotes(doc: Doc) {
  return doc.tags.includes('session-notes') || doc.slug.includes('session-notes')
}

// Newest first. Slugs are inconsistent (`2026-07-08-2214-session-notes` vs `session-notes-2026-07-08-2206`),
// so the date and optional HHMM are pulled out of the slug wherever they sit; createdAt/updatedAt break ties.
export function sessionNotesOrder(a: Doc, b: Doc) {
  const key = (d: Doc) => {
    const m = d.slug.match(/(\d{4}-\d{2}-\d{2})(?:-(\d{4}))?/)
    return [m?.[1] ?? d.createdAt.slice(0, 10), m?.[2] ?? '', d.updatedAt ?? d.createdAt]
  }
  const [ka, kb] = [key(a), key(b)]
  for (let i = 0; i < ka.length; i++) {
    if (ka[i]! !== kb[i]!) return ka[i]! < kb[i]! ? 1 : -1
  }
  return 0
}

export interface PickupOptions {
  /** Tasks listed per status before "+N more" (default 8). */
  perStatus?: number
  /** Docs listed besides the high-priority ones (default 4). */
  docs?: number
  /** Characters of the last session notes included (default 2000). */
  notesChars?: number
  /** Delta entries listed (default 8). */
  deltaEntries?: number
  /** No caps at all: the briefing as it was before limits existed. */
  full?: boolean
}

// The moment of the last handoff. The doc's own ISO updatedAt when it has one; otherwise the date and HHMM in the
// slug (local time, written by whoever ran /handoff); otherwise its createdAt.
export function handoffTime(doc: Doc): Date | undefined {
  if (doc.updatedAt && doc.updatedAt.includes('T')) return new Date(doc.updatedAt)
  const m = doc.slug.match(/(\d{4})-(\d{2})-(\d{2})(?:-(\d{2})(\d{2}))?/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0))
  const created = new Date(doc.createdAt)
  return Number.isNaN(created.getTime()) ? undefined : created
}

const firstLine = (text: string, max = 100) => {
  const line = text.split('\n').map(l => l.trim()).find(Boolean) ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export function buildPickup(ops: Ops, project: string, opts: PickupOptions = {}) {
  const cap = (n: number | undefined, fallback: number) => opts.full ? Infinity : (n ?? fallback)
  const perStatus = cap(opts.perStatus, 8)
  const projectInfo = ops.getProject(project)
  const open = ops.listTasks({ project, status: [...OPEN_STATUSES] })
  const byRank = (a: Task, b: Task) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.order - b.order
  const hiddenTasks: Partial<Record<typeof OPEN_STATUSES[number], number>> = {}
  const tasks = Object.fromEntries(OPEN_STATUSES.map((status) => {
    const inStatus = open.filter(t => t.status === status).sort(byRank)
    if (inStatus.length > perStatus) hiddenTasks[status] = inStatus.length - perStatus
    return [status, inStatus.slice(0, perStatus).map(t => ({
      slug: t.slug,
      title: t.title,
      priority: t.priority,
      ...(t.tags.length && { tags: t.tags }),
      summary: summarize(splitNotes(t.body).spec, SUMMARY_CHARS),
    }))]
  })) as Record<typeof OPEN_STATUSES[number], { slug: string; title: string; priority: string; tags?: string[]; summary: string }[]>

  const docs = ops.listDocsWithBody({ project })
  const sessionNotes = docs.filter(isSessionNotes).sort(sessionNotesOrder)
  const latest = sessionNotes[0]
  const lastSessionNotes = latest ?? null

  // Deterministic stand-in for judgment: work already under way first, then todo by priority and
  // board order; in-review work (waiting on verification) only fills remaining slots.
  const focusPool = open.filter(t => t.status !== 'blocked')
  const focusOrder = (t: Task) => [t.status === 'in-progress' ? 0 : t.status === 'todo' ? 1 : 2, PRIORITY_RANK[t.priority] ?? 9, t.order]
  const suggestedFocus = [...focusPool].sort((a, b) => {
    const [ka, kb] = [focusOrder(a), focusOrder(b)]
    return ka[0]! - kb[0]! || ka[1]! - kb[1]! || ka[2]! - kb[2]!
  }).slice(0, 3).map(t => ({ slug: t.slug, title: t.title, priority: t.priority, status: t.status }))

  // What stops work: tasks marked blocked (with the reason from their newest note) and open tasks waiting on
  // an unfinished or missing dependency.
  const graph = buildGraph(ops.listTasks({ includeArchived: true }))
  const blockers = [
    ...open.filter(t => t.status === 'blocked').map((t) => {
      const last = parseNotes(t.body).at(-1)
      return { slug: t.slug, title: t.title, reason: last ? firstLine(last.text) : 'marked blocked' }
    }),
    ...blockedTasks(graph).filter(b => b.task.project === project && b.task.status !== 'blocked').map(b => ({
      slug: b.task.slug,
      title: b.task.title,
      reason: `waits on ${b.blockers.map(x => x.reason === 'missing' ? `${x.id} (missing)` : `${x.id} (${x.status})`).join(', ')}`,
    })),
  ]

  const docList = docs.filter(d => !isSessionNotes(d)).map(d => ({
    slug: d.slug,
    title: d.title,
    tags: d.tags,
    summary: summarize(d.body, SUMMARY_CHARS),
    highPriority: d.tags.some(t => HIGH_PRIORITY_TAGS.includes(t)),
  }))
  const otherDocsShown = cap(opts.docs, 4)
  let others = 0
  const shownDocs = docList.filter(d => d.highPriority || ++others <= otherDocsShown)

  const notesChars = cap(opts.notesChars, 2000)
  const notesBody = lastSessionNotes ? truncateChars(lastSessionNotes.body, notesChars) : undefined

  // Delta: only what changed since the last handoff. Status changes are not recorded anywhere, so an "updated"
  // entry shows the task's current status, not a transition.
  const anchor = latest ? handoffTime(latest) : undefined
  let sinceLastSession: { since: string; basedOn: string; changes: LogEntry[]; moreChanges: number; docsChanged: { slug: string; title: string }[]; note: string } | null = null
  if (latest && anchor && !Number.isNaN(anchor.getTime())) {
    const entries = buildLog(ops, { project, since: anchor, limit: 10_000 })
    const shown = entries.slice(0, cap(opts.deltaEntries, 8))
    sinceLastSession = {
      since: anchor.toISOString(),
      basedOn: latest.slug,
      changes: shown.map(e => ({ ...e, at: e.at.slice(0, 16).replace('T', ' ') })),
      moreChanges: entries.length - shown.length,
      docsChanged: docs.filter(d => !isSessionNotes(d) && d.updatedAt && Date.parse(d.updatedAt) > anchor.getTime()).map(d => ({ slug: d.slug, title: d.title })),
      note: 'status changes are not recorded; "updated" shows current status',
    }
  }

  return {
    project: { slug: projectInfo.slug, title: projectInfo.title, githubRepo: projectInfo.githubRepo, links: projectInfo.links },
    openTaskCount: open.length,
    tasks,
    ...(Object.keys(hiddenTasks).length && { hiddenTasks }),
    blockers,
    docCount: docs.length,
    docs: shownDocs,
    ...(shownDocs.length < docList.length && { hiddenDocs: docList.length - shownDocs.length }),
    sessionNotesCount: sessionNotes.length,
    lastSessionNotes: lastSessionNotes && {
      slug: lastSessionNotes.slug,
      title: lastSessionNotes.title,
      createdAt: lastSessionNotes.createdAt,
      body: notesBody!.text,
      ...(notesBody!.truncated && { truncated: true, totalChars: notesBody!.total }),
    },
    sinceLastSession,
    suggestedFocus,
  }
}

export type Pickup = ReturnType<typeof buildPickup>
