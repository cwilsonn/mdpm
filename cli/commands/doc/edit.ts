import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { csv, editText, textOrStdin } from '../../io'
import { CliError, emit, ExitCode } from '../../output'
import { docScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'edit', description: 'Edit a doc: opens $EDITOR on its body, or set fields with flags (writes via the server)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    ...scopeArgs,
    ref: { type: 'positional', description: 'Doc slug or unique fragment of slug/title', required: true },
    title: { type: 'string' },
    body: { type: 'string', description: 'Replace the body with this text; use - to read it from stdin (skips the editor)' },
    tags: { type: 'string', description: 'Comma-separated; replaces the existing tags' },
    parent: { type: 'string', description: 'Parent doc (slug or fragment), or "none" to un-nest' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const scope = docScope(ctx, args)
    const doc = ctx.core.resolveDoc(args.ref, scope)
    const where = doc.project ? `${doc.project}/${doc.slug}` : doc.slug
    const fieldFlags = args.title !== undefined || args.tags !== undefined || args.parent !== undefined

    const fields: { title?: string; body?: string; tags?: string[]; parent?: string | null } = {}
    if (args.title !== undefined) fields.title = args.title
    if (args.tags !== undefined) fields.tags = csv(args.tags)
    if (args.parent !== undefined) {
      fields.parent = args.parent === 'none'
        ? null
        : ctx.core.resolveDoc(args.parent, doc.project ? { project: doc.project } : { standalone: true }).slug
    }
    if (args.body !== undefined) fields.body = await textOrStdin(args.body)
    else if (!fieldFlags) {
      // Plain `doc edit <ref>`: the editor is the interface.
      const edited = editText(doc.body, doc.slug)
      if (edited.trimEnd() !== doc.body.trimEnd()) fields.body = edited.trimEnd()
    }

    if (!Object.keys(fields).length) {
      if (fieldFlags || args.body !== undefined) throw new CliError('nothing to change', ExitCode.usage)
      emit(ctx.json, { project: doc.project, slug: doc.slug, updated: [] }, () => `no changes to ${where}`)
      return
    }
    await ctx.core.updateDoc(doc, fields)
    emit(ctx.json, { project: doc.project, slug: doc.slug, updated: Object.keys(fields) }, () => `${ctx.style.green('✓')} updated ${where} (${Object.keys(fields).join(', ')})`)
  },
})
