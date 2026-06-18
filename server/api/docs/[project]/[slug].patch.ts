import { existsSync } from 'node:fs'

export default defineEventHandler(async (event) => {
  const project = getRouterParam(event, 'project')!
  const slug = getRouterParam(event, 'slug')!
  assertSafeSlug(project, slug)
  const body = await readBody<{ title?: string; tags?: string[]; parent?: string | null; order?: number; body?: string }>(event)

  const file = readMarkdown(`projects/${project}/docs/${slug}.md`)
  if (!file) throw createError({ statusCode: 404, message: 'Doc not found' })

  if (body.parent !== undefined && body.parent !== null) {
    assertSafeSlug(body.parent)
    if (!existsSync(contentPath('projects', project, 'docs', `${body.parent}.md`))) {
      throw createError({ statusCode: 400, message: `Parent doc '${body.parent}' not found in this project` })
    }
    if (wouldCreateCycleProject(slug, body.parent, project)) {
      throw createError({ statusCode: 400, message: 'Setting this parent would create a cycle' })
    }
  }

  const { body: newBody, ...frontmatterFields } = body
  const merged: Record<string, unknown> = { ...file.data }
  for (const [k, v] of Object.entries(frontmatterFields)) {
    if (v === undefined) continue
    if (v === null) { delete merged[k]; continue }
    merged[k] = v
  }
  merged.updatedAt = new Date().toISOString()

  writeMarkdown(`projects/${project}/docs/${slug}.md`, merged, newBody !== undefined ? String(newBody) : file.content)
  return { ok: true }
})

function wouldCreateCycleProject(slug: string, newParent: string, project: string): boolean {
  let current: string | null = newParent
  const visited = new Set<string>()
  while (current) {
    if (current === slug) return true
    if (visited.has(current)) return false
    visited.add(current)
    const file = readMarkdown(`projects/${project}/docs/${current}.md`)
    current = (file?.data?.parent as string | undefined) ?? null
  }
  return false
}
