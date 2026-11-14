import { ProjectUpdate } from '../../../lib/core/write-schemas'
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
  const body = await readValidatedBody(event, validator(ProjectUpdate))

  const file = readMarkdown(`projects/${slug}/index.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Project not found' })

  const merged: Record<string, unknown> = { ...file.data }
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined || k === 'links' || k === 'githubRepo') continue
    if (v === null) { delete merged[k]; continue }
    merged[k] = v
  }

  const notices = applyLinkWrite('project', merged, body as Record<string, unknown>)
  writeMarkdown(`projects/${slug}/index.md`, { ...merged, updatedAt: new Date().toISOString() }, file.content)
  return { ok: true, ...(notices.length ? { notices } : {}) }
})
