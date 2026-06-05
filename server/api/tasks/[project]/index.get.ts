import { existsSync, readdirSync } from 'node:fs'

export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const dir = contentPath('projects', project, 'tasks')

  if (!existsSync(dir)) return []

  return readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .map((f) => {
      const slug = f.replace('.md', '')
      const file = readMarkdown(`projects/${project}/tasks/${slug}.md`)
      return {
        slug,
        title: (file?.data?.title as string) ?? slug,
        status: (file?.data?.status as string) ?? 'todo',
        order: (file?.data?.order as number) ?? 0,
      }
    })
    .sort((a, b) => a.order - b.order)
})
