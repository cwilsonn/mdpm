import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'unarchive', description: 'Restore an archived doc' },
  args: {
    ...globalArgs,
    ...scopeArgs,
    ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const doc = ctx.core.resolveDoc(args.ref, docScope(ctx, args))
    await ctx.core.archiveDoc(doc, false)
    const where = doc.project ? `${doc.project}/${doc.slug}` : doc.slug
    emit(ctx.json, { project: doc.project, slug: doc.slug, archived: false }, () => `${ctx.style.green('✓')} unarchived ${where}`)
  },
})
