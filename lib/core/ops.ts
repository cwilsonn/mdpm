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

  // Resolve a user-typed reference to one task: `slug`, `project/slug`, a unique slug prefix,
  // a unique slug substring, or a unique title substring, tried in that order. Archived tasks
  // are included so they can be unarchived or deleted.
  function resolveTask(ref: string, project?: string) {
    let scope = project
    let needle = ref
    const slash = ref.indexOf('/')
    if (slash > 0) {
      scope = ref.slice(0, slash)
      needle = ref.slice(slash + 1)
    }
    if (scope) getProject(scope)
    const tasks = listTasks({ project: scope, includeArchived: true })
    const lower = needle.toLowerCase()
    const stages = [
      (t: typeof tasks[number]) => t.slug === needle,
      (t: typeof tasks[number]) => t.slug.startsWith(lower),
      (t: typeof tasks[number]) => t.slug.includes(lower),
      (t: typeof tasks[number]) => t.title.toLowerCase().includes(lower),
    ]
    for (const match of stages) {
      const hits = tasks.filter(match)
      if (hits.length === 1) return hits[0]!
      if (hits.length > 1) {
        const list = hits.slice(0, 8).map(t => `  ${t.project}/${t.slug}`).join('\n')
        throw new AmbiguousError(`'${ref}' matches ${hits.length} tasks; be more specific:\n${list}${hits.length > 8 ? '\n  …' : ''}`)
      }
    }
    throw new NotFoundError(`No task matches '${ref}'${scope ? ` in project '${scope}'` : ''}`)
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
  function listDocs(opts: { project?: string; standalone?: boolean; includeArchived?: boolean } = {}) {
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
    return all
      .filter(d => opts.includeArchived || !hidden(d))
      .map(({ body: _, ...d }) => d)
  }

  function getDoc(slug: string, project?: string) {
    const doc = reader.getDocs(project).find(d => d.slug === slug && (project ? d.project === project : !d.project))
    if (!doc) throw new NotFoundError(`Doc '${slug}' not found${project ? ` in project '${project}'` : ' (standalone)'}`)
    return doc
  }

  function deleteDoc(project: string, slug: string) {
    return api.delete(`/api/docs/${project}/${slug}`)
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
    archiveTask,
    createTask,
    updateTask,
    deleteTask,
    appendTaskNote,
    createProject,
    listDocs,
    getDoc,
    deleteDoc,
    upsertDoc,
    searchTasks: reader.searchTasks,
    searchDocs: reader.searchDocs,
    probeServer: api.probe,
  }
}

export type Ops = ReturnType<typeof createOps>
