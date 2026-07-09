import { existsSync, readdirSync } from 'node:fs'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const projectFilter = query.project as string | undefined

  const projectsDir = contentPath('projects')
  if (!existsSync(projectsDir)) return []

  const projectSlugs = projectFilter
    ? [projectFilter]
    : readdirSync(projectsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name !== '.gitkeep')
        .map(e => e.name)

  const projectRepos = new Map<string, string | null>()
  const results = []
  for (const projectSlug of projectSlugs) {
    const tasksDir = contentPath('projects', projectSlug, 'tasks')
    if (!existsSync(tasksDir)) continue
    if (!projectRepos.has(projectSlug)) {
      const pf = readMarkdown(`projects/${projectSlug}/index.md`)
      projectRepos.set(projectSlug, (pf?.data?.githubRepo as string | undefined) ?? null)
    }
    const githubRepo = projectRepos.get(projectSlug) ?? null
    for (const f of readdirSync(tasksDir).filter(f => f.endsWith('.md'))) {
      const slug = f.replace('.md', '')
      const file = readMarkdown(`projects/${projectSlug}/tasks/${slug}.md`)
      if (!file) continue
      results.push({
        slug,
        path: `/projects/${projectSlug}/tasks/${slug}`,
        project: projectSlug,
        title: (file.data.title as string) ?? slug,
        status: (file.data.status as string) ?? 'todo',
        priority: (file.data.priority as string) ?? 'medium',
        tags: (file.data.tags as string[]) ?? [],
        assignees: (file.data.assignees as string[]) ?? [],
        dependencies: Array.isArray(file.data.dependencies) ? (file.data.dependencies as string[]) : [],
        due: (file.data.due as string | undefined) ?? undefined,
        githubIssues: (file.data.githubIssues as number[]) ?? [],
        githubPRs: (file.data.githubPRs as number[]) ?? [],
        githubRepo,
        createdAt: (file.data.createdAt as string) ?? '',
        updatedAt: (file.data.updatedAt as string | undefined) ?? undefined,
        archivedAt: (file.data.archivedAt as string | undefined) ?? undefined,
        order: (file.data.order as number) ?? 0,
      })
    }
  }
  return results
})
