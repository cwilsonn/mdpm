export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  const file = readMarkdown(`projects/${project}/docs/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Doc not found' })
  return {
    slug,
    project,
    title: (file.data.title as string) ?? slug,
    tags: (file.data.tags as string[]) ?? [],
    createdAt: (file.data.createdAt as string) ?? '',
    updatedAt: (file.data.updatedAt as string) ?? undefined,
    body: file.content,
  }
})
