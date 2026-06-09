import { existsSync, readdirSync } from 'node:fs'

export default defineEventHandler(() => {
  const projectsDir = contentPath('projects')
  if (!existsSync(projectsDir)) return []

  return readdirSync(projectsDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '.gitkeep')
    .flatMap((e) => {
      const slug = e.name
      const file = readMarkdown(`projects/${slug}/index.md`)
      if (!file) return []
      return [{
        slug,
        path: `/projects/${slug}`,
        title: (file.data.title as string) ?? slug,
        status: (file.data.status as string) ?? 'active',
        icon: (file.data.icon as string | undefined) ?? undefined,
        description: (file.data.description as string | undefined) ?? undefined,
        tags: (file.data.tags as string[]) ?? [],
        createdAt: (file.data.createdAt as string) ?? '',
        updatedAt: (file.data.updatedAt as string | undefined) ?? undefined,
        pinned: (file.data.pinned as boolean | undefined) ?? false,
        pinnedOrder: (file.data.pinnedOrder as number | undefined) ?? Infinity,
      }]
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      if (a.pinnedOrder !== b.pinnedOrder) return a.pinnedOrder - b.pinnedOrder
      return b.createdAt > a.createdAt ? 1 : -1
    })
})
