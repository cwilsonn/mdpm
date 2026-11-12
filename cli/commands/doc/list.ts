import { defineCommand } from 'citty'
import { DOC_FIELDS, DOC_LIST_FIELDS, docRow } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { csv } from '../../io'
import { listArgs, printPage } from '../../listing'
import { table } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'list', description: 'List docs (current repo\'s project by default; --all for everything)' },
  args: {
    ...globalArgs,
    ...scopeArgs,
    ...listArgs,
    tag: { type: 'string', description: 'Comma-separated; matches docs with any of them' },
    'include-archived': { type: 'boolean', description: 'Include archived docs and their children', default: false },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const scope = docScope(ctx, args)
    const tags = csv(args.tag)
    const docs = ctx.core.listDocsWithBody({ ...scope, includeArchived: args['include-archived'] })
      .filter(d => !tags?.length || tags.some(t => d.tags.includes(t)))
    const scoped = !!scope.project
    printPage(ctx, args, docs.map(d => docRow(d)), {
      noun: 'doc',
      allowed: DOC_FIELDS,
      fallback: DOC_LIST_FIELDS,
      empty: 'no docs',
      human: page => table(
        page.items.map(d => [...(scoped ? [] : [d.project ?? '-']), d.slug, d.tags.join(',') || '-', d.archivedAt ? `${d.title} ${ctx.style.dim('(archived)')}` : d.title]),
        [...(scoped ? [] : ['PROJECT']), 'SLUG', 'TAGS', 'TITLE'],
      ),
    })
  },
})
