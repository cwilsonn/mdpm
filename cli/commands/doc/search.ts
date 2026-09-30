import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'search', description: 'Full-text search over doc titles and bodies' },
  args: {
    ...globalArgs,
    ...scopeArgs,
    query: { type: 'positional', description: 'Text to look for (case-insensitive)', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const scope = docScope(ctx, args)
    // searchDocs takes a project or nothing; --standalone is applied afterwards.
    const hits = ctx.core.searchDocs(args.query, scope.project).filter(d => !scope.standalone || !d.project)
    emit(ctx.json, hits, () => hits.length
      ? hits.map(d => `${ctx.style.bold(d.title)} ${ctx.style.dim(`${d.project ?? 'standalone'}/${d.slug}`)}\n  ${d.excerpt.replace(/\s+/g, ' ')}`).join('\n')
      : ctx.style.dim('no matches'))
  },
})
