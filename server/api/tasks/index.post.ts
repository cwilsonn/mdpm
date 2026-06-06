import { existsSync, readdirSync } from 'node:fs'

const TASK_LIMIT_PER_PROJECT = 20

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    project: string
    title: string
    status?: string
    priority?: string
    tags?: string[]
    assignees?: string[]
    due?: string
    dependencies?: string[]
    description?: string
  }>(event)

  if (!body.project) throw createError({ statusCode: 400, message: 'Project is required' })
  assertSafeSlug(body.project)
  if (!body.title?.trim()) throw createError({ statusCode: 400, message: 'Title is required' })

  if (!existsSync(contentPath('projects', body.project))) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }

  const tasksDir = contentPath('projects', body.project, 'tasks')
  const taskCount = existsSync(tasksDir)
    ? readdirSync(tasksDir).filter(f => f.endsWith('.md')).length
    : 0
  if (taskCount >= TASK_LIMIT_PER_PROJECT) {
    throw createError({ statusCode: 429, message: `Demo limit reached: max ${TASK_LIMIT_PER_PROJECT} tasks per project.` })
  }

  const base = slugify(body.title)
  if (!base) throw createError({ statusCode: 400, message: 'Title produces an empty slug' })

  const slug = uniqueSlug(
    base,
    s => existsSync(contentPath('projects', body.project, 'tasks', `${s}.md`)),
  )

  writeMarkdown(`projects/${body.project}/tasks/${slug}.md`, {
    title: body.title.trim(),
    status: body.status ?? 'todo',
    priority: body.priority ?? 'medium',
    tags: body.tags ?? [],
    assignees: body.assignees ?? [],
    ...(body.due ? { due: body.due } : {}),
    dependencies: body.dependencies ?? [],
    createdAt: new Date().toISOString().split('T')[0],
    order: taskCount,
  }, body.description ?? '')

  return { slug }
})
