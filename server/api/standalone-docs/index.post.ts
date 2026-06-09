import { existsSync, readdirSync } from 'node:fs'

const DOC_LIMIT = 50

export default defineEventHandler(async (event) => {
  const body = await readBody<{ title: string; slug?: string; tags?: string[]; parent?: string; body?: string }>(event)

  if (!body.title?.trim()) throw createError({ statusCode: 400, message: 'Title is required' })

  const docsDir = contentPath('docs')
  const docCount = existsSync(docsDir)
    ? readdirSync(docsDir).filter(f => f.endsWith('.md')).length
    : 0
  if (process.env.NODE_ENV === 'production' && docCount >= DOC_LIMIT) {
    throw createError({ statusCode: 429, message: `Demo limit reached: max ${DOC_LIMIT} standalone docs.` })
  }

  if (body.slug) assertSafeSlug(body.slug)
  const base = body.slug || slugify(body.title)
  if (!base) throw createError({ statusCode: 400, message: 'Title produces an empty slug' })

  const slug = uniqueSlug(base, s => existsSync(contentPath('docs', `${s}.md`)))

  if (body.parent) {
    assertSafeSlug(body.parent)
    if (!existsSync(contentPath('docs', `${body.parent}.md`))) {
      throw createError({ statusCode: 400, message: `Parent doc '${body.parent}' not found` })
    }
  }

  writeMarkdown(`docs/${slug}.md`, {
    title: body.title.trim(),
    tags: body.tags ?? [],
    ...(body.parent ? { parent: body.parent } : {}),
    createdAt: new Date().toISOString().split('T')[0],
  }, body.body ?? '')

  return { slug }
})
