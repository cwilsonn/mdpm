const ALL_TASK_STATUSES = ['todo', 'in-progress', 'in-review', 'done', 'blocked']

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')!
  const file = readMarkdown(`projects/${slug}/index.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Project not found' })

  return {
    slug,
    path: `/projects/${slug}`,
    title: (file.data.title as string) ?? slug,
    status: (file.data.status as string) ?? 'active',
    icon: (file.data.icon as string | undefined) ?? undefined,
    description: (file.data.description as string | undefined) ?? undefined,
    tags: (file.data.tags as string[]) ?? [],
    createdAt: (file.data.createdAt as string) ?? '',
    updatedAt: (file.data.updatedAt as string | undefined) ?? undefined,
    availableStatuses: (file.data.availableStatuses as string[] | undefined) ?? ALL_TASK_STATUSES,
    defaultStatus: (file.data.defaultStatus as string | undefined) ?? undefined,
    defaultPriority: (file.data.defaultPriority as string | undefined) ?? undefined,
    defaultAssignee: (file.data.defaultAssignee as string | undefined) ?? undefined,
    githubRepo: (file.data.githubRepo as string | undefined) ?? undefined,
  }
})
