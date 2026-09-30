import { defineCommand } from 'citty'
import { createContext, globalArgs } from '../../context'
import { emit } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'show', description: 'Print a doc\'s markdown body (pipe-friendly); --json for full metadata' },
  args: {
    ...globalArgs,
    ...scopeArgs,
    ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const doc = ctx.core.resolveDoc(args.ref, docScope(ctx, args))
    // Human mode is the raw body only, so `mdpm doc show x | less` or `> file.md` just works.
    emit(ctx.json, doc, () => doc.body)
  },
})
