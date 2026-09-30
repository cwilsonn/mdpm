import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../context'
import { emit } from '../output'

export default defineCommand({
  meta: { name: 'ping', description: 'Check config, content access, and whether the server is up' },
  args: { ...globalArgs },
  async run({ args }) {
    const ctx = createContext(args)
    const { core } = ctx
    const projects = core.listProjects({ includeArchived: true })
    const serverUp = await core.probeServer()
    const result = {
      ok: true,
      contentPath: core.config.contentPath,
      baseUrl: core.config.baseUrl,
      serverUp,
      projectCount: projects.length,
      projects: projects.map(p => p.slug),
    }
    emit(ctx.json, result, () => [
      `${ctx.style.green('✓')} content: ${result.contentPath} (${result.projectCount} projects)`,
      `${serverUp ? ctx.style.green('✓') : ctx.style.yellow('!')} server: ${result.baseUrl} ${serverUp ? 'up' : 'down (reads work; writes need it)'}`,
    ].join('\n'))
  },
})
