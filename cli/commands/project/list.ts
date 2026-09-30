import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { csv } from '../../io'
import { emit, table } from '../../output'

export default defineCommand({
  meta: { name: 'list', description: 'List projects' },
  args: {
    ...globalArgs,
    status: { type: 'string', description: 'Only projects with this status (e.g. active)' },
    tags: { type: 'string', description: 'Comma-separated; matches projects with any of them' },
    'include-archived': { type: 'boolean', description: 'Include archived projects', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const tags = csv(args.tags)
    const projects = ctx.core.listProjects({ includeArchived: args['include-archived'] })
      .filter(p => (!args.status || p.status === args.status) && (!tags?.length || tags.some(t => p.tags.includes(t))))
    emit(ctx.json, projects, () => projects.length
      ? `${table(
        projects.map(p => [p.slug, p.status, String(p.taskCount), String(p.docCount), p.githubRepo ?? '-', p.archivedAt ? `${p.title} ${ctx.style.dim('(archived)')}` : p.title]),
        ['SLUG', 'STATUS', 'TASKS', 'DOCS', 'GITHUB', 'TITLE'],
      )}\n${ctx.style.dim(`${projects.length} project${projects.length === 1 ? '' : 's'}`)}`
      : ctx.style.dim('no projects'))
  },
})
