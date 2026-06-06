import { existsSync, readdirSync } from 'node:fs'

export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const docsDir = contentPath('projects', project, 'docs')
  if (!existsSync(docsDir)) return []

  return readdirSync(docsDir)
    .filter(f => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace('.md', '')
      const file = readMarkdown(`projects/${project}/docs/${slug}.md`)
      return {
        slug,
        project,
        title: (file?.data?.title as string) ?? slug,
        tags: (file?.data?.tags as string[]) ?? [],
        createdAt: (file?.data?.createdAt as string) ?? '',
        updatedAt: (file?.data?.updatedAt as string) ?? undefined,
        excerpt: file?.content?.slice(0, 200).replace(/[#*`_]/g, '').trim() ?? '',
      }
    })
    .sort((a, b) => (b.updatedAt ?? b.createdAt).localeCompare(a.updatedAt ?? a.createdAt))
})
