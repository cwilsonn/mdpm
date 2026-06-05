import { existsSync, readdirSync } from 'node:fs'

const AUTHOR_LIMIT = 10

export default defineEventHandler(async (event) => {
  const body = await readBody<{ name: string }>(event)
  if (!body.name?.trim()) throw createError({ statusCode: 400, message: 'Name required' })

  const authorsDir = contentPath('authors')
  const authorCount = existsSync(authorsDir)
    ? readdirSync(authorsDir).filter(f => f.endsWith('.md')).length
    : 0
  if (authorCount >= AUTHOR_LIMIT) {
    throw createError({ statusCode: 429, message: `Demo limit reached: max ${AUTHOR_LIMIT} authors allowed.` })
  }

  const base = slugify(body.name)
  if (!base) throw createError({ statusCode: 400, message: 'Name produces an empty slug' })

  const slug = uniqueSlug(base, s => existsSync(contentPath('authors', `${s}.md`)))

  writeMarkdown(`authors/${slug}.md`, {
    name: body.name.trim(),
    createdAt: new Date().toISOString().split('T')[0],
  })

  return { slug, name: body.name.trim() }
})
