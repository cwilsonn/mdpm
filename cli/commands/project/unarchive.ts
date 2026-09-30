import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'

export default defineCommand({
  meta: { name: 'unarchive', description: 'Restore an archived project' },
  args: {
    ...globalArgs,
    ref: { type: 'positional', description: 'Project slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const { slug } = ctx.core.resolveProject(args.ref)
    await ctx.core.archiveProject(slug, false)
    emit(ctx.json, { slug, archived: false }, () => `${ctx.style.green('✓')} unarchived project ${slug}`)
  },
})
