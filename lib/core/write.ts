import { closeSync, existsSync, linkSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import matter from 'gray-matter'
import type { z } from 'zod'
import { LimitError, NotFoundError, ValidationError, WriteBusyError } from './errors'
import { appendNoteToBody } from './log'
import { slugify, uniqueSlug } from './slug'
import { DocUpdate, formatIssues, ProjectCreate, ProjectUpdate, TaskCreate, TaskUpdate } from './write-schemas'

// Every write to the content directory: tasks, docs, projects. The CLI and the MCP server call this directly;
// the Nitro routes are thin wrappers over it. Several processes may write at once, so:
// - a file is replaced by writing a temp file next to it and renaming it over (readers never see half a file);
// - a read-modify-write (update, note append, reorder) holds a short per-file lockfile (O_EXCL);
// - a create claims its slug exclusively, so two creators racing for one slug get two files.
// Temp and lock files are dot-files not ending in `.md`, so directory listings never mistake them for content.

export type TaskCreateInput = z.input<typeof TaskCreate>
export type TaskUpdateInput = z.input<typeof TaskUpdate>
export type DocUpdateInput = z.input<typeof DocUpdate>

export interface DocCreateInput {
  title: string
  slug?: string
  tags?: string[]
  parent?: string
  isFolder?: boolean
  body?: string
}

export interface WriterLimits {
  projects?: number
  tasksPerProject?: number
  docsPerProject?: number
  standaloneDocs?: number
}

export interface WriterOptions {
  /** Creation caps (the public demo); unset means unlimited. */
  limits?: WriterLimits
}

export type BatchWriteOp = { op?: unknown; project?: string; slug?: string } & Record<string, unknown>

export interface BatchWriteResult {
  ok: number
  failed: number
  results: { index: number; ok: boolean; id?: string; status?: string; error?: string }[]
}

const MAX_BATCH_OPS = 100
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/
const LOCK_STALE_MS = 10_000
const LOCK_WAIT_MS = 3_000
const LOCK_POLL_MS = 15

// ── File primitives ─────────────────────────────────────────────────────────

export function assertSafeSlug(...slugs: string[]) {
  for (const s of slugs) {
    if (s !== '' && !SLUG_RE.test(s)) throw new ValidationError(`Invalid slug: "${s}"`)
  }
}

export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  throw new ValidationError(`Invalid request: ${formatIssues(result.error.issues)}`)
}

/** The exact bytes a markdown file is written with (kept identical to the server's historic output). */
export function renderMarkdown(frontmatter: Record<string, unknown>, body = '') {
  return matter.stringify(body.trim(), frontmatter)
}

function sideFile(full: string, suffix: string) {
  return join(dirname(full), `.${basename(full)}.${suffix}`)
}

let tmpCounter = 0
function tmpFile(full: string) {
  return sideFile(full, `${process.pid}.${Date.now().toString(36)}.${tmpCounter++}.tmp`)
}

/** Replace (or create) a file atomically: write a sibling temp file, then rename it over the target. */
export function atomicWrite(full: string, text: string) {
  mkdirSync(dirname(full), { recursive: true })
  const tmp = tmpFile(full)
  try {
    writeFileSync(tmp, text, 'utf-8')
    renameSync(tmp, full)
  }
  catch (err) {
    rmSync(tmp, { force: true })
    throw err
  }
}

/** Create a file that must not exist yet. Returns false (and writes nothing) when it does. */
function createExclusive(full: string, text: string): boolean {
  mkdirSync(dirname(full), { recursive: true })
  const tmp = tmpFile(full)
  writeFileSync(tmp, text, 'utf-8')
  try {
    // link() fails with EEXIST instead of replacing, and the content is complete the moment the name appears.
    linkSync(tmp, full)
    return true
  }
  catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'EEXIST') return false
    // Filesystems without hard links: claim the name exclusively, then fill it in.
    try {
      writeFileSync(full, text, { encoding: 'utf-8', flag: 'wx' })
      return true
    }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw e
    }
  }
  finally {
    rmSync(tmp, { force: true })
  }
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Run `fn` holding an exclusive lock on `full` (a `.name.lock` sibling, created with O_EXCL). A lock older than
 * LOCK_STALE_MS is presumed left by a crashed writer and broken. Waits up to LOCK_WAIT_MS, then gives up.
 */
export function withFileLock<T>(full: string, fn: () => T): T {
  const lock = sideFile(full, 'lock')
  mkdirSync(dirname(full), { recursive: true })
  const deadline = Date.now() + LOCK_WAIT_MS
  for (;;) {
    try {
      const fd = openSync(lock, 'wx')
      try { writeSync(fd, String(process.pid)) }
      finally { closeSync(fd) }
      break
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) {
          rmSync(lock, { force: true })
          continue
        }
      }
      catch { continue } // released between our open and stat
      if (Date.now() > deadline) throw new WriteBusyError(`${basename(full)} is being written by another process; try again`)
      sleepSync(LOCK_POLL_MS)
    }
  }
  try {
    return fn()
  }
  finally {
    try { unlinkSync(lock) }
    catch {}
  }
}

/** Frontmatter after applying an update: undefined leaves a key, null deletes it, anything else sets it. */
function mergeFields(data: Record<string, unknown>, fields: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...data }
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue
    if (v === null) { delete merged[k]; continue }
    merged[k] = v
  }
  return merged
}

const today = () => new Date().toISOString().split('T')[0]

// ── Writer ──────────────────────────────────────────────────────────────────

export function createWriter(contentRoot: string, opts: WriterOptions = {}) {
  const root = resolve(contentRoot)
  const limits = opts.limits ?? {}
  const path = (...parts: string[]) => join(root, ...parts)

  function read(rel: string) {
    const full = path(rel)
    if (!existsSync(full)) return null
    const file = matter(readFileSync(full, 'utf-8'))
    return { data: { ...file.data } as Record<string, unknown>, content: file.content }
  }

  function write(rel: string, frontmatter: Record<string, unknown>, body = '') {
    atomicWrite(path(rel), renderMarkdown(frontmatter, body))
  }

  /** Locked read-modify-write of one existing file; `notFound` is thrown when it is missing. */
  function modify<T>(rel: string, notFound: string, fn: (file: { data: Record<string, unknown>; content: string }) => { data: Record<string, unknown>; body: string; result: T } | null): T | undefined {
    const full = path(rel)
    return withFileLock(full, () => {
      const file = read(rel)
      if (!file) throw new NotFoundError(notFound)
      const next = fn(file)
      if (!next) return undefined
      write(rel, next.data, next.body)
      return next.result
    })
  }

  /** Create `<dir>/<slug>.md` under the first free slug from `base`, retrying if another writer takes it first. */
  function createUnique(dir: string[], base: string, frontmatter: Record<string, unknown>, body: string) {
    const taken = new Set<string>()
    for (;;) {
      const slug = uniqueSlug(base, s => taken.has(s) || existsSync(path(...dir, `${s}.md`)))
      if (createExclusive(path(...dir, `${slug}.md`), renderMarkdown(frontmatter, body))) return slug
      taken.add(slug)
    }
  }

  const mdCount = (...dir: string[]) => {
    const full = path(...dir)
    return existsSync(full) ? readdirSync(full).filter(f => f.endsWith('.md')).length : 0
  }

  // ── Tasks ──

  function createTask(input: unknown) {
    const body = parseInput(TaskCreate, input)
    assertSafeSlug(body.project)
    if (!existsSync(path('projects', body.project))) throw new NotFoundError('Project not found')

    const project = read(`projects/${body.project}/index.md`)
    const defaultStatus = (project?.data.defaultStatus as string | undefined) ?? 'todo'
    const defaultPriority = (project?.data.defaultPriority as string | undefined) ?? 'medium'
    const defaultAssignee = (project?.data.defaultAssignee as string | undefined) ?? null

    const taskCount = mdCount('projects', body.project, 'tasks')
    if (limits.tasksPerProject !== undefined && taskCount >= limits.tasksPerProject) {
      throw new LimitError(`Demo limit reached: max ${limits.tasksPerProject} tasks per project.`)
    }

    // An explicit slug (async creates pass the slug they predicted) is still made unique, so it can't overwrite a task.
    if (body.slug) assertSafeSlug(body.slug)
    const base = body.slug || slugify(body.title)
    if (!base) throw new ValidationError('Title produces an empty slug')

    const status = body.status ?? defaultStatus
    const frontmatter: Record<string, unknown> = {
      title: body.title.trim(),
      status,
      priority: body.priority ?? defaultPriority,
      tags: body.tags ?? [],
      assignees: body.assignees ?? (defaultAssignee ? [defaultAssignee] : []),
      ...(body.due ? { due: body.due } : {}),
      dependencies: body.dependencies ?? [],
      createdAt: today(),
      order: taskCount,
    }
    const text = body.note?.trim() ? appendNoteToBody(body.description ?? '', body.note, body.noteAuthor) : (body.description ?? '')
    const slug = createUnique(['projects', body.project, 'tasks'], base, frontmatter, text)
    return { slug, id: `${body.project}/${slug}`, status }
  }

  function updateTask(project: string, slug: string, input: unknown) {
    assertSafeSlug(project, slug)
    const body = parseInput(TaskUpdate, input)
    return modify(`projects/${project}/tasks/${slug}.md`, 'Task not found', (file) => {
      const { description, note, noteAuthor, ...fields } = body
      const status = body.status ?? (file.data.status as string)
      const nowDate = new Date()
      const now = nowDate.toISOString()
      const data = mergeFields(file.data, fields)
      data.updatedAt = now
      if (status === 'done' && !file.data.completedAt) data.completedAt = now
      else if (status !== 'done') delete data.completedAt
      let text = description !== undefined ? String(description) : file.content
      if (note?.trim()) text = appendNoteToBody(text, note, noteAuthor, nowDate)
      return { data, body: text, result: { ok: true as const, id: `${project}/${slug}`, status } }
    })!
  }

  function deleteTask(project: string, slug: string) {
    assertSafeSlug(project, slug)
    rmSync(path('projects', project, 'tasks', `${slug}.md`), { force: true })
    return { ok: true }
  }

  /** Board order: each status column's slugs, top to bottom. Each file is locked on its own (per-file atomicity). */
  function reorderTasks(project: string, order: Record<string, string[]>) {
    assertSafeSlug(project)
    for (const slugs of Object.values(order)) {
      if (!Array.isArray(slugs)) throw new ValidationError('order must map statuses to slug arrays')
      assertSafeSlug(...slugs)
    }
    for (const slugs of Object.values(order)) {
      slugs.forEach((slug, i) => {
        const rel = `projects/${project}/tasks/${slug}.md`
        if (!existsSync(path(rel))) return
        try {
          modify(rel, 'Task not found', file => ({ data: { ...file.data, order: i }, body: file.content, result: undefined }))
        }
        catch (err) {
          if (!(err instanceof NotFoundError)) throw err
        }
      })
    }
    return { ok: true }
  }

  // Several task writes, applied in order; a failing item is reported and does not stop the rest.
  function batchTasks(ops: unknown): BatchWriteResult {
    if (!Array.isArray(ops) || !ops.length) throw new ValidationError('ops must be a non-empty array')
    if (ops.length > MAX_BATCH_OPS) throw new ValidationError(`At most ${MAX_BATCH_OPS} ops per batch`)
    const results = (ops as BatchWriteOp[]).map((item, index) => {
      try {
        if (item.op === 'create') {
          const { op: _, ...input } = item
          const r = createTask(input)
          return { index, ok: true, id: r.id, status: r.status }
        }
        if (item.op === 'update' || item.op === 'note') {
          const { op, project, slug, ...fields } = item
          if (!project || !slug) throw new ValidationError(`${op} needs project and slug`)
          if (op === 'note' && !(item as { note?: string }).note?.trim()) throw new ValidationError('note is empty')
          const r = updateTask(project, slug, fields)
          return { index, ok: true, id: r.id, status: r.status }
        }
        throw new ValidationError(`Unknown op: ${String(item.op)}`)
      }
      catch (err) {
        return { index, ok: false, error: (err as Error).message }
      }
    })
    const failed = results.filter(r => !r.ok).length
    return { ok: results.length - failed, failed, results }
  }

  // ── Projects ──

  function createProject(input: unknown) {
    const body = parseInput(ProjectCreate, input)
    const projectsDir = path('projects')
    const projectCount = existsSync(projectsDir)
      ? readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length
      : 0
    if (limits.projects !== undefined && projectCount >= limits.projects) {
      throw new LimitError(`Demo limit reached: max ${limits.projects} projects allowed.`)
    }
    const base = slugify(body.title)
    if (!base) throw new ValidationError('Title produces an empty slug')
    const frontmatter: Record<string, unknown> = {
      title: body.title.trim(),
      status: body.status ?? 'active',
      ...(body.icon ? { icon: body.icon } : {}),
      ...(body.description ? { description: body.description } : {}),
      tags: body.tags ?? [],
      ...(body.repo ? { repo: body.repo } : {}),
      pinnedOrder: projectCount,
      availableStatuses: body.availableStatuses ?? ['todo', 'in-progress', 'done'],
      ...(body.defaultStatus ? { defaultStatus: body.defaultStatus } : {}),
      ...(body.defaultPriority ? { defaultPriority: body.defaultPriority } : {}),
      ...(body.defaultAssignee ? { defaultAssignee: body.defaultAssignee } : {}),
      createdAt: today(),
    }
    // A project is a directory; claim it by its index.md, so two creators racing for one name get two projects.
    const taken = new Set<string>()
    for (;;) {
      const slug = uniqueSlug(base, s => taken.has(s) || existsSync(path('projects', s)))
      if (createExclusive(path('projects', slug, 'index.md'), renderMarkdown(frontmatter))) return { slug }
      taken.add(slug)
    }
  }

  function updateProject(slug: string, input: unknown) {
    assertSafeSlug(slug)
    const body = parseInput(ProjectUpdate, input)
    modify(`projects/${slug}/index.md`, 'Project not found', file => ({
      data: { ...mergeFields(file.data, body), updatedAt: new Date().toISOString() },
      body: file.content,
      result: undefined,
    }))
    return { ok: true }
  }

  function deleteProject(slug: string) {
    assertSafeSlug(slug)
    rmSync(path('projects', slug), { recursive: true, force: true })
    return { ok: true }
  }

  /** Sidebar order: pinned projects first, then the rest; `pinnedOrder` is the index within each list. */
  function reorderProjects(pinned: unknown, unpinned: unknown) {
    if (!Array.isArray(pinned) || !Array.isArray(unpinned)) throw new ValidationError('pinned and unpinned must be slug arrays')
    const apply = (slugs: string[], isPinned: boolean) => slugs.forEach((slug, i) => {
      assertSafeSlug(slug)
      const rel = `projects/${slug}/index.md`
      if (!existsSync(path(rel))) return
      try {
        modify(rel, 'Project not found', (file) => {
          const { pinned: _pin, ...rest } = file.data
          const data = isPinned ? { ...file.data, pinned: true, pinnedOrder: i } : { ...rest, pinnedOrder: i }
          return { data, body: file.content, result: undefined }
        })
      }
      catch (err) {
        if (!(err instanceof NotFoundError)) throw err
      }
    })
    apply(pinned as string[], true)
    apply(unpinned as string[], false)
    return { ok: true }
  }

  // ── Docs (project docs, or standalone when project is null) ──

  const docsDir = (project: string | null | undefined) => project ? ['projects', project, 'docs'] : ['docs']
  const docRel = (project: string | null | undefined, slug: string) => [...docsDir(project), `${slug}.md`].join('/')

  function createDoc(project: string | null | undefined, input: DocCreateInput) {
    if (project) assertSafeSlug(project)
    if (!input?.title?.trim()) throw new ValidationError('Title is required')
    if (project && !existsSync(path('projects', project))) throw new NotFoundError('Project not found')

    const docCount = mdCount(...docsDir(project))
    const cap = project ? limits.docsPerProject : limits.standaloneDocs
    if (cap !== undefined && docCount >= cap) {
      throw new LimitError(project ? `Demo limit reached: max ${cap} docs per project.` : `Demo limit reached: max ${cap} standalone docs.`)
    }

    if (input.slug) assertSafeSlug(input.slug)
    const base = input.slug || slugify(input.title)
    if (!base) throw new ValidationError('Title produces an empty slug')

    if (!project && input.parent) {
      assertSafeSlug(input.parent)
      if (!existsSync(path('docs', `${input.parent}.md`))) throw new ValidationError(`Parent doc '${input.parent}' not found`)
    }

    const frontmatter: Record<string, unknown> = {
      title: input.title.trim(),
      tags: input.tags ?? [],
      ...(input.parent ? { parent: input.parent } : {}),
      ...(input.isFolder ? { isFolder: true } : {}),
      createdAt: today(),
    }
    const slug = createUnique(docsDir(project), base, frontmatter, input.body ?? '')
    return { slug }
  }

  function wouldCreateDocCycle(project: string | null | undefined, slug: string, newParent: string) {
    let current: string | null = newParent
    const visited = new Set<string>()
    while (current) {
      if (current === slug) return true
      if (visited.has(current)) return false
      visited.add(current)
      current = (read(docRel(project, current))?.data.parent as string | undefined) ?? null
    }
    return false
  }

  function updateDoc(project: string | null | undefined, slug: string, input: unknown) {
    if (project) assertSafeSlug(project)
    assertSafeSlug(slug)
    const body = parseInput(DocUpdate, input)
    if (!read(docRel(project, slug))) throw new NotFoundError('Doc not found')

    if (body.parent !== undefined && body.parent !== null) {
      assertSafeSlug(body.parent)
      if (!existsSync(path(docRel(project, body.parent)))) {
        throw new ValidationError(project ? `Parent doc '${body.parent}' not found in this project` : `Parent doc '${body.parent}' not found`)
      }
      if (wouldCreateDocCycle(project, slug, body.parent)) throw new ValidationError('Setting this parent would create a cycle')
    }

    modify(docRel(project, slug), 'Doc not found', (file) => {
      const { body: text, ...fields } = body
      const data = mergeFields(file.data, fields)
      data.updatedAt = new Date().toISOString()
      return { data, body: text !== undefined ? String(text) : file.content, result: undefined }
    })
    return { ok: true }
  }

  function deleteDoc(project: string | null | undefined, slug: string) {
    if (project) assertSafeSlug(project)
    assertSafeSlug(slug)
    const full = path(docRel(project, slug))
    // Standalone docs answer 404 for a missing doc; project docs never did (kept as is).
    if (!project && !existsSync(full)) throw new NotFoundError('Doc not found')
    rmSync(full, { force: true })
    return { ok: true }
  }

  /** Create or replace a doc by slug: an existing slug is updated in place, otherwise a doc is created. */
  function upsertDoc(project: string | null | undefined, input: { slug?: string; title: string; body: string; tags?: string[]; parent?: string }) {
    const { slug, title, body, tags, parent } = input
    if (slug) assertSafeSlug(slug)
    if (slug && existsSync(path(docRel(project, slug)))) {
      const result = updateDoc(project, slug, { title, body, tags, parent })
      return { ...result, slug }
    }
    return createDoc(project, { title, body, tags, parent, slug })
  }

  return {
    root,
    createTask,
    updateTask,
    deleteTask,
    reorderTasks,
    batchTasks,
    createProject,
    updateProject,
    deleteProject,
    reorderProjects,
    createDoc,
    updateDoc,
    deleteDoc,
    upsertDoc,
  }
}

export type Writer = ReturnType<typeof createWriter>
