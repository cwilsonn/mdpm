
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  const body = await readBody<{
    title?: string
    status?: string
    description?: string
    tags?: string[]
  }>(event)

  const file = readMarkdown(`projects/${slug}/index.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Project not found' })

  const updated = {
    ...file.data,
    ...Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    ),
    updatedAt: new Date().toISOString(),
  }

  writeMarkdown(`projects/${slug}/index.md`, updated, file.content)
  return { ok: true }
})
