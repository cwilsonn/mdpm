export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
  const file = readMarkdown(`docs/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Doc not found' })
  deleteContent(`docs/${slug}.md`)
  return { ok: true }
})
