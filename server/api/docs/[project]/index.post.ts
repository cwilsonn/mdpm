import { existsSync, readdirSync } from 'node:fs'

const DOC_LIMIT_PER_PROJECT = 20

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const body = await readBody<{ title: string; tags?: string[]; body?: string }>(event)

  if (!body.title?.trim()) throw createError({ statusCode: 400, message: 'Title is required' })
  if (!existsSync(contentPath('projects', project))) {
    throw createError({ statusCode: 404, message: 'Project not found' })
  }

  const docsDir = contentPath('projects', project, 'docs')
  const docCount = existsSync(docsDir)
    ? readdirSync(docsDir).filter(f => f.endsWith('.md')).length
    : 0
  if (docCount >= DOC_LIMIT_PER_PROJECT) {
    throw createError({ statusCode: 429, message: `Demo limit reached: max ${DOC_LIMIT_PER_PROJECT} docs per project.` })
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
