import { projectRepoOf } from '../../../../lib/core/links-compat'

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(project, slug)
  const body = await readBody<{
    title?: string
    status?: string
    priority?: string
    tags?: string[]
    assignees?: string[]
    due?: string
    dependencies?: string[]
    githubIssues?: number[]
    githubPRs?: number[]
    links?: unknown
    description?: string
    order?: number
    archivedAt?: string | null
  }>(event)

  const file = readMarkdown(`projects/${project}/tasks/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Task not found' })

  const { description, links: _links, githubIssues: _issues, githubPRs: _prs, ...frontmatterFields } = body

  const newStatus = body.status ?? (file.data.status as string)
  const now = new Date().toISOString()

  const updated: Record<string, unknown> = { ...file.data }
  for (const [k, v] of Object.entries(frontmatterFields)) {
    if (v === undefined) continue
    if (v === null) { delete updated[k]; continue }
    updated[k] = v
  }
  const projectFile = readMarkdown(`projects/${project}/index.md`)
  const notices = applyLinkWrite('task', updated, body as Record<string, unknown>, projectFile ? projectRepoOf(projectFile.data) : null)
  updated.updatedAt = now

  if (newStatus === 'done' && !file.data.completedAt) {
    updated.completedAt = now
  }
  else if (newStatus !== 'done') {
    delete updated.completedAt
  }

  const newBody = description !== undefined ? String(description) : file.content
  writeMarkdown(`projects/${project}/tasks/${slug}.md`, updated, newBody)
  return { ok: true, ...(notices.length ? { notices } : {}) }
})
