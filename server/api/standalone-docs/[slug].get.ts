export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
  const file = readMarkdown(`docs/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Doc not found' })
  return {
    slug,
    project: null as null,
    title: (file.data.title as string) ?? slug,
    tags: (file.data.tags as string[]) ?? [],
    parent: (file.data.parent as string | undefined) ?? null,
    createdAt: (file.data.createdAt as string) ?? '',
    updatedAt: (file.data.updatedAt as string | undefined) ?? undefined,
    archivedAt: (file.data.archivedAt as string | undefined) ?? undefined,
    links: Array.isArray(file.data.links) ? file.data.links : [],
    body: file.content,
  }
})
