import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { csv } from '../../io'
import { emit, table } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'list', description: 'List docs (current repo\'s project by default; --all for everything)' },
  args: {
    ...globalArgs,
    ...scopeArgs,
    tag: { type: 'string', description: 'Comma-separated; matches docs with any of them' },
    'include-archived': { type: 'boolean', description: 'Include archived docs and their children', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const scope = docScope(ctx, args)
    const tags = csv(args.tag)
    const docs = ctx.core.listDocs({ ...scope, includeArchived: args['include-archived'] })
      .filter(d => !tags?.length || tags.some(t => d.tags.includes(t)))
    emit(ctx.json, docs, () => {
      if (!docs.length) return ctx.style.dim('no docs')
      const scoped = !!scope.project
      return `${table(
        docs.map(d => [...(scoped ? [] : [d.project ?? '-']), d.slug, d.tags.join(',') || '-', d.archivedAt ? `${d.title} ${ctx.style.dim('(archived)')}` : d.title]),
        [...(scoped ? [] : ['PROJECT']), 'SLUG', 'TAGS', 'TITLE'],
      )}\n${ctx.style.dim(`${docs.length} doc${docs.length === 1 ? '' : 's'}`)}`
    })
  },
})
