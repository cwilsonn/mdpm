export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(project, slug)

  const file = readMarkdown(`projects/${project}/tasks/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Task not found' })

  return {
    slug,
    path: `/projects/${project}/tasks/${slug}`,
    project,
    title: (file.data.title as string) ?? slug,
    status: (file.data.status as string) ?? 'todo',
    priority: (file.data.priority as string) ?? 'medium',
    tags: (file.data.tags as string[]) ?? [],
    assignees: (file.data.assignees as string[]) ?? [],
    dependencies: (file.data.dependencies as string[]) ?? [],
    due: (file.data.due as string | undefined) ?? undefined,
    createdAt: (file.data.createdAt as string) ?? '',
    // null, not undefined: JSON drops undefined, and an editor needs the value to send back as expectedUpdatedAt.
    updatedAt: file.data.updatedAt instanceof Date ? file.data.updatedAt.toISOString() : (file.data.updatedAt as string | undefined) ?? null,
    completedAt: (file.data.completedAt as string | undefined) ?? undefined,
    order: (file.data.order as number) ?? 0,
    body: file.content,
  }
})
