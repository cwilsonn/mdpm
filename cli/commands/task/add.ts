import { defineCommand } from 'citty'
import { TASK_PRIORITIES, TASK_STATUSES } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { csv, csvNumbers, oneOf, textOrStdin } from '../../io'
import { emit } from '../../output'
import { projectArgs, requireProject } from './shared'

export default defineCommand({
  meta: { name: 'add', description: 'Create a task (writes via the server)' },
  args: {
    ...globalArgs,
    ...projectArgs,
    title: { type: 'positional', description: 'Task title', required: true },
    status: { type: 'string', description: TASK_STATUSES.join(' | ') },
    priority: { type: 'string', description: TASK_PRIORITIES.join(' | ') },
    tags: { type: 'string', description: 'Comma-separated' },
    assignees: { type: 'string', description: 'Comma-separated' },
    due: { type: 'string', description: 'YYYY-MM-DD' },
    'github-issues': { type: 'string', description: 'Comma-separated issue numbers' },
    'github-prs': { type: 'string', description: 'Comma-separated PR numbers' },
    description: { type: 'string', description: 'Markdown body; use - to read it from stdin' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const project = requireProject(ctx, args)
    const fields = {
      title: args.title,
      status: oneOf(args.status, TASK_STATUSES, '--status'),
      priority: oneOf(args.priority, TASK_PRIORITIES, '--priority'),
      tags: csv(args.tags),
      assignees: csv(args.assignees),
      due: args.due,
      githubIssues: csvNumbers(args['github-issues'], '--github-issues'),
      githubPRs: csvNumbers(args['github-prs'], '--github-prs'),
      description: args.description === undefined ? undefined : await textOrStdin(args.description),
    }
    const { slug } = await ctx.core.createTask(project, fields)
    emit(ctx.json, { project, slug }, () => `${ctx.style.green('✓')} created ${project}/${slug}`)
  },
})
