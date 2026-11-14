import { existsSync } from 'node:fs'
import type { ApiClient } from './api'
import type { CoreConfig } from './config'
import { AmbiguousError, NotFoundError } from './errors'
import { appendNoteToBody } from './log'
import { slugify, uniqueSlug } from './slug'
import type { Doc, Reader } from './read'

export type BatchItem =
  | ({ op: 'create'; project?: string; title: string } & Record<string, unknown>)
  | ({ op: 'update'; ref: string; project?: string } & Record<string, unknown>)
  | { op: 'note'; ref: string; project?: string; note: string; author?: string }

export interface BatchResult {
  ok: number
  failed: number
  results: { index: number; ok: boolean; id?: string; status?: string; error?: string }[]
}

// Higher-level operations shared by the MCP server and the CLI. Reads go
// through the Reader (files), writes through the ApiClient (HTTP).
export function createOps(config: CoreConfig, reader: Reader, api: ApiClient) {
  function listProjects(opts: { includeArchived?: boolean } = {}) {
    return reader.getProjects().filter(p => opts.includeArchived || !p.archivedAt)
  }

  function getProject(slug: string) {
    const project = reader.getProjects().find(p => p.slug === slug)
    if (!project) throw new NotFoundError(`Project '${slug}' not found`)
    return project
  }

  function listTasks(opts: { project?: string; status?: string[]; priority?: string[]; tags?: string[]; assignee?: string; includeArchived?: boolean } = {}) {
    const { project, status, priority, tags, assignee, includeArchived } = opts
    return (project
      ? reader.getTasks(project, status)
      : reader.getAllTasks(status)
    ).filter(t =>
      (includeArchived || !t.archivedAt)
      && (!priority?.length || priority.includes(t.priority))
      && (!tags?.length || tags.some(tag => t.tags.includes(tag)))
      && (!assignee || t.assignees.includes(assignee)),
    )
  }

  // Resolve a user-typed reference to exactly one item. Stages, first unique hit wins:
  // exact slug, slug prefix, slug substring, title substring. Several hits in a stage is
  // ambiguous; no hits anywhere is not-found.
  function matchRef<T extends { slug: string; title: string }>(ref: string, items: T[], label: string, describe: (item: T) => string, scope?: string) {
    const lower = ref.toLowerCase()
    const stages = [
      (i: T) => i.slug === ref,
      (i: T) => i.slug.toLowerCase().startsWith(lower),
      (i: T) => i.slug.toLowerCase().includes(lower),
      (i: T) => i.title.toLowerCase().includes(lower),
    ]
    for (const match of stages) {
      const hits = items.filter(match)
      if (hits.length === 1) return hits[0]!
      if (hits.length > 1) {
        const list = hits.slice(0, 8).map(i => `  ${describe(i)}`).join('\n')
        throw new AmbiguousError(`'${ref}' matches ${hits.length} ${label}s; be more specific:\n${list}${hits.length > 8 ? '\n  …' : ''}`)
      }
    }
    throw new NotFoundError(`No ${label} matches '${ref}'${scope ? ` in ${scope}` : ''}`)
  }

  // `slug`, `project/slug`, or any unique fragment (see matchRef). Archived tasks are included
  // so they can be unarchived or deleted.
  function resolveTask(ref: string, project?: string) {
    let scope = project
    let needle = ref
    const slash = ref.indexOf('/')
    if (slash > 0) {
      scope = ref.slice(0, slash)
      needle = ref.slice(slash + 1)
    }
    if (scope) getProject(scope)
    return matchRef(needle, listTasks({ project: scope, includeArchived: true }), 'task', t => `${t.project}/${t.slug}`, scope && `project '${scope}'`)
  }

  function resolveProject(ref: string) {
    return matchRef(ref, listProjects({ includeArchived: true }), 'project', p => p.slug)
  }

  function updateProject(slug: string, fields: Record<string, unknown>) {
    return api.patch(`/api/projects/${slug}`, fields)
  }

  function deleteProject(slug: string) {
    return api.delete(`/api/projects/${slug}`)
  }

  function archiveProject(slug: string, archived = true) {
    return api.patch(`/api/projects/${slug}`, { archivedAt: archived ? new Date().toISOString() : null })
  }

  // Docs are scoped like getDocs: a project, standalone only, or (neither) everything. Archived included.
  function resolveDoc(ref: string, opts: { project?: string; standalone?: boolean } = {}) {
    const { project, standalone } = opts
    if (project) getProject(project)
    const scope = project ? `project '${project}'` : standalone ? 'standalone docs' : undefined
    const docs = reader.getDocs(project, standalone)
    return matchRef(ref, docs, 'doc', d => d.project ? `${d.project}/${d.slug}` : d.slug, scope)
  }

  function archiveTask(project: string, slug: string, archived = true) {
    return api.patch(`/api/tasks/${project}/${slug}`, { archivedAt: archived ? new Date().toISOString() : null })
  }

  function getTask(project: string, slug: string) {
    const task = reader.getTasks(project).find(t => t.slug === slug)
    if (!task) throw new NotFoundError(`Task '${slug}' not found in project '${project}'`)
    return task
  }

  function createTask(project: string, fields: Record<string, unknown>) {
    return api.post('/api/tasks', { project, ...fields })
  }

  function updateTask(project: string, slug: string, fields: Record<string, unknown>) {
    return api.patch(`/api/tasks/${project}/${slug}`, fields)
  }

  // ── Batch ─────────────────────────────────────────────────────────────────

  // One request for several task writes. `update`/`note` items name their task by `ref` (slug, fragment, or
  // project/slug); `create` items by `title`. Refs are resolved here, from the files, so the server only sees ids.
  // A ref that does not resolve fails that item locally; the rest still go through, in order.
  async function batchTasks(defaultProject: string | undefined, items: BatchItem[]): Promise<BatchResult> {
    const sent: { index: number; op: Record<string, unknown> }[] = []
    const results: BatchResult['results'] = []
    items.forEach((item, index) => {
      try {
        if (item.op === 'create') {
          const project = item.project ?? defaultProject
          if (!project) throw new NotFoundError('create needs a project')
          const { op, project: _p, ...fields } = item
          sent.push({ index, op: { op, project, ...fields } })
          return
        }
        if (item.op !== 'update' && item.op !== 'note') throw new Error(`unknown op '${(item as { op?: string }).op}'`)
        if (!item.ref) throw new NotFoundError(`${item.op} needs a ref`)
        const task = resolveTask(item.ref, item.project ?? defaultProject)
        const { op, ref: _r, project: _p, author, ...fields } = item as BatchItem & { author?: string }
        sent.push({ index, op: { op, project: task.project, slug: task.slug, ...fields, ...(author && { noteAuthor: author }) } })
      }
      catch (err) {
        results.push({ index, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
    })
    if (sent.length) {
      const res = await api.post('/api/tasks/batch', { ops: sent.map(s => s.op) }) as { results: BatchResult['results'] }
      res.results.forEach((r, i) => results.push({ ...r, index: sent[i]!.index }))
    }
    results.sort((a, b) => a.index - b.index)
    const failed = results.filter(r => !r.ok).length
    return { ok: results.length - failed, failed, results }
  }

  // Begin a unit of work in one call: resume the open task that exactly matches `titleOrRef` (its slug, the slug
  // of that title, or its title), otherwise create it, and leave it in-progress. Never a fuzzy match: starting
  // the wrong task silently would be worse than creating a new one.
  function findStartable(project: string, titleOrRef: string) {
    const wantSlug = slugify(titleOrRef.trim())
    return listTasks({ project }).find(t =>
      t.status !== 'done' && (t.slug === titleOrRef || t.slug === wantSlug || t.title.toLowerCase() === titleOrRef.trim().toLowerCase()))
  }

  // The id startTask would end up with, without writing (for fire-and-forget callers).
  function previewStart(project: string, titleOrRef: string) {
    getProject(project)
    const existing = findStartable(project, titleOrRef)
    return `${project}/${existing?.slug ?? predictTaskSlug(project, titleOrRef.trim())}`
  }

  async function startTask(project: string, titleOrRef: string, fields: Record<string, unknown> = {}) {
    getProject(project)
    const existing = findStartable(project, titleOrRef)
    if (existing) {
      if (existing.status !== 'in-progress') await updateTask(project, existing.slug, { status: 'in-progress' })
      return { id: `${project}/${existing.slug}`, slug: existing.slug, status: 'in-progress', created: false, was: existing.status }
    }
    const created = await createTask(project, { title: titleOrRef.trim(), ...fields, status: 'in-progress' }) as { slug: string }
    return { id: `${project}/${created.slug}`, slug: created.slug, status: 'in-progress', created: true }
  }

  // The slug a create would get, from the files; the server picks the same unless a writer races us.
  function predictTaskSlug(project: string, title: string) {
    getProject(project)
    const taken = new Set(listTasks({ project, includeArchived: true }).map(t => t.slug))
    return uniqueSlug(slugify(title), s => taken.has(s))
  }

  function deleteTask(project: string, slug: string) {
    return api.delete(`/api/tasks/${project}/${slug}`)
  }

  function appendTaskNote(project: string, slug: string, note: string, author?: string) {
    const task = getTask(project, slug)
    const description = appendNoteToBody(task.body, note, author)
    return api.patch(`/api/tasks/${project}/${slug}`, { description })
  }

  function createProject(fields: unknown) {
    return api.post('/api/projects', fields)
  }

  // Hides archived docs and any doc under an archived folder (archivedAt lives
  // only on the archived node; descendants are inferred here).
  // Full docs (with body), minus archived ones and children of archived folders unless asked.
  // archivedAt lives only on the archived node; descendants are inferred here.
  function listDocsWithBody(opts: { project?: string; standalone?: boolean; includeArchived?: boolean } = {}) {
    const all = reader.getDocs(opts.project, opts.standalone)
    const bySlug = new Map(all.map(d => [d.slug, d]))
    const hidden = (d: Doc): boolean => {
      let cur: Doc | undefined = d
      const seen = new Set<string>()
      while (cur && !seen.has(cur.slug)) {
        if (cur.archivedAt) return true
        seen.add(cur.slug)
        cur = cur.parent ? bySlug.get(cur.parent) : undefined
      }
      return false
    }
    return all.filter(d => opts.includeArchived || !hidden(d))
  }

  function listDocs(opts: { project?: string; standalone?: boolean; includeArchived?: boolean } = {}) {
    return listDocsWithBody(opts).map(({ body: _, ...d }) => d)
  }

  function getDoc(slug: string, project?: string) {
    const doc = reader.getDocs(project).find(d => d.slug === slug && (project ? d.project === project : !d.project))
    if (!doc) throw new NotFoundError(`Doc '${slug}' not found${project ? ` in project '${project}'` : ' (standalone)'}`)
    return doc
  }

  // Project docs live under /api/docs/<project>, standalone docs under /api/standalone-docs.
  const docBase = (project?: string | null) => project ? `/api/docs/${project}` : '/api/standalone-docs'

  function deleteDoc(project: string | null | undefined, slug: string) {
    return api.delete(`${docBase(project)}/${slug}`)
  }

  function createDoc(input: { project?: string; title: string; body?: string; tags?: string[]; parent?: string; slug?: string }) {
    const { project, ...fields } = input
    return api.post(docBase(project), fields)
  }

  function updateDoc(doc: { project?: string | null; slug: string }, fields: { title?: string; body?: string; tags?: string[]; parent?: string | null; archivedAt?: string | null }) {
    return api.patch(`${docBase(doc.project)}/${doc.slug}`, fields)
  }

  function archiveDoc(doc: { project?: string | null; slug: string }, archived = true) {
    return updateDoc(doc, { archivedAt: archived ? new Date().toISOString() : null })
  }

  async function upsertDoc(input: { project?: string; slug?: string; title: string; body: string; tags?: string[]; parent?: string }) {
    const { project, slug, title, body, tags, parent } = input
    const [dir, patchPath, postPath] = project
      ? [['projects', project, 'docs'], `/api/docs/${project}`, `/api/docs/${project}`]
      : [['docs'], '/api/standalone-docs', '/api/standalone-docs']
    if (slug && existsSync(reader.contentPath(...dir, `${slug}.md`))) {
      const result = await api.patch(`${patchPath}/${slug}`, { title, body, tags, parent })
      result.slug = slug
      return result
    }
    return api.post(postPath, { title, body, tags, parent, slug })
  }

  return {
    config,
    listProjects,
    getProject,
    listTasks,
    getTask,
    resolveTask,
    resolveProject,
    archiveProject,
    updateProject,
    deleteProject,
    resolveDoc,
    archiveTask,
    createTask,
    batchTasks,
    predictTaskSlug,
    previewStart,
    startTask,
    updateTask,
    deleteTask,
    appendTaskNote,
    createProject,
    listDocs,
    listDocsWithBody,
    getDoc,
    deleteDoc,
    createDoc,
    updateDoc,
    archiveDoc,
    upsertDoc,
    searchTasks: reader.searchTasks,
    searchDocs: reader.searchDocs,
    probeServer: api.probe,
    serverHealth: api.health,
  }
}

export type Ops = ReturnType<typeof createOps>
