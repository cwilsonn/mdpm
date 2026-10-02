import type { Link } from '../../../lib/core'
import { linkCommand } from '../../links'
import { projectArgs, refArg, resolveRef } from './shared'

export default linkCommand({
  description: 'Add, remove, and list a task\'s links (URLs, GitHub/GitLab/Jira refs, ...)',
  targetArgs: { ...projectArgs, all: { type: 'boolean', description: 'Search across all projects', default: false }, ...refArg },
  target(ctx, args) {
    const task = resolveRef(ctx, args.ref, args)
    const project = ctx.core.getProject(task.project)
    return {
      name: `${task.project}/${task.slug}`,
      links: task.links as Link[],
      repos: (project.links as Link[]).filter(l => l.kind === 'repo'),
      save: links => ctx.core.updateTask(task.project, task.slug, { links }),
    }
  },
})
