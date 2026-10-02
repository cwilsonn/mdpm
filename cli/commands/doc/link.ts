import { linkCommand } from '../../links'
import { docScope, scopeArgs } from './shared'

export default linkCommand({
  description: 'Add, remove, and list a doc\'s links',
  targetArgs: { ...scopeArgs, ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true } },
  item(ctx, args) {
    const doc = ctx.core.resolveDoc(args.ref, docScope(ctx, args))
    return { scope: 'doc', project: doc.project, slug: doc.slug }
  },
})
