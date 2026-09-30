import { defineCommand } from 'citty'
import { TASK_PRIORITIES } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { csv, oneOf } from '../../io'
import { emit } from '../../output'

export default defineCommand({
  meta: { name: 'create', description: 'Create a project (writes via the server)' },
  args: {
    ...globalArgs,
    title: { type: 'positional', description: 'Project title', required: true },
    description: { type: 'string' },
    icon: { type: 'string', description: 'Icon name, e.g. i-lucide-folder' },
    status: { type: 'string', description: 'Project status (default: active)' },
    tags: { type: 'string', description: 'Comma-separated' },
    'github-repo': { type: 'string', description: 'owner/name' },
    'available-statuses': { type: 'string', description: 'Comma-separated task statuses the project uses' },
    'default-status': { type: 'string' },
    'default-priority': { type: 'string', description: TASK_PRIORITIES.join(' | ') },
    'default-assignee': { type: 'string' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const { slug } = await ctx.core.createProject({
      title: args.title,
      description: args.description,
      icon: args.icon,
      status: args.status,
      tags: csv(args.tags),
      githubRepo: args['github-repo'],
      availableStatuses: csv(args['available-statuses']),
      defaultStatus: args['default-status'],
      defaultPriority: oneOf(args['default-priority'], TASK_PRIORITIES, '--default-priority'),
      defaultAssignee: args['default-assignee'],
    })
    emit(ctx.json, { slug }, () => `${ctx.style.green('✓')} created project ${slug}`)
  },
})
