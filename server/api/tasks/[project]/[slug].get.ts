import { githubView, projectRepoOf } from '../../../../lib/core/links-compat'
export default defineEventHandler((event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(project, slug)

  const file = readMarkdown(`projects/${project}/tasks/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Task not found' })

  const projectFile = readMarkdown(`projects/${project}/index.md`)
  const githubRepo = projectFile ? projectRepoOf(projectFile.data) : null
  const gh = githubView(file.data, githubRepo)

  return {
    slug,
    path: `/projects/${project}/tasks/${slug}`,
    project,
    title: (file.data.title as string) ?? slug,
    status: (file.data.status as string) ?? 'todo',
    priority: (file.data.priority as string) ?? 'medium',
    tags: (file.data.tags as string[]) ?? [],
    assignees: (file.data.assignees as string[]) ?? [],
    dependencies: (file.data.dependencies as string[]) ?? [],
    due: (file.data.due as string | undefined) ?? undefined,
    githubIssues: gh.githubIssues,
    githubPRs: gh.githubPRs,
    links: Array.isArray(file.data.links) ? file.data.links : [],
    githubRepo,
    createdAt: (file.data.createdAt as string) ?? '',
    updatedAt: (file.data.updatedAt as string | undefined) ?? undefined,
    completedAt: (file.data.completedAt as string | undefined) ?? undefined,
    order: (file.data.order as number) ?? 0,
    body: file.content,
  }
})
