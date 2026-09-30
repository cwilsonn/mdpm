import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'
import { projectArgs, refArg, resolveRef } from './shared'

export default defineCommand({
  meta: { name: 'show', description: 'Show one task with its full description' },
  args: {
    ...globalArgs,
    ...projectArgs,
    all: { type: 'boolean', description: 'Search across all projects', default: false },
    ...refArg,
  },
  async run({ args }) {
    const ctx = createContext(args)
    const task = resolveRef(ctx, args.ref, args)
    emit(ctx.json, task, () => {
      const s = ctx.style
      const meta = [
        `status: ${task.status}`,
        `priority: ${task.priority}`,
        task.tags.length && `tags: ${task.tags.join(', ')}`,
        task.assignees.length && `assignees: ${task.assignees.join(', ')}`,
        task.due && `due: ${task.due}`,
        task.dependencies.length && `depends on: ${task.dependencies.join(', ')}`,
        task.githubIssues.length && `issues: ${task.githubIssues.map(n => `#${n}`).join(' ')}`,
        task.githubPRs.length && `PRs: ${task.githubPRs.map(n => `#${n}`).join(' ')}`,
        task.archivedAt && 'archived',
      ].filter(Boolean).join('  ')
      return [s.bold(task.title), s.dim(`${task.project}/${task.slug}`), meta, ...(task.body ? ['', task.body] : [])].join('\n')
    })
  },
})
