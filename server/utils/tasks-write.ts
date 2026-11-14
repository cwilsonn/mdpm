import { existsSync, readdirSync } from 'node:fs'
import { appendNoteToBody } from '../../lib/core/log'
import { projectRepoOf } from '../../lib/core/links-compat'
import { isDemo } from './demo'
import { applyLinkWrite } from './links-write'
import { assertSafeSlug, contentPath, readMarkdown, slugify, uniqueSlug, writeMarkdown } from './content'

// Task create/update, shared by the single routes and the batch route so they cannot drift apart.
// Each returns what a caller needs to carry on (id and status), not the task: write responses are tokens too.

const TASK_LIMIT_PER_PROJECT = 20

export interface TaskCreateInput {
  project: string
  title: string
  slug?: string
  status?: string
  priority?: string
  tags?: string[]
  assignees?: string[]
  due?: string
  dependencies?: string[]
  githubIssues?: number[]
  githubPRs?: number[]
  links?: unknown
  description?: string
  /** A first note appended after the description. */
  note?: string
  noteAuthor?: string
}

export interface TaskUpdateInput {
  title?: string
  status?: string
  priority?: string
  tags?: string[]
  assignees?: string[]
  due?: string | null
  dependencies?: string[]
  githubIssues?: number[]
  githubPRs?: number[]
  links?: unknown
  description?: string
  order?: number
  archivedAt?: string | null
  /** Appended to the body as a timestamped note, on the server, so concurrent writers cannot lose each other's. */
  note?: string
  noteAuthor?: string
}

export function createTaskFile(body: TaskCreateInput) {
  if (!body.project) throw createError({ statusCode: 400, message: 'Project is required' })
  assertSafeSlug(body.project)
  if (!body.title?.trim()) throw createError({ statusCode: 400, message: 'Title is required' })
  if (!existsSync(contentPath('projects', body.project))) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }

  const projectFile = readMarkdown(`projects/${body.project}/index.md`)
  const projectDefaultStatus = (projectFile?.data?.defaultStatus as string | undefined) ?? 'todo'
  const projectDefaultPriority = (projectFile?.data?.defaultPriority as string | undefined) ?? 'medium'
  const projectDefaultAssignee = (projectFile?.data?.defaultAssignee as string | undefined) ?? null

  const tasksDir = contentPath('projects', body.project, 'tasks')
  const taskCount = existsSync(tasksDir) ? readdirSync(tasksDir).filter(f => f.endsWith('.md')).length : 0
  if (isDemo() && taskCount >= TASK_LIMIT_PER_PROJECT) {
    throw createError({ statusCode: 429, message: `Demo limit reached: max ${TASK_LIMIT_PER_PROJECT} tasks per project.` })
  }

  // An explicit slug (used by import to keep slugs stable) still goes through uniqueSlug, so it can't overwrite a task.
  if (body.slug) assertSafeSlug(body.slug)
  const base = body.slug || slugify(body.title)
  if (!base) throw createError({ statusCode: 400, message: 'Title produces an empty slug' })
  const slug = uniqueSlug(base, s => existsSync(contentPath('projects', body.project, 'tasks', `${s}.md`)))

  const status = body.status ?? projectDefaultStatus
  const frontmatter: Record<string, unknown> = {
    title: body.title.trim(),
    status,
    priority: body.priority ?? projectDefaultPriority,
    tags: body.tags ?? [],
    assignees: body.assignees ?? (projectDefaultAssignee ? [projectDefaultAssignee] : []),
    ...(body.due ? { due: body.due } : {}),
    dependencies: body.dependencies ?? [],
    createdAt: new Date().toISOString().split('T')[0],
    order: taskCount,
  }
  const notices = applyLinkWrite('task', frontmatter, body as unknown as Record<string, unknown>, projectFile ? projectRepoOf(projectFile.data) : null)
  const description = body.note?.trim() ? appendNoteToBody(body.description ?? '', body.note, body.noteAuthor) : (body.description ?? '')
  writeMarkdown(`projects/${body.project}/tasks/${slug}.md`, frontmatter, description)
  return { slug, id: `${body.project}/${slug}`, status, notices }
}

export function updateTaskFile(project: string, slug: string, body: TaskUpdateInput) {
  assertSafeSlug(project, slug)
  const file = readMarkdown(`projects/${project}/tasks/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Task not found' })

  const { description, note, noteAuthor, links: _links, githubIssues: _issues, githubPRs: _prs, ...frontmatterFields } = body
  const newStatus = body.status ?? (file.data.status as string)
  const nowDate = new Date()
  const now = nowDate.toISOString()

  const updated: Record<string, unknown> = { ...file.data }
  for (const [k, v] of Object.entries(frontmatterFields)) {
    if (v === undefined) continue
    if (v === null) { delete updated[k]; continue }
    updated[k] = v
  }
  const projectFile = readMarkdown(`projects/${project}/index.md`)
  const notices = applyLinkWrite('task', updated, body as unknown as Record<string, unknown>, projectFile ? projectRepoOf(projectFile.data) : null)
  updated.updatedAt = now

  if (newStatus === 'done' && !file.data.completedAt) updated.completedAt = now
  else if (newStatus !== 'done') delete updated.completedAt

  let newBody = description !== undefined ? String(description) : file.content
  if (note?.trim()) newBody = appendNoteToBody(newBody, note, noteAuthor, nowDate)
  writeMarkdown(`projects/${project}/tasks/${slug}.md`, updated, newBody)
  return { id: `${project}/${slug}`, status: newStatus, notices }
}
