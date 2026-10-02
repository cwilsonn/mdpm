import type { Link } from '../../../lib/core'
import { linkCommand } from '../../links'

export default linkCommand({
  description: 'Add, remove, and list a project\'s links (its repository, boards, docs, ...)',
  targetArgs: { ref: { type: 'positional', description: 'Project slug or unique fragment of slug/title', required: true } },
  target(ctx, args) {
    const { slug } = ctx.core.resolveProject(args.ref)
    const project = ctx.core.getProject(slug)
    const links = project.links as Link[]
    return {
      name: slug,
      links,
      repos: links.filter(l => l.kind === 'repo'),
      save: next => ctx.core.updateProject(slug, { links: next }),
    }
  },
})
