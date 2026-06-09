
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
  const body = await readBody<{
    title?: string
    status?: string
    icon?: string | null
    description?: string
    tags?: string[]
    availableStatuses?: string[]
    defaultStatus?: string | null
    defaultPriority?: string | null
    defaultAssignee?: string | null
    pinned?: boolean | null
    pinnedOrder?: number | null
  }>(event)

  const file = readMarkdown(`projects/${slug}/index.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Project not found' })

  const merged: Record<string, unknown> = { ...file.data }
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue
    if (v === null) { delete merged[k]; continue }
    merged[k] = v
  }

  writeMarkdown(`projects/${slug}/index.md`, { ...merged, updatedAt: new Date().toISOString() }, file.content)
  return { ok: true }
})
