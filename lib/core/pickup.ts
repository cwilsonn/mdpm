import type { Ops } from './ops'

const OPEN_STATUSES = ['in-progress', 'blocked', 'in-review', 'todo'] as const
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const HIGH_PRIORITY_TAGS = ['architecture', 'decisions', 'context']

type Task = ReturnType<Ops['listTasks']>[number]
type Doc = ReturnType<Ops['listDocsWithBody']>[number]

// First prose line of a markdown body: skips blank lines, headings, and rules, and trims markup noise.
export function summarize(text: string, max = 140) {
  const line = text.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !/^[-*_]{3,}$/.test(l)) ?? ''
  const plain = line.replace(/[*`]/g, '').replace(/\s+/g, ' ')
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain
}

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

export function buildPickup(ops: Ops, project: string) {
  const projectInfo = ops.getProject(project)
  const open = ops.listTasks({ project, status: [...OPEN_STATUSES] })
  const tasks = Object.fromEntries(OPEN_STATUSES.map(status => [
    status,
    open.filter(t => t.status === status).map(t => ({
      slug: t.slug,
      title: t.title,
      priority: t.priority,
      tags: t.tags,
      summary: summarize(t.body),
    })),
  ])) as Record<typeof OPEN_STATUSES[number], { slug: string; title: string; priority: string; tags: string[]; summary: string }[]>

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

  return {
    project: { slug: projectInfo.slug, title: projectInfo.title, githubRepo: projectInfo.githubRepo },
    openTaskCount: open.length,
    tasks,
    docCount: docs.length,
    docs: docs.filter(d => !isSessionNotes(d)).map(d => ({
      slug: d.slug,
      title: d.title,
      tags: d.tags,
      summary: summarize(d.body),
      highPriority: d.tags.some(t => HIGH_PRIORITY_TAGS.includes(t)),
    })),
    sessionNotesCount: sessionNotes.length,
    lastSessionNotes: lastSessionNotes && {
      slug: lastSessionNotes.slug,
      title: lastSessionNotes.title,
      createdAt: lastSessionNotes.createdAt,
      body: lastSessionNotes.body,
    },
    suggestedFocus,
  }
}

export type Pickup = ReturnType<typeof buildPickup>
