import { repoOf } from '../../../lib/core/read'
import { existsSync, readdirSync } from 'node:fs'

// `?withStats=1` adds per-project counts (tasks by status, overdue, docs) computed here, so the projects page
// does not download every task and doc just to count them. Opt-in: the sidebar and palette list projects
// on every page and should not pay for reading every task file.
function statsOf(slug: string, today: string) {
  const byStatus: Record<string, number> = {}
  let total = 0, done = 0, overdue = 0
  const tasksDir = contentPath('projects', slug, 'tasks')
  for (const f of existsSync(tasksDir) ? readdirSync(tasksDir).filter(f => f.endsWith('.md')) : []) {
    const data = readMarkdown(`projects/${slug}/tasks/${f}`)?.data ?? {}
    const status = (data.status as string | undefined) ?? 'todo'
    total++
    if (status === 'done') done++
    byStatus[status] = (byStatus[status] ?? 0) + 1
    const due = data.due instanceof Date ? data.due.toISOString().slice(0, 10) : data.due as string | undefined
    if (status !== 'done' && due && due < today) overdue++
  }
  const docsDir = contentPath('projects', slug, 'docs')
  const docs = existsSync(docsDir) ? readdirSync(docsDir).filter(f => f.endsWith('.md')).length : 0
  return { total, done, byStatus, overdue, docs }
}

export default defineEventHandler((event) => {
  const withStats = getQuery(event).withStats === '1'
  const today = new Date().toISOString().split('T')[0]!
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
        repo: repoOf(file.data) ?? undefined,
        createdAt: (file.data.createdAt as string) ?? '',
        updatedAt: (file.data.updatedAt as string | undefined) ?? undefined,
        pinned: (file.data.pinned as boolean | undefined) ?? false,
        pinnedOrder: (file.data.pinnedOrder as number | undefined) ?? Infinity,
        archivedAt: (file.data.archivedAt as string | undefined) ?? undefined,
        ...(withStats && { stats: statsOf(slug, today) }),
      }]
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      if (a.pinnedOrder !== b.pinnedOrder) return a.pinnedOrder - b.pinnedOrder
      return b.createdAt > a.createdAt ? 1 : -1
    })
})
