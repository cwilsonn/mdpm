import { linkCommand } from '../../links'

export default linkCommand({
  description: 'Add, remove, and list a project\'s links (its repository, boards, docs, ...)',
  targetArgs: { ref: { type: 'positional', description: 'Project slug or unique fragment of slug/title', required: true } },
  item(ctx, args) {
    return { scope: 'project', slug: ctx.core.resolveProject(args.ref).slug }
  },
})
