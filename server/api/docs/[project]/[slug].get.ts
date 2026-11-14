export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(project, slug)
  const file = readMarkdown(`projects/${project}/docs/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Doc not found' })
  return {
    slug,
    project,
    title: (file.data.title as string) ?? slug,
    tags: (file.data.tags as string[]) ?? [],
    parent: (file.data.parent as string | undefined) ?? null,
    createdAt: (file.data.createdAt as string) ?? '',
    updatedAt: (file.data.updatedAt as string) ?? undefined,
    archivedAt: (file.data.archivedAt as string | undefined) ?? undefined,
    body: file.content,
  }
})
