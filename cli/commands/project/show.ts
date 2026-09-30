import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { CliError, emit, ExitCode } from '../../output'

export default defineCommand({
  meta: { name: 'show', description: 'Show one project with task counts by status (default: current repo\'s project)' },
  args: {
    ...globalArgs,
    ref: { type: 'positional', description: 'Project slug or unique fragment of slug/title', required: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const slug = args.ref ? ctx.core.resolveProject(args.ref).slug : ctx.inferProject()?.slug
    if (!slug) throw new CliError('no project: name one, or run inside a repo registered in mdpm (see `mdpm config show`)', ExitCode.usage)
    const project = ctx.core.getProject(slug)
    const tasksByStatus: Record<string, number> = {}
    for (const t of ctx.core.listTasks({ project: slug })) tasksByStatus[t.status] = (tasksByStatus[t.status] ?? 0) + 1
    const result = { ...project, tasksByStatus }
    emit(ctx.json, result, () => {
      const s = ctx.style
      const counts = Object.entries(tasksByStatus).map(([status, n]) => `${status}: ${n}`).join('  ') || 'none'
      return [
        s.bold(project.title),
        s.dim(project.slug),
        `status: ${project.status}${project.archivedAt ? ' (archived)' : ''}${project.tags.length ? `  tags: ${project.tags.join(', ')}` : ''}`,
        project.githubRepo && `github: ${project.githubRepo}`,
        `tasks: ${project.taskCount}  docs: ${project.docCount}`,
        `open tasks by status: ${counts}`,
        project.description && `\n${project.description}`,
      ].filter(Boolean).join('\n')
    })
  },
})
