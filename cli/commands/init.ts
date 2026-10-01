import { defineCommand } from 'citty'
import { initRepo } from '../../lib/core'
import { createContext, globalArgs, writeArgs } from '../context'
import { emit, table } from '../output'

export default defineCommand({
  meta: { name: 'init', description: 'Register the current repo with mdpm: project, optional .mdpm marker, work-logging block in CLAUDE.md' },
  args: {
    ...globalArgs,
    ...writeArgs,
    project: { type: 'string', description: 'Link to this existing project instead of inferring or creating one' },
    title: { type: 'string', description: 'Title for a new project (default: the repo directory name)' },
    description: { type: 'string', description: 'Description for a new project' },
    marker: { type: 'boolean', description: 'Force a .mdpm marker (default: only when the project would not be found without it; --no-marker to skip)' },
    'claude-md': { type: 'boolean', description: 'Install the work-logging block (--no-claude-md to skip)', default: true },
    local: { type: 'boolean', description: 'Write CLAUDE.local.md (kept out of git via .git/info/exclude) instead of CLAUDE.md', default: false },
    'dry-run': { type: 'boolean', description: 'Show what would change without writing anything', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const result = await initRepo(ctx.core, {
      cwd: process.cwd(),
      project: args.project,
      title: args.title,
      description: args.description,
      marker: args.marker,
      claudeMd: args['claude-md'],
      local: args.local,
      dryRun: args['dry-run'],
    })
    emit(ctx.json, result, () => [
      `${ctx.style.dim(result.root)}${args['dry-run'] ? ctx.style.yellow('  (dry run: nothing written)') : ''}`,
      table(result.steps.map(s => [s.step, s.action, s.target, s.detail ?? ''])),
    ].join('\n'))
  },
})
