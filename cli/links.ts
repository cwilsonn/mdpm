import { defineCommand } from 'citty'
import { addLink, builtinRegistry, KINDS, LinkError, resolveLink, viewLink, type Kind, type Link } from '../lib/core'
import { createContext, globalArgs, writeArgs, type Context } from './context'
import { CliError, emit, ExitCode } from './output'

// `task link`, `project link` and `doc link` share one implementation: each supplies how to find its
// target and how to save a new links list; add/remove/list are the same everywhere.

export interface LinkCommandSpec {
  description: string
  // Positional `ref` (and scope flags) that identify the item
  targetArgs: Record<string, any>
  // Resolve the user's (possibly fuzzy) ref to one concrete item
  item(ctx: Context, args: any): { scope: 'task' | 'project' | 'doc'; project?: string | null; slug: string }
}

const registry = builtinRegistry()

export function parseKind(value: unknown): Kind | undefined {
  if (value === undefined) return undefined
  if (!(KINDS as readonly string[]).includes(String(value))) throw new CliError(`--kind: '${value}' is not one of ${KINDS.join(', ')}`, ExitCode.usage)
  return value as Kind
}

// A resolver error that is really "tell me which one you mean" gets the flags that answer it.
// The resolver's "which one do you mean" errors get the CLI flags that answer them.
async function explainAmbiguity<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  }
  catch (err) {
    if (err instanceof LinkError && err.code === 'ambiguous') throw new CliError(err.message.replace(/; specify a provider.*$/, '; use --provider and/or --kind to choose'), ExitCode.usage)
    throw err
  }
}

export function resolveOrExplain(input: string, repos: Link[], opts: { provider?: string; kind?: Kind; title?: string } = {}) {
  try {
    return resolveLink(registry, input, { repos }, opts)
  }
  catch (err) {
    if (err instanceof LinkError && err.code === 'ambiguous') throw new CliError(err.message.replace(/; specify a provider.*$/, '; use --provider and/or --kind to choose'), ExitCode.usage)
    throw err
  }
}

const describeLink = (link: Link) => {
  const view = viewLink(registry, link)
  return { view, text: `${view.noun} ${view.label}` }
}

// Repo links of a project, which expand short refs like "#42".
export const repoLinks = (ctx: Context, project: string) => (ctx.core.getProject(project).links as Link[]).filter(l => l.kind === 'repo')

// citty keeps only the last value of a repeated flag, so `--link a --link b` would silently lose `a`.
// Read every occurrence (`--flag x` or `--flag=x`) from the raw arguments instead.
export function repeatedFlag(rawArgs: string[], flag: string): string[] {
  const values: string[] = []
  rawArgs.forEach((arg, i) => {
    if (arg === `--${flag}`) { if (rawArgs[i + 1] !== undefined) values.push(rawArgs[i + 1]!) }
    else if (arg.startsWith(`--${flag}=`)) values.push(arg.slice(flag.length + 3))
  })
  return values
}

// `--link` values (repeatable): resolve each against the project's repo links; duplicates collapse.
export function resolveLinkFlags(value: unknown, repos: Link[]): Link[] {
  const inputs = ([] as unknown[]).concat(value ?? []).map(String).filter(Boolean)
  const out: Link[] = []
  for (const input of inputs) out.push(...addLink(out, resolveOrExplain(input, repos)).links.slice(out.length))
  return out
}

export function renderLinks(ctx: Context, links: Link[]) {
  return links.map((link, i) => {
    const { view, text } = describeLink(link)
    return `${ctx.style.dim(`@${i + 1}`)} ${text}  ${view.href ? ctx.style.dim(view.href) : ctx.style.yellow('(no URL)')}${link.title && link.title !== view.label ? ctx.style.dim(`  "${link.title}"`) : ''}`
  }).join('\n')
}

export function linkCommand(spec: LinkCommandSpec) {
  const add = defineCommand({
    meta: { name: 'add', description: 'Add a link: a pasted URL, or a short ref like #42 or ABC-123 (writes via the server)' },
    args: {
      ...globalArgs,
      ...writeArgs,
      ...spec.targetArgs,
      input: { type: 'positional', description: 'URL or short ref', required: true },
      provider: { type: 'string', description: 'Provider id (github, gitlab, ...) when the input could be several' },
      kind: { type: 'string', description: `${KINDS.join(' | ')}: which kind of link, e.g. a short "#42" is an issue or a change (pull/merge request)` },
      title: { type: 'string', description: 'Label to show instead of the derived one' },
    },
    async run({ args }) {
      const ctx = createContext(args)
      const { scope, ...ref } = spec.item(ctx, args)
      const target = ctx.core.linkTarget(scope, ref)
      const result = await explainAmbiguity(() => ctx.core.addLinkTo(target, args.input, { provider: args.provider, kind: parseKind(args.kind), title: args.title }))
      const { view, text } = describeLink(result.link)
      emit(ctx.json, result, () => result.added
        ? `${ctx.style.green('✓')} linked ${text} to ${target.name}${view.href ? `\n  ${ctx.style.dim(view.href)}` : ctx.style.yellow('\n  (no URL: the project has no repo to expand it against)')}`
        : `${text} is already linked to ${target.name} (nothing changed)`)
    },
  })

  const remove = defineCommand({
    meta: { name: 'remove', description: 'Remove a link, named by @N (position in `link list`), URL, ref, label, or title (writes via the server)' },
    args: {
      ...globalArgs,
      ...writeArgs,
      ...spec.targetArgs,
      link: { type: 'positional', description: '@N, URL, ref, label, or title of the link to remove', required: true },
    },
    async run({ args }) {
      const ctx = createContext(args)
      const { scope, ...ref } = spec.item(ctx, args)
      const target = ctx.core.linkTarget(scope, ref)
      const result = await ctx.core.removeLinkFrom(target, args.link)
      emit(ctx.json, result, () => `${ctx.style.green('✓')} removed ${describeLink(result.removed).text} from ${target.name}`)
    },
  })

  const list = defineCommand({
    meta: { name: 'list', description: 'List the links on this item' },
    args: { ...globalArgs, ...spec.targetArgs },
    run({ args }) {
      const ctx = createContext(args)
      const { scope, ...ref } = spec.item(ctx, args)
      const target = ctx.core.linkTarget(scope, ref)
      emit(ctx.json, target.links.map(link => ({ link, view: viewLink(registry, link) })), () =>
        target.links.length ? renderLinks(ctx, target.links) : ctx.style.dim(`no links on ${target.name}`))
    },
  })

  return defineCommand({ meta: { name: 'link', description: spec.description }, subCommands: { add, remove, list } })
}
