import { existsSync, readdirSync, readFileSync } from 'node:fs'
import matter from 'gray-matter'
import { contentPathOf, type CoreConfig } from './config'
import { githubView, projectRepoOf } from './links-compat'

// YAML parses an unquoted `2026-07-01` into a Date. The API writes quoted strings, but hand-edited
// files won't, so normalize: date-only values become YYYY-MM-DD, anything with a time stays ISO.
function dateString(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  if (value instanceof Date) {
    const iso = value.toISOString()
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso
  }
  return String(value)
}

const linksOf = (data?: Record<string, unknown>) => Array.isArray(data?.links) ? data.links as Record<string, unknown>[] : []

export type Reader = ReturnType<typeof createReader>
export type Doc = ReturnType<Reader['getDocs']>[number]

export function createReader(config: CoreConfig) {
  const contentPath = (...parts: string[]) => contentPathOf(config, ...parts)

  function readMd(relPath: string) {
    const full = contentPath(relPath)
    if (!existsSync(full)) return null
    return matter(readFileSync(full, 'utf-8'))
  }

  function listDirs(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => e.name)
  }

  function listMdFiles(dir: string): string[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir).filter(f => f.endsWith('.md'))
  }

  function getProjects() {
    const projectsDir = contentPath('projects')
    return listDirs(projectsDir).map((slug) => {
      const file = readMd(`projects/${slug}/index.md`)
      const tasksDir = contentPath('projects', slug, 'tasks')
      const taskCount = listMdFiles(tasksDir).length
      const docsDir = contentPath('projects', slug, 'docs')
      const docCount = listMdFiles(docsDir).length
      return {
        slug,
        title: (file?.data?.title as string) ?? slug,
        status: (file?.data?.status as string) ?? 'active',
        icon: (file?.data?.icon as string) ?? null,
        tags: (file?.data?.tags as string[]) ?? [],
        description: (file?.data?.description as string) ?? null,
        githubRepo: file ? projectRepoOf(file.data) : null,
        links: linksOf(file?.data),
        createdAt: dateString(file?.data?.createdAt) ?? '',
        archivedAt: dateString(file?.data?.archivedAt),
        taskCount,
        docCount,
      }
    })
  }

  function getTasks(projectSlug: string, statusFilter?: string[], githubIssueFilter?: number, githubPRFilter?: number) {
    const projectFile = readMd(`projects/${projectSlug}/index.md`)
    const githubRepo = projectFile ? projectRepoOf(projectFile.data) : null
    const tasksDir = contentPath('projects', projectSlug, 'tasks')
    return listMdFiles(tasksDir).flatMap((f) => {
      const slug = f.replace('.md', '')
      const file = readMd(`projects/${projectSlug}/tasks/${slug}.md`)
      if (!file) return []
      const status = (file.data.status as string) ?? 'todo'
      if (statusFilter?.length && !statusFilter.includes(status)) return []
      // Either storage form (legacy fields or links) reads as the same numbers.
      const { githubIssues, githubPRs } = githubView(file.data, githubRepo)
      if (githubIssueFilter !== undefined && !githubIssues.includes(githubIssueFilter)) return []
      if (githubPRFilter !== undefined && !githubPRs.includes(githubPRFilter)) return []
      return [{
        slug,
        project: projectSlug,
        title: (file.data.title as string) ?? slug,
        status,
        priority: (file.data.priority as string) ?? 'medium',
        tags: (file.data.tags as string[]) ?? [],
        assignees: (file.data.assignees as string[]) ?? [],
        due: dateString(file.data.due),
        dependencies: (file.data.dependencies as string[]) ?? [],
        githubIssues,
        githubPRs,
        githubRepo,
        links: linksOf(file.data),
        createdAt: dateString(file.data.createdAt) ?? '',
        updatedAt: dateString(file.data.updatedAt),
        archivedAt: dateString(file.data.archivedAt),
        order: (file.data.order as number) ?? 0,
        body: file.content.trim(),
      }]
    }).sort((a, b) => a.order - b.order)
  }

  function getDocs(projectSlug?: string, standaloneOnly = false) {
    const results: {
      slug: string
      project: string | null
      title: string
      tags: string[]
      parent: string | null
      createdAt: string
      updatedAt: string | null
      archivedAt: string | null
      links: Record<string, unknown>[]
      excerpt: string
      body: string
    }[] = []

    if (!standaloneOnly) {
      const projectSlugs = projectSlug ? [projectSlug] : listDirs(contentPath('projects'))
      for (const pSlug of projectSlugs) {
        const docsDir = contentPath('projects', pSlug, 'docs')
        for (const f of listMdFiles(docsDir)) {
          const slug = f.replace('.md', '')
          const file = readMd(`projects/${pSlug}/docs/${slug}.md`)
          if (!file) continue
          results.push({
            slug,
            project: pSlug,
            title: (file.data.title as string) ?? slug,
            tags: (file.data.tags as string[]) ?? [],
            parent: (file.data.parent as string | undefined) ?? null,
            createdAt: dateString(file.data.createdAt) ?? '',
            updatedAt: dateString(file.data.updatedAt),
            archivedAt: dateString(file.data.archivedAt),
            links: linksOf(file.data),
            excerpt: file.content.slice(0, 300).replace(/[#*`_]/g, '').trim(),
            body: file.content.trim(),
          })
        }
      }
    }

    if (!projectSlug) {
      const docsDir = contentPath('docs')
      for (const f of listMdFiles(docsDir)) {
        const slug = f.replace('.md', '')
        const file = readMd(`docs/${slug}.md`)
        if (!file) continue
        results.push({
          slug,
          project: null,
          title: (file.data.title as string) ?? slug,
          tags: (file.data.tags as string[]) ?? [],
          parent: (file.data.parent as string | undefined) ?? null,
          createdAt: dateString(file.data.createdAt) ?? '',
          updatedAt: dateString(file.data.updatedAt),
          archivedAt: dateString(file.data.archivedAt),
          links: linksOf(file.data),
          excerpt: file.content.slice(0, 300).replace(/[#*`_]/g, '').trim(),
          body: file.content.trim(),
        })
      }
    }

    return results
  }

  function getAllTasks(statusFilter?: string[], githubIssueFilter?: number, githubPRFilter?: number) {
    const projectsDir = contentPath('projects')
    if (!existsSync(projectsDir)) return []
    return listDirs(projectsDir).flatMap(slug => getTasks(slug, statusFilter, githubIssueFilter, githubPRFilter))
  }

  function searchTasks(query: string, projectSlug?: string, statusFilter?: string[]) {
    const q = query.toLowerCase()
    const tasks = projectSlug ? getTasks(projectSlug, statusFilter) : getAllTasks(statusFilter)
    return tasks.filter(t =>
      t.title.toLowerCase().includes(q) || t.body.toLowerCase().includes(q),
    )
  }

  function searchDocs(query: string, projectSlug?: string) {
    const q = query.toLowerCase()
    return getDocs(projectSlug).filter(
      d => d.title.toLowerCase().includes(q) || d.body.toLowerCase().includes(q),
    ).map(d => ({
      slug: d.slug,
      project: d.project,
      title: d.title,
      tags: d.tags,
      updatedAt: d.updatedAt,
      excerpt: d.body
        .split('\n')
        .find(line => line.toLowerCase().includes(q))
        ?.trim()
        .slice(0, 200) ?? d.excerpt,
    }))
  }

  return {
    contentPath,
    getProjects,
    getTasks,
    getAllTasks,
    getDocs,
    searchTasks,
    searchDocs,
  }
}
