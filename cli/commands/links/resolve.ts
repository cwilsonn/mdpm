import { defineCommand } from 'citty'
import { builtinRegistry, KINDS, viewLink, type Link } from '../../../lib/core'
import { createContext, globalArgs } from '../../context'
import { parseKind, resolveOrExplain } from '../../links'
import { emit } from '../../output'

export default defineCommand({
  meta: { name: 'resolve', description: 'Show how a URL or short ref (#42, ABC-123) would be understood. Writes nothing' },
  args: {
    ...globalArgs,
    input: { type: 'positional', description: 'URL or short ref', required: true },
    project: { type: 'string', description: 'Project whose repo links expand short refs (default: inferred from the current repo)' },
    provider: { type: 'string', description: 'Provider id when the input could be several' },
    kind: { type: 'string', description: KINDS.join(' | ') },
    title: { type: 'string' },
  },
  run({ args }) {
    const ctx = createContext(args)
    const slug = args.project ? ctx.core.resolveProject(args.project).slug : ctx.inferProject()?.slug
    const repos = slug ? (ctx.core.getProject(slug).links as Link[]).filter(l => l.kind === 'repo') : []
    const link = resolveOrExplain(args.input, repos, { provider: args.provider, kind: parseKind(args.kind), title: args.title })
    const view = viewLink(builtinRegistry(), link)
    emit(ctx.json, { link, view }, () => [
      `${view.noun} ${view.label}`,
      `  url:      ${view.href ?? ctx.style.yellow('(none)')}`,
      `  provider: ${link.provider ?? ctx.style.dim('(plain link)')}${link.kind ? `  kind: ${link.kind}` : ''}${link.ref ? `  ref: ${link.ref}` : ''}`,
      `  icon:     ${view.icon}`,
    ].join('\n'))
  },
})
