import { existsSync, readdirSync } from 'node:fs'
import { ProjectCreate } from '../../../lib/core/write-schemas'

const PROJECT_LIMIT = 10

export default defineEventHandler(async (event) => {
  const body = await readValidatedBody(event, validator(ProjectCreate))

  const projectsDir = contentPath('projects')
  const projectCount = existsSync(projectsDir)
    ? readdirSync(projectsDir, { withFileTypes: true }).filter(e => e.isDirectory()).length
    : 0
  if (isDemo() && projectCount >= PROJECT_LIMIT) {
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
    ...(body.repo ? { repo: body.repo } : {}),
    pinnedOrder: projectCount,
    availableStatuses: body.availableStatuses ?? ['todo', 'in-progress', 'done'],
    ...(body.defaultStatus ? { defaultStatus: body.defaultStatus } : {}),
    ...(body.defaultPriority ? { defaultPriority: body.defaultPriority } : {}),
    ...(body.defaultAssignee ? { defaultAssignee: body.defaultAssignee } : {}),
    createdAt: new Date().toISOString().split('T')[0],
  }
  writeMarkdown(`projects/${slug}/index.md`, frontmatter)

  return { slug }
})
