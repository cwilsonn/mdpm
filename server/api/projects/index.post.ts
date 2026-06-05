import { existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{
    title: string
    status?: string
    icon?: string
    description?: string
    tags?: string[]
  }>(event)

  if (!body.title?.trim()) {
    throw createError({ statusCode: 400, message: 'Title is required' })
  }

  const base = slugify(body.title)
  if (!base) throw createError({ statusCode: 400, message: 'Title produces an empty slug' })

  const slug = uniqueSlug(base, s => existsSync(contentPath('projects', s)))

  writeMarkdown(`projects/${slug}/index.md`, {
    title: body.title.trim(),
    status: body.status ?? 'active',
    ...(body.icon ? { icon: body.icon } : {}),
    ...(body.description ? { description: body.description } : {}),
    tags: body.tags ?? [],
    createdAt: new Date().toISOString().split('T')[0],
  })

  return { slug }
})
