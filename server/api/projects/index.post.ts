import { existsSync, readdirSync } from 'node:fs'

const PROJECT_LIMIT = 10

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    title: string
    status?: string
    icon?: string
    description?: string
    tags?: string[]
    githubRepo?: string
    links?: unknown
    availableStatuses?: string[]
    defaultStatus?: string
    defaultPriority?: string
    defaultAssignee?: string
  }>(event)

  if (!body.title?.trim()) {
    throw createError({ statusCode: 400, message: 'Title is required' })
  }

  const projectsDir = contentPath('projects')
  const projectCount = existsSync(projectsDir)
    ? readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length
    : 0
  if (process.env.NODE_ENV === 'production' && projectCount >= PROJECT_LIMIT) {
    throw createError({ statusCode: 429, message: `Demo limit reached: max ${PROJECT_LIMIT} projects allowed.` })
  }

  const base = slugify(body.title)
  if (!base) throw createError({ statusCode: 400, message: 'Title produces an empty slug' })

  const slug = uniqueSlug(base, s => existsSync(contentPath('projects', s)))

  const frontmatter: Record<string, unknown> = {
    title: body.title.trim(),
    status: body.status ?? 'active',
    ...(body.icon ? { icon: body.icon } : {}),
    ...(body.description ? { description: body.description } : {}),
    tags: body.tags ?? [],
    pinnedOrder: projectCount,
    availableStatuses: body.availableStatuses ?? ['todo', 'in-progress', 'done'],
    ...(body.defaultStatus ? { defaultStatus: body.defaultStatus } : {}),
    ...(body.defaultPriority ? { defaultPriority: body.defaultPriority } : {}),
    ...(body.defaultAssignee ? { defaultAssignee: body.defaultAssignee } : {}),
    createdAt: new Date().toISOString().split('T')[0],
  }
  const notices = applyLinkWrite('project', frontmatter, body as Record<string, unknown>)
  writeMarkdown(`projects/${slug}/index.md`, frontmatter)

  return { slug, ...(notices.length ? { notices } : {}) }
})
