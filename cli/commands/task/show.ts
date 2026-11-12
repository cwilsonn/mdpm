import { defineCommand } from 'citty'
import { shapeTask, type Link } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { renderLinks } from '../../links'
import { CliError, emit, ExitCode } from '../../output'
import { projectArgs, refArg, resolveRef } from './shared'

export default defineCommand({
  meta: { name: 'show', description: 'Show one task with its full description' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...refArg,
    full: { type: 'boolean', description: 'The whole body, every note included (default: spec capped, newest 3 notes)', default: false },
    notes: { type: 'string', description: 'How many of the newest notes to show (default 3)' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const full = resolveRef(ctx, args.ref, args)
    const keep = args.notes === undefined ? undefined : Number(args.notes)
    if (keep !== undefined && (!Number.isInteger(keep) || keep < 0)) throw new CliError(`--notes: '${args.notes}' is not a non-negative integer`, ExitCode.usage)
    const task = shapeTask(full, { full: args.full, notes: keep })
    emit(ctx.json, task, () => {
      const s = ctx.style
      const meta = [
        `status: ${task.status}`,
        `priority: ${task.priority}`,
        task.tags.length && `tags: ${task.tags.join(', ')}`,
        task.assignees.length && `assignees: ${task.assignees.join(', ')}`,
        task.due && `due: ${task.due}`,
        task.dependencies.length && `depends on: ${task.dependencies.join(', ')}`,
        task.archivedAt && 'archived',
      ].filter(Boolean).join('  ')
      return [s.bold(task.title), s.dim(`${task.project}/${task.slug}`), meta, ...(task.links.length ? ['', renderLinks(ctx, task.links as Link[])] : []), ...(task.body ? ['', task.body] : []), ...(task.truncated ? ['', s.dim(`(${task.olderNotes ? `${task.olderNotes} older notes hidden; ` : ''}shortened: --full for everything)`)] : [])].join('\n')
    })
  },
})
