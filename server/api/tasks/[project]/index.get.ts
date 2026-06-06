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
        path: `/projects/${project}/tasks/${slug}`,
        project,
        title: (file?.data?.title as string) ?? slug,
        status: (file?.data?.status as string) ?? 'todo',
        priority: (file?.data?.priority as string) ?? 'medium',
        tags: (file?.data?.tags as string[]) ?? [],
        assignees: (file?.data?.assignees as string[]) ?? [],
        dependencies: (file?.data?.dependencies as string[]) ?? [],
        due: (file?.data?.due as string | undefined) ?? undefined,
        createdAt: (file?.data?.createdAt as string) ?? '',
        updatedAt: (file?.data?.updatedAt as string | undefined) ?? undefined,
        order: (file?.data?.order as number) ?? 0,
      }
    })
    .sort((a, b) => a.order - b.order)
})
