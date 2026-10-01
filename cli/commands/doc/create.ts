import { defineCommand } from 'citty'
import { createContext, globalArgs, writeArgs } from '../../context'
import { csv, editText, textOrStdin } from '../../io'
import { emit } from '../../output'
import { createScope, scopeArgs } from './shared'

export default defineCommand({
  meta: { name: 'create', description: 'Create a doc (writes via the server)' },
  args: {
    ...globalArgs,
    ...writeArgs,
    project: scopeArgs.project,
    standalone: scopeArgs.standalone,
    title: { type: 'positional', description: 'Doc title', required: true },
    body: { type: 'string', description: 'Markdown body; use - to read it from stdin' },
    edit: { type: 'boolean', description: 'Compose the body in $EDITOR', default: false },
    tags: { type: 'string', description: 'Comma-separated' },
    parent: { type: 'string', description: 'Parent doc (slug or fragment) in the same scope, to nest it' },
    slug: { type: 'string', description: 'Explicit slug (default: derived from the title)' },
  },
  async run({ args }) {
    const ctx = createContext(args)
    const scope = createScope(ctx, args)
    const body = args.body !== undefined ? await textOrStdin(args.body) : args.edit ? editText('', 'new-doc').trimEnd() : undefined
    const parent = args.parent ? ctx.core.resolveDoc(args.parent, scope).slug : undefined
    const { slug } = await ctx.core.createDoc({ project: scope.project, title: args.title, body, tags: csv(args.tags), parent, slug: args.slug })
    const where = scope.project ? `${scope.project}/${slug}` : slug
    emit(ctx.json, { project: scope.project ?? null, slug }, () => `${ctx.style.green('✓')} created doc ${where}`)
  },
})
