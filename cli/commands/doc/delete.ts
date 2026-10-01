import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { confirm } from '../../io'
import { CliError, emit, ExitCode } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'delete', description: 'Permanently delete a doc (asks for confirmation unless --yes)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...scopeArgs,
    yes: { type: 'boolean', alias: 'y', description: 'Skip the confirmation prompt', default: false },
    ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const doc = ctx.core.resolveDoc(args.ref, docScope(ctx, args))
    const where = doc.project ? `${doc.project}/${doc.slug}` : doc.slug
    if (!args.yes && !await confirm(`Delete doc ${where} ("${doc.title}")? This cannot be undone.`)) throw new CliError('aborted', ExitCode.error)
    await ctx.core.deleteDoc(doc.project, doc.slug)
    emit(ctx.json, { project: doc.project, slug: doc.slug, deleted: true }, () => `${ctx.style.green('✓')} deleted ${where}`)
  },
})
