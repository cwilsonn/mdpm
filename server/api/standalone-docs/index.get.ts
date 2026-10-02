import { existsSync, readdirSync } from 'node:fs'

export default defineEventHandler(() => {
  const docsDir = contentPath('docs')
  if (!existsSync(docsDir)) return []

  return readdirSync(docsDir)
    .filter(f => f.endsWith('.md'))
    .flatMap((f) => {
      const slug = f.replace('.md', '')
      const file = readMarkdown(`docs/${slug}.md`)
      if (!file) return []
      return [{
        slug,
        project: null as null,
        title: (file.data.title as string) ?? slug,
        tags: (file.data.tags as string[]) ?? [],
        parent: (file.data.parent as string | undefined) ?? null,
        isFolder: (file.data.isFolder as boolean | undefined) ?? false,
        order: (file.data.order as number) ?? 0,
        createdAt: (file.data.createdAt as string) ?? '',
        updatedAt: (file.data.updatedAt as string | undefined) ?? undefined,
        archivedAt: (file.data.archivedAt as string | undefined) ?? undefined,
        links: Array.isArray(file.data.links) ? file.data.links : [],
        excerpt: file.content.slice(0, 200).replace(/[#*`_]/g, '').trim(),
      }]
    })
    .sort((a, b) => a.order - b.order || b.createdAt.localeCompare(a.createdAt))
})
