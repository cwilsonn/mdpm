import { defineCommand } from 'citty'
import { addLink, builtinRegistry, findLinks, KINDS, LinkError, linkKey, resolveLink, viewLink, type Kind, type Link } from '../lib/core'
import { createContext, globalArgs, writeArgs, type Context } from './context'
import { CliError, emit, ExitCode } from './output'

// `task link`, `project link` and `doc link` share one implementation: each supplies how to find its
// target and how to save a new links list; add/remove/list are the same everywhere.

export interface LinkTarget {
  // "project/slug", for messages
  name: string
  // The item's effective links (stored plus any legacy GitHub fields folded in)
  links: Link[]
  // Repo links of the owning project, used to expand short refs like "#42"
  repos: Link[]
  save(links: Link[]): Promise<unknown>
}

export interface LinkCommandSpec {
  description: string
  // Positional `ref` (and scope flags) that identify the target
  targetArgs: Record<string, any>
  target(ctx: Context, args: any): LinkTarget
}

const registry = builtinRegistry()

export function parseKind(value: unknown): Kind | undefined {
  if (value === undefined) return undefined
  if (!(KINDS as readonly string[]).includes(String(value))) throw new CliError(`--kind: '${value}' is not one of ${KINDS.join(', ')}`, ExitCode.usage)
  return value as Kind
}

// A resolver error that is really "tell me which one you mean" gets the flags that answer it.
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
      const target = spec.target(ctx, args)
      const link = resolveOrExplain(args.input, target.repos, { provider: args.provider, kind: parseKind(args.kind), title: args.title })
      const { links, added } = addLink(target.links, link)
      if (added) await target.save(links)
      const { view, text } = describeLink(link)
      emit(ctx.json, { target: target.name, added, link, view }, () => added
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
      const target = spec.target(ctx, args)
      const found = findLinks(registry, target.links, args.link)
      if (!found.length) throw new CliError(`no link on ${target.name} matches '${args.link}' (see \`link list\`)`, ExitCode.notFound)
      if (found.length > 1) {
        throw new CliError(`'${args.link}' matches ${found.length} links on ${target.name}: ${found.map(l => describeLink(l).text).join(', ')}; name one by @N or URL`, ExitCode.usage)
      }
      const [gone] = found
      await target.save(target.links.filter(l => linkKey(l) !== linkKey(gone!)))
      emit(ctx.json, { target: target.name, removed: gone }, () => `${ctx.style.green('✓')} removed ${describeLink(gone!).text} from ${target.name}`)
    },
  })

  const list = defineCommand({
    meta: { name: 'list', description: 'List the links on this item' },
    args: { ...globalArgs, ...spec.targetArgs },
    run({ args }) {
      const ctx = createContext(args)
      const target = spec.target(ctx, args)
      emit(ctx.json, target.links.map(link => ({ link, view: viewLink(registry, link) })), () =>
        target.links.length ? renderLinks(ctx, target.links) : ctx.style.dim(`no links on ${target.name}`))
    },
  })

  return defineCommand({ meta: { name: 'link', description: spec.description }, subCommands: { add, remove, list } })
}
