
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
  const body = await readBody<{
    title?: string
    status?: string
    icon?: string | null
    description?: string
    tags?: string[]
  }>(event)

  const file = readMarkdown(`projects/${slug}/index.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Project not found' })

  const updated = {
    ...file.data,
    ...Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined && v !== null),
    ),
    updatedAt: new Date().toISOString(),
  }

  writeMarkdown(`projects/${slug}/index.md`, updated, file.content)
  return { ok: true }
})
