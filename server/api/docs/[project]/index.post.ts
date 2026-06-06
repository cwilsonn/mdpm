import { existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const body = await readBody<{ title: string; tags?: string[]; body?: string }>(event)

  if (!body.title?.trim()) throw createError({ statusCode: 400, message: 'Title is required' })
  if (!existsSync(contentPath('projects', project))) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }

  const base = slugify(body.title)
  if (!base) throw createError({ statusCode: 400, message: 'Title produces an empty slug' })

  const slug = uniqueSlug(
    base,
    s => existsSync(contentPath('projects', project, 'docs', `${s}.md`)),
  )

  writeMarkdown(`projects/${project}/docs/${slug}.md`, {
    title: body.title.trim(),
    tags: body.tags ?? [],
    createdAt: new Date().toISOString().split('T')[0],
  }, body.body ?? '')

  return { slug }
})
