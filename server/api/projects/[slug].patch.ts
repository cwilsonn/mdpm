import { ProjectUpdate } from '../../../lib/core/write-schemas'
export default defineEventHandler(async (event) => {
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(slug)
  const body = await readValidatedBody(event, validator(ProjectUpdate))

  const file = readMarkdown(`projects/${slug}/index.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Project not found' })

  const merged: Record<string, unknown> = { ...file.data }
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue
    if (v === null) { delete merged[k]; continue }
    merged[k] = v
  }

  writeMarkdown(`projects/${slug}/index.md`, { ...merged, updatedAt: new Date().toISOString() }, file.content)
  return { ok: true }
})
