export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(project, slug)
  const body = await readBody<{ title?: string; tags?: string[]; body?: string }>(event)

  const file = readMarkdown(`projects/${project}/docs/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Doc not found' })

  const { body: newBody, ...frontmatterFields } = body
  const updated = {
    ...file.data,
    ...Object.fromEntries(
      Object.entries(frontmatterFields).filter(([, v]) => v !== undefined),
    ),
    updatedAt: new Date().toISOString(),
  }

  writeMarkdown(`projects/${project}/docs/${slug}.md`, updated, newBody !== undefined ? String(newBody) : file.content)
  return { ok: true }
})
