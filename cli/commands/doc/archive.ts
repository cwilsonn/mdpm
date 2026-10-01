import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { emit } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'archive', description: 'Archive a doc (hidden from lists unless --include-archived)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...scopeArgs,
    ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const doc = ctx.core.resolveDoc(args.ref, docScope(ctx, args))
    await ctx.core.archiveDoc(doc, true)
    const where = doc.project ? `${doc.project}/${doc.slug}` : doc.slug
    emit(ctx.json, { project: doc.project, slug: doc.slug, archived: true }, () => `${ctx.style.green('✓')} archived ${where}`)
  },
})
