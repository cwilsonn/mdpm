export default defineEventHandler(async (event) => {
  const body = await readBody<{ pinned: string[], unpinned: string[] }>(event)
  if (!Array.isArray(body.pinned) || !Array.isArray(body.unpinned)) {
    throw createError({ statusCode: 400, message: 'pinned and unpinned must be slug arrays' })
  }

  for (let i = 0; i < body.pinned.length; i++) {
    const slug = body.pinned[i]!
    assertSafeSlug(slug)
    const file = readMarkdown(`projects/${slug}/index.md`)
    if (!file) continue
    writeMarkdown(`projects/${slug}/index.md`, { ...file.data, pinned: true, pinnedOrder: i }, file.content)
  }

  for (let i = 0; i < body.unpinned.length; i++) {
    const slug = body.unpinned[i]!
    assertSafeSlug(slug)
    const file = readMarkdown(`projects/${slug}/index.md`)
    if (!file) continue
    const { pinned: _pin, ...rest } = file.data as Record<string, unknown>
    writeMarkdown(`projects/${slug}/index.md`, { ...rest, pinnedOrder: i }, file.content)
  }

  return { ok: true }
})
