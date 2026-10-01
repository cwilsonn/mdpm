import { existsSync } from 'node:fs'
import type { ApiClient } from './api'
import type { CoreConfig } from './config'
import { AmbiguousError, NotFoundError } from './errors'
import type { Doc, Reader } from './read'

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

  function listTasks(opts: { project?: string; status?: string[]; priority?: string[]; tags?: string[]; assignee?: string; githubIssue?: number; githubPR?: number; includeArchived?: boolean } = {}) {
    const { project, status, priority, tags, assignee, githubIssue, githubPR, includeArchived } = opts
    return (project
      ? reader.getTasks(project, status, githubIssue, githubPR)
      : reader.getAllTasks(status, githubIssue, githubPR)
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

  function deleteTask(project: string, slug: string) {
    return api.delete(`/api/tasks/${project}/${slug}`)
  }

  function appendTaskNote(project: string, slug: string, note: string) {
    const task = getTask(project, slug)
    const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16)
    // A body starting with `---` would be parsed as frontmatter, so only emit
    // the separator when there is existing content above it.
    const existing = task.body.trim()
    const prefix = existing ? `${existing}\n\n---\n` : ''
    const description = `${prefix}**Note** _(${timestamp})_\n\n${note.trim()}`
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
    resolveDoc,
    archiveTask,
    createTask,
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
