import { linkCommand } from '../../links'
import { projectArgs, refArg, resolveRef } from './shared'

export default linkCommand({
  description: 'Add, remove, and list a task\'s links (URLs, GitHub/GitLab/Jira refs, ...)',
  targetArgs: { ...projectArgs, all: { type: 'boolean', description: 'Search across all projects', default: false }, ...refArg },
  item(ctx, args) {
    const task = resolveRef(ctx, args.ref, args)
    return { scope: 'task', project: task.project, slug: task.slug }
  },
})
