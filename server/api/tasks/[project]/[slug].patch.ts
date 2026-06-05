
export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  const body = await readBody<{
    title?: string
    status?: string
    priority?: string
    tags?: string[]
    assignees?: string[]
    due?: string
    dependencies?: string[]
    description?: string
    order?: number
  }>(event)

  const file = readMarkdown(`projects/${project}/tasks/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Task not found' })

  const { description, ...frontmatterFields } = body

  const updated = {
    ...file.data,
    ...Object.fromEntries(
      Object.entries(frontmatterFields).filter(([, v]) => v !== undefined),
    ),
    updatedAt: new Date().toISOString(),
  }

  const newBody = description !== undefined ? String(description) : file.content
  writeMarkdown(`projects/${project}/tasks/${slug}.md`, updated, newBody)
  return { ok: true }
})
