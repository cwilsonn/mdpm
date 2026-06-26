import { existsSync, readdirSync } from 'node:fs'

const SESSION_NOTES_RE = /-session-notes$/

export default defineEventHandler((event) => {
  const { q } = getQuery(event)
  if (!q || typeof q !== 'string' || !q.trim()) return []

  const query = q.trim().toLowerCase()
  const results: { slug: string; project: string | null; title: string; excerpt: string }[] = []

  function matchDoc(slug: string, project: string | null, filePath: string) {
    if (SESSION_NOTES_RE.test(slug)) return
    const file = readMarkdown(filePath)
    if (!file) return

    const title = (file.data.title as string) ?? slug
    const content = file.content
    const titleHit = title.toLowerCase().includes(query)
    const contentIdx = content.toLowerCase().indexOf(query)

    if (!titleHit && contentIdx === -1) return

    let excerpt: string
    if (contentIdx !== -1) {
      const start = Math.max(0, contentIdx - 80)
      const end = Math.min(content.length, contentIdx + query.length + 120)
      const raw = content.slice(start, end).replace(/[#*`_[\]]/g, '').trim()
      excerpt = (start > 0 ? '…' : '') + raw + (end < content.length ? '…' : '')
    }
    else {
      excerpt = content.slice(0, 200).replace(/[#*`_[\]]/g, '').trim()
    }

    results.push({ slug, project, title, excerpt })
  }

  const projectsDir = contentPath('projects')
  if (existsSync(projectsDir)) {
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const projectSlug = entry.name
      const docsDir = contentPath('projects', projectSlug, 'docs')
      if (!existsSync(docsDir)) continue
      for (const f of readdirSync(docsDir).filter(f => f.endsWith('.md'))) {
        const slug = f.replace('.md', '')
        matchDoc(slug, projectSlug, `projects/${projectSlug}/docs/${slug}.md`)
      }
    }
  }

  const docsDir = contentPath('docs')
  if (existsSync(docsDir)) {
    for (const f of readdirSync(docsDir).filter(f => f.endsWith('.md'))) {
      const slug = f.replace('.md', '')
      matchDoc(slug, null, `docs/${slug}.md`)
    }
  }

  return results
})
