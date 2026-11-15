import { existsSync, readdirSync } from 'node:fs'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const projectFilter = query.project as string | undefined
  if (projectFilter) assertSafeSlug(projectFilter)
  const standaloneOnly = query.standalone === 'true'

  const results: {
    slug: string
    project: string | null
    title: string
    tags: string[]
    createdAt: string
    updatedAt?: string
    archivedAt?: string
    excerpt: string
  }[] = []

  // project docs
  if (!standaloneOnly) {
    const projectsDir = contentPath('projects')
    if (existsSync(projectsDir)) {
      const projectSlugs = projectFilter
        ? [projectFilter]
        : readdirSync(projectsDir, { withFileTypes: true })
            .filter(e => e.isDirectory())
            .map(e => e.name)

      for (const projectSlug of projectSlugs) {
        const docsDir = contentPath('projects', projectSlug, 'docs')
        if (!existsSync(docsDir)) continue
        for (const f of readdirSync(docsDir).filter(f => f.endsWith('.md'))) {
          const slug = f.replace('.md', '')
          const file = readMarkdown(`projects/${projectSlug}/docs/${slug}.md`)
          if (!file) continue
          results.push({
            slug,
            project: projectSlug,
            title: (file.data.title as string) ?? slug,
            tags: (file.data.tags as string[]) ?? [],
            createdAt: (file.data.createdAt as string) ?? '',
            updatedAt: (file.data.updatedAt as string) ?? undefined,
            archivedAt: (file.data.archivedAt as string) ?? undefined,
            excerpt: file.content.slice(0, 200).replace(/[#*`_]/g, '').trim(),
          })
        }
      }
    }
  }

  // standalone docs (only when no project filter)
  if (!projectFilter) {
    const docsDir = contentPath('docs')
    if (existsSync(docsDir)) {
      for (const f of readdirSync(docsDir).filter(f => f.endsWith('.md'))) {
        const slug = f.replace('.md', '')
        const file = readMarkdown(`docs/${slug}.md`)
        if (!file) continue
        results.push({
          slug,
          project: null,
          title: (file.data.title as string) ?? slug,
          tags: (file.data.tags as string[]) ?? [],
          createdAt: (file.data.createdAt as string) ?? '',
          updatedAt: (file.data.updatedAt as string) ?? undefined,
          excerpt: file.content.slice(0, 200).replace(/[#*`_]/g, '').trim(),
        })
      }
    }
  }

  // sort within each project group by createdAt desc (newest first)
  results.sort((a, b) => {
    const pCmp = String(a.project ?? '').localeCompare(String(b.project ?? ''))
    if (pCmp !== 0) return pCmp
    return b.createdAt.localeCompare(a.createdAt)
  })

  return results
})
