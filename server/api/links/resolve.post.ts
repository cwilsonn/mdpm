import { effectiveLinks } from '../../../lib/core/github-links'
import { LinkError, resolveLink, viewLink } from '../../../lib/core/links'
import { builtinRegistry } from '../../../lib/core/providers/registry'
import { KINDS, type Kind } from '../../../lib/core/providers/schema'

// Turns what a person typed (a pasted URL, or a short ref like "#42") into a stored link, using the
// project's repo links to expand short refs. Nothing is written; the caller stores the result.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ input?: string; project?: string; provider?: string; kind?: string; title?: string }>(event)
  if (typeof body.input !== 'string' || !body.input.trim()) throw createError({ statusCode: 400, message: 'input is required' })
  if (body.kind !== undefined && !KINDS.includes(body.kind as Kind)) throw createError({ statusCode: 400, message: `kind must be one of ${KINDS.join(', ')}` })

  let repos: ReturnType<typeof effectiveLinks> = []
  if (body.project) {
    assertSafeSlug(body.project)
    const project = readMarkdown(`projects/${body.project}/index.md`)
    if (!project) throw createError({ statusCode: 404, message: 'Project not found' })
    repos = effectiveLinks('project', project.data, null).filter(l => l.kind === 'repo')
  }

  const registry = builtinRegistry()
  try {
    const link = resolveLink(registry, body.input, { repos }, { provider: body.provider, kind: body.kind as Kind | undefined, title: body.title })
    return { link, view: viewLink(registry, link) }
  }
  catch (err) {
    if (err instanceof LinkError) throw createError({ statusCode: 400, message: err.message, data: { code: err.code } })
    throw err
  }
})
