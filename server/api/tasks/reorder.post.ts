export default defineEventHandler(async (event) => {
  const { project, order } = await readBody<{
    project: string
    order: Record<string, string[]>
  }>(event)

  if (!project) throw createError({ statusCode: 400, message: 'project required' })
  if (!order || typeof order !== 'object') throw createError({ statusCode: 400, message: 'order must map statuses to slug arrays' })
  // Every segment that becomes part of a path is checked before anything is written.
  assertSafeSlug(project)
  for (const slugs of Object.values(order)) {
    if (!Array.isArray(slugs)) throw createError({ statusCode: 400, message: 'order must map statuses to slug arrays' })
    assertSafeSlug(...slugs)
  }

  for (const slugs of Object.values(order)) {
    for (let i = 0; i < slugs.length; i++) {
      const file = readMarkdown(`projects/${project}/tasks/${slugs[i]}.md`)
      if (!file) continue
      writeMarkdown(`projects/${project}/tasks/${slugs[i]}.md`, { ...file.data, order: i }, file.content)
    }
  }

  return { ok: true }
})
