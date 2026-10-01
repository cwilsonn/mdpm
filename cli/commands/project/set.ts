import { defineCommand } from 'citty'
import { TASK_PRIORITIES } from '../../../lib/core'
import { createContext, globalArgs, writeArgs } from '../../context'
import { csv, oneOf } from '../../io'
import { CliError, emit, ExitCode } from '../../output'

// "none" clears an optional field (the API removes the key when it receives null).
const clearable = (value: string | undefined) => value === undefined ? undefined : value === 'none' ? null : value

export default defineCommand({
  meta: { name: 'set', description: 'Update fields on a project (writes via the server)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ref: { type: 'positional', description: 'Project slug or unique fragment of slug/title', required: true },
    title: { type: 'string' },
    description: { type: 'string' },
    icon: { type: 'string', description: 'Icon name, or "none" to clear' },
    status: { type: 'string', description: 'Project status, e.g. active | on-hold' },
    tags: { type: 'string', description: 'Comma-separated; replaces the existing tags' },
    'github-repo': { type: 'string', description: 'owner/name, or "none" to clear' },
    'available-statuses': { type: 'string', description: 'Comma-separated task statuses the project uses' },
    'default-status': { type: 'string', description: 'Or "none" to clear' },
    'default-priority': { type: 'string', description: `${TASK_PRIORITIES.join(' | ')}, or "none" to clear` },
    'default-assignee': { type: 'string', description: 'Or "none" to clear' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const { slug } = ctx.core.resolveProject(args.ref)
    const priority = args['default-priority']
    const fields: Record<string, unknown> = {
      title: args.title,
      description: args.description,
      icon: clearable(args.icon),
      status: args.status,
      tags: csv(args.tags),
      githubRepo: clearable(args['github-repo']),
      availableStatuses: csv(args['available-statuses']),
      defaultStatus: clearable(args['default-status']),
      defaultPriority: priority === 'none' ? null : oneOf(priority, TASK_PRIORITIES, '--default-priority'),
      defaultAssignee: clearable(args['default-assignee']),
    }
    const changed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
    if (!Object.keys(changed).length) throw new CliError('nothing to set: pass at least one field flag (see --help)', ExitCode.usage)
    await ctx.core.updateProject(slug, changed)
    emit(ctx.json, { slug, updated: Object.keys(changed) }, () => `${ctx.style.green('✓')} updated project ${slug} (${Object.keys(changed).join(', ')})`)
  },
})
