import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { emit } from '../../output'

export default defineCommand({
  meta: { name: 'archive', description: 'Archive a project (hidden from lists unless --include-archived)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ref: { type: 'positional', description: 'Project slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const { slug } = ctx.core.resolveProject(args.ref)
    await ctx.core.archiveProject(slug, true)
    emit(ctx.json, { slug, archived: true }, () => `${ctx.style.green('✓')} archived project ${slug}`)
  },
})
