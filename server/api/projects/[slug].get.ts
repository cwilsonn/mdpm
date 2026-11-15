import { repoOf } from '../../../lib/core/read'
import { TASK_STATUSES } from '../../../lib/core/schema'

export default defineEventHandler((event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
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
    availableStatuses: (file.data.availableStatuses as string[] | undefined) ?? [...TASK_STATUSES],
    defaultStatus: (file.data.defaultStatus as string | undefined) ?? undefined,
    defaultPriority: (file.data.defaultPriority as string | undefined) ?? undefined,
    repo: repoOf(file.data) ?? undefined,
    archivedAt: (file.data.archivedAt as string | undefined) ?? undefined,
  }
})
