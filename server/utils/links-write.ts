import type { FileKind } from '../../lib/core/github-links'
import { planLinkWrite } from '../../lib/core/legacy-write'
import { builtinRegistry } from '../../lib/core/providers/registry'

// Applies a create/update request's `links` and legacy GitHub arguments to the frontmatter that is
// about to be written. Returns notices (deprecations, warnings) for the response; a bad request is a 400.
export function applyLinkWrite(kind: FileKind, data: Record<string, unknown>, body: Record<string, unknown>, projectRepo: string | null = null): string[] {
  const plan = planLinkWrite(builtinRegistry(), kind, data, body, projectRepo)
  if (plan.problems.length) throw createError({ statusCode: 400, message: plan.problems.join('; ') })
  for (const key of plan.dropKeys) delete data[key]
  if (plan.links) {
    if (plan.links.length) data.links = plan.links
    else delete data.links
  }
  return plan.notices
}
