import { existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name: string }>(event)
  if (!body.name?.trim()) throw createError({ statusCode: 400, message: 'Name required' })

  const base = slugify(body.name)
  if (!base) throw createError({ statusCode: 400, message: 'Name produces an empty slug' })

  const slug = uniqueSlug(base, s => existsSync(contentPath('authors', `${s}.md`)))

  writeMarkdown(`authors/${slug}.md`, {
    name: body.name.trim(),
    createdAt: new Date().toISOString().split('T')[0],
  })

  return { slug, name: body.name.trim() }
})
