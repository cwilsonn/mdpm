import { existsSync, watch, type FSWatcher } from 'node:fs'
import { sep } from 'node:path'
import { parseNotes } from './log'
import type { Ops } from './ops'

// Live view of changes to the content directory. A change to any file under a project (or to standalone docs)
// triggers a debounced rescan of just that project; the new state is diffed against the last snapshot and
// each difference becomes an event. Whoever wrote the file (the server, the CLI, an editor, git) doesn't matter.

export interface WatchEvent {
  at: string
  kind: 'project' | 'task' | 'doc'
  action: 'created' | 'updated' | 'deleted' | 'archived' | 'unarchived' | 'note'
  /** null for standalone docs */
  project: string | null
  slug: string
  title: string
  changes?: { field: string; from?: unknown; to?: unknown }[]
  note?: { author?: string; text: string }
}

interface TaskSnap {
  title: string; status: string; priority: string; tags: string[]; assignees: string[]; due: string | null
  dependencies: string[]; githubIssues: number[]; githubPRs: number[]; archivedAt: string | null; body: string
}
interface DocSnap { title: string; tags: string[]; parent: string | null; archivedAt: string | null; body: string }
interface ProjectSnap { title: string; status: string; tags: string[]; description: string | null; githubRepo: string | null; icon: string | null; archivedAt: string | null }

export interface Snapshot {
  project?: ProjectSnap
  tasks: Map<string, TaskSnap>
  docs: Map<string, DocSnap>
}

export const emptySnapshot = (): Snapshot => ({ tasks: new Map(), docs: new Map() })

// ── Reading a snapshot ────────────────────────────────────────────────────────

export function readProjectSnapshot(ops: Ops, slug: string): Snapshot {
  const project = ops.listProjects({ includeArchived: true }).find(p => p.slug === slug)
  if (!project) return emptySnapshot()
  return {
    project: { title: project.title, status: project.status, tags: project.tags, description: project.description, githubRepo: project.githubRepo, icon: project.icon, archivedAt: project.archivedAt },
    tasks: new Map(ops.listTasks({ project: slug, includeArchived: true }).map(t => [t.slug, {
      title: t.title, status: t.status, priority: t.priority, tags: t.tags, assignees: t.assignees, due: t.due, dependencies: t.dependencies,
      githubIssues: t.githubIssues, githubPRs: t.githubPRs, archivedAt: t.archivedAt, body: t.body,
    }])),
    docs: new Map(ops.listDocsWithBody({ project: slug, includeArchived: true }).map(d => [d.slug, { title: d.title, tags: d.tags, parent: d.parent, archivedAt: d.archivedAt, body: d.body }])),
  }
}

export function readStandaloneSnapshot(ops: Ops): Snapshot {
  return {
    tasks: new Map(),
    docs: new Map(ops.listDocsWithBody({ standalone: true, includeArchived: true }).map(d => [d.slug, { title: d.title, tags: d.tags, parent: d.parent, archivedAt: d.archivedAt, body: d.body }])),
  }
}

// ── Diffing ───────────────────────────────────────────────────────────────────

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const noteKey = (n: { at: Date; author?: string; text: string }) => `${n.at.toISOString()}|${n.author ?? ''}|${n.text}`

type Change = { field: string; from?: unknown; to?: unknown }

function changed<T extends object>(before: T, after: T, fields: (keyof T)[]): Change[] {
  return fields.filter(f => !same(before[f], after[f])).map(f => ({ field: String(f), from: before[f], to: after[f] }))
}

export function diffSnapshots(before: Snapshot, after: Snapshot, project: string | null, at: string): WatchEvent[] {
  const events: WatchEvent[] = []
  const base = { at, project }

  if (project && (before.project || after.project)) {
    if (!before.project && after.project) events.push({ ...base, kind: 'project', action: 'created', slug: project, title: after.project.title })
    else if (before.project && !after.project) events.push({ ...base, kind: 'project', action: 'deleted', slug: project, title: before.project.title })
    else if (before.project && after.project) {
      const archivedFlip = !!before.project.archivedAt !== !!after.project.archivedAt
      if (archivedFlip) events.push({ ...base, kind: 'project', action: after.project.archivedAt ? 'archived' : 'unarchived', slug: project, title: after.project.title })
      const changes = changed(before.project, after.project, ['title', 'status', 'tags', 'description', 'githubRepo', 'icon'])
      if (changes.length) events.push({ ...base, kind: 'project', action: 'updated', slug: project, title: after.project.title, changes })
    }
  }

  for (const [slug, t] of after.tasks) {
    const old = before.tasks.get(slug)
    if (!old) { events.push({ ...base, kind: 'task', action: 'created', slug, title: t.title }); continue }
    if (!!old.archivedAt !== !!t.archivedAt) events.push({ ...base, kind: 'task', action: t.archivedAt ? 'archived' : 'unarchived', slug, title: t.title })
    const changes = changed(old, t, ['title', 'status', 'priority', 'tags', 'assignees', 'due', 'dependencies', 'githubIssues', 'githubPRs'])
    // A note is an append to the body; anything else that touches the body is an edit of the description.
    const oldKeys = new Set(parseNotes(old.body).map(noteKey))
    const fresh = parseNotes(t.body).filter(n => !oldKeys.has(noteKey(n)))
    if (old.body !== t.body && !(fresh.length && t.body.startsWith(old.body))) changes.push({ field: 'description' })
    if (changes.length) events.push({ ...base, kind: 'task', action: 'updated', slug, title: t.title, changes })
    for (const n of fresh) events.push({ ...base, kind: 'task', action: 'note', slug, title: t.title, note: { author: n.author, text: n.text } })
  }
  for (const [slug, t] of before.tasks) if (!after.tasks.has(slug)) events.push({ ...base, kind: 'task', action: 'deleted', slug, title: t.title })

  for (const [slug, d] of after.docs) {
    const old = before.docs.get(slug)
    if (!old) { events.push({ ...base, kind: 'doc', action: 'created', slug, title: d.title }); continue }
    if (!!old.archivedAt !== !!d.archivedAt) events.push({ ...base, kind: 'doc', action: d.archivedAt ? 'archived' : 'unarchived', slug, title: d.title })
    const changes = changed(old, d, ['title', 'tags', 'parent'])
    if (old.body !== d.body) changes.push({ field: 'body' })
    if (changes.length) events.push({ ...base, kind: 'doc', action: 'updated', slug, title: d.title, changes })
  }
  for (const [slug, d] of before.docs) if (!after.docs.has(slug)) events.push({ ...base, kind: 'doc', action: 'deleted', slug, title: d.title })
  return events
}

// ── Watching ──────────────────────────────────────────────────────────────────

export interface WatchOptions {
  /** Only this project (and no standalone docs). */
  project?: string
  onEvent: (event: WatchEvent) => void
  onError?: (err: Error) => void
  debounceMs?: number
  now?: () => Date
}

// Which scope does a path inside the content directory belong to? A project slug, standalone docs, or neither.
export function scopeOfPath(relative: string): { project: string } | { standalone: true } | undefined {
  const parts = relative.split(sep).filter(Boolean)
  if (parts[0] === 'projects' && parts[1]) return { project: parts[1] }
  if (parts[0] === 'docs' && parts.length > 1) return { standalone: true }
  return undefined
}

export function watchContent(ops: Ops, opts: WatchOptions): { close: () => void } {
  const root = ops.config.contentPath
  if (!existsSync(root)) throw new Error(`content directory not found: ${root}`)
  const debounceMs = opts.debounceMs ?? 150
  const now = opts.now ?? (() => new Date())
  const key = (p: string | null) => p ?? '(standalone)'

  const snapshots = new Map<string, Snapshot>()
  const projects = ops.listProjects({ includeArchived: true }).map(p => p.slug).filter(p => !opts.project || p === opts.project)
  for (const p of projects) snapshots.set(key(p), readProjectSnapshot(ops, p))
  if (!opts.project) snapshots.set(key(null), readStandaloneSnapshot(ops))

  const timers = new Map<string, NodeJS.Timeout>()
  const rescan = (project: string | null) => {
    try {
      const before = snapshots.get(key(project)) ?? emptySnapshot()
      const after = project ? readProjectSnapshot(ops, project) : readStandaloneSnapshot(ops)
      snapshots.set(key(project), after)
      for (const event of diffSnapshots(before, after, project, now().toISOString())) opts.onEvent(event)
    }
    catch (err) {
      opts.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }

  let watcher: FSWatcher
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      if (!filename) return
      const scope = scopeOfPath(String(filename))
      if (!scope) return
      const project = 'project' in scope ? scope.project : null
      if (opts.project && project !== opts.project) return
      clearTimeout(timers.get(key(project)))
      timers.set(key(project), setTimeout(() => { timers.delete(key(project)); rescan(project) }, debounceMs))
    })
  }
  catch (err) {
    throw new Error(`cannot watch ${root}: ${(err as Error).message}`)
  }
  watcher.on('error', err => opts.onError?.(err))
  return { close: () => { for (const t of timers.values()) clearTimeout(t); watcher.close() } }
}
