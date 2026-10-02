import type { Link } from '../../../lib/core'
import { linkCommand } from '../../links'
import { docScope, scopeArgs } from './shared'

export default linkCommand({
  description: 'Add, remove, and list a doc\'s links',
  targetArgs: { ...scopeArgs, ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true } },
  target(ctx, args) {
    const doc = ctx.core.resolveDoc(args.ref, docScope(ctx, args))
    const project = doc.project ? ctx.core.getProject(doc.project) : undefined
    return {
      name: doc.project ? `${doc.project}/${doc.slug}` : doc.slug,
      links: doc.links as Link[],
      repos: ((project?.links ?? []) as Link[]).filter(l => l.kind === 'repo'),
      save: links => ctx.core.updateDoc(doc, { links }),
    }
  },
})
