import { z } from 'zod/v4'
import { FALLBACK_ICON, type Fields, type Provider } from './providers/provider'
import type { Registry } from './providers/registry'
import { KINDS, placeholders, type Kind } from './providers/schema'

// Links: the service-agnostic way a task or project points at the outside world. A URL is the
// universal denominator; a provider (GitHub, GitLab, Jira...) only adds structure on top.

export const MAX_LINKS = 50
export const MAX_INPUT = 2048
export const MAX_TITLE = 200

const DEFAULT_SCHEMES = ['https', 'http', 'mailto']
// Never renderable as a link, whatever a provider declares.
const FORBIDDEN_SCHEMES = new Set(['javascript', 'data', 'file', 'vbscript', 'blob', 'about'])
const TRACKING_PARAM = /^(utm_.+|fbclid|gclid)$/i

export const LinkSchema = z.object({
  url: z.string().min(1).max(MAX_INPUT).optional(),
  provider: z.string().regex(/^[a-z][a-z0-9-]*$/).optional(),
  kind: z.enum(KINDS).optional(),
  ref: z.string().min(1).max(MAX_INPUT).optional(),
  title: z.string().min(1).max(MAX_TITLE).optional(),
}).strict().superRefine((link, ctx) => {
  if (link.kind && !link.provider) ctx.addIssue({ code: 'custom', path: ['kind'], message: 'kind requires a provider' })
  if (link.ref && !(link.provider && link.kind)) ctx.addIssue({ code: 'custom', path: ['ref'], message: 'ref requires a provider and a kind' })
  // `url` may only be omitted for an unresolved link: provider + kind + ref (e.g. "#42" with no repo).
  if (!link.url && !(link.provider && link.kind && link.ref)) ctx.addIssue({ code: 'custom', path: ['url'], message: 'url is required (unless provider, kind and ref are all set)' })
})

export const LinksSchema = z.array(LinkSchema).max(MAX_LINKS)

export type Link = z.infer<typeof LinkSchema>

export type LinkErrorCode = 'invalid' | 'unsafe' | 'ambiguous' | 'unresolvable'

export class LinkError extends Error {
  override name = 'LinkError'
  constructor(readonly code: LinkErrorCode, message: string) {
    super(message)
  }
}

const schemeOf = (url: string) => /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]?.toLowerCase()

export function isSafeScheme(url: string, allowed: Iterable<string> = DEFAULT_SCHEMES) {
  const scheme = schemeOf(url)
  return !!scheme && !FORBIDDEN_SCHEMES.has(scheme) && new Set([...DEFAULT_SCHEMES, ...allowed]).has(scheme)
}

// Canonical form so the same link isn't stored twice: lower-case host (URL does it), no fragment,
// no tracking parameters, no trailing slash (except the root). Non-http schemes are only trimmed.
export function normalizeUrl(input: string, allowedSchemes: Iterable<string> = DEFAULT_SCHEMES) {
  const raw = input.trim()
  if (!raw || raw.length > MAX_INPUT) throw new LinkError('invalid', `a link must be 1 to ${MAX_INPUT} characters`)
  const scheme = schemeOf(raw)
  if (!scheme) throw new LinkError('invalid', `"${raw}" is not a URL (no scheme)`)
  if (!isSafeScheme(raw, allowedSchemes)) throw new LinkError('unsafe', `the "${scheme}:" scheme is not allowed in links`)
  if (scheme !== 'http' && scheme !== 'https') return raw

  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new LinkError('invalid', `"${raw}" is not a valid URL`)
  }
  if (url.username || url.password) throw new LinkError('invalid', 'a link must not contain credentials')
  url.hash = ''
  for (const key of [...url.searchParams.keys()]) if (TRACKING_PARAM.test(key)) url.searchParams.delete(key)
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '') || '/'
  return url.toString()
}

// Two links are the same link when provider + kind + ref agree, else when their normalized URLs do.
export function linkKey(link: Link) {
  return link.provider && link.kind && link.ref ? `${link.provider}|${link.kind}|${link.ref}` : `url|${link.url ?? ''}`
}

export function addLink(links: readonly Link[], link: Link): { links: Link[]; added: boolean } {
  if (links.some(l => linkKey(l) === linkKey(link))) return { links: [...links], added: false }
  if (links.length >= MAX_LINKS) throw new LinkError('invalid', `at most ${MAX_LINKS} links per item`)
  return { links: [...links, link], added: true }
}

export function removeLink(links: readonly Link[], key: string) {
  return links.filter(l => linkKey(l) !== key)
}

export interface ResolveContext {
  // Repo links of the item's scope (task, project, ...), used to expand "#42".
  repos?: readonly Link[]
  // Per-provider settings from config, e.g. { jira: { host: 'acme.atlassian.net' } }.
  settings?: Record<string, Record<string, string>>
}

export interface ResolveOptions {
  provider?: string
  kind?: Kind
  title?: string
}

const withTitle = (link: Link, title?: string): Link => title ? { ...link, title } : link
const name = (provider: Provider, kind: Kind) => `${provider.id}.${kind}`

function resolveUrl(registry: Registry, input: string, opts: ResolveOptions): Link {
  const url = normalizeUrl(input, registry.schemes())
  const host = /^https?:/.test(url) ? new URL(url).hostname : undefined
  const hits = host
    ? registry.providers
        .filter(p => !opts.provider || p.id === opts.provider)
        .flatMap(p => p.parseUrl(url).filter(m => !opts.kind || m.kind === opts.kind).map(m => ({ provider: p, match: m, rank: p.claims(host) })))
        .filter(h => h.rank > 0)
    : []
  const best = Math.max(0, ...hits.map(h => h.rank))
  const top = hits.filter(h => h.rank === best)

  if (top.length > 1) {
    throw new LinkError('ambiguous', `${url} fits ${top.map(h => name(h.provider, h.match.kind)).sort().join(' and ')}; specify a provider (and kind) to choose`)
  }
  if (top.length === 0) {
    if (opts.provider || opts.kind) throw new LinkError('invalid', `${url} doesn't match ${[opts.provider, opts.kind].filter(Boolean).join('.')}`)
    return withTitle({ url }, opts.title)
  }
  const { provider, match } = top[0]!
  return withTitle({ url, provider: provider.id, kind: match.kind, ref: match.ref }, opts.title)
}

// "#42" / "ABC-123": expand with what the scope knows (its repo link, provider settings).
function resolveShort(registry: Registry, input: string, ctx: ResolveContext, opts: ResolveOptions): Link {
  const text = input.trim()
  const candidates: { provider: Provider; kind: Kind; url: string; ref: string }[] = []
  const why: string[] = []
  let ambiguousRepo = false

  for (const provider of registry.providers) {
    if (opts.provider && provider.id !== opts.provider) continue
    for (const short of provider.parseShort(text)) {
      if (opts.kind && short.kind !== opts.kind) continue
      const spec = provider.kinds[short.kind]!
      const fields: Fields = { ...short.fields }
      let host: string | undefined
      const settings = ctx.settings?.[provider.id]

      const needed = placeholders(spec.url).filter(n => n !== 'host' && !(n in provider.settings) && !(n in fields))
      if (needed.length) {
        const repos = (ctx.repos ?? []).filter(l => l.provider === provider.id && l.kind === 'repo' && l.ref)
        const found = repos.map(l => ({ link: l, fields: provider.fieldsFromRef('repo', l.ref!) })).filter(r => r.fields)
        if (found.length > 1) { ambiguousRepo = true; why.push(`${name(provider, short.kind)}: several repos are linked, so "${text}" is ambiguous`); continue }
        if (found.length === 0) { why.push(`${name(provider, short.kind)}: needs a linked ${provider.name} repo to expand "${text}"`); continue }
        Object.assign(fields, found[0]!.fields)
        const repoUrl = found[0]!.link.url
        if (repoUrl && /^https?:/.test(repoUrl)) host = new URL(repoUrl).host
      }
      const url = provider.buildUrl(short.kind, fields, { host, settings })
      const ref = provider.buildRef(short.kind, fields)
      if (url === undefined || ref === undefined) {
        const missing = Object.entries(provider.settings).filter(([n, s]) => s.required && !settings?.[n] && s.default === undefined).map(([n]) => n)
        why.push(`${name(provider, short.kind)}: needs the ${provider.name} setting ${missing.join(', ') || 'for its host'}`)
        continue
      }
      candidates.push({ provider, kind: short.kind, url: normalizeUrl(url, registry.schemes()), ref })
    }
  }

  if (candidates.length > 1) {
    throw new LinkError('ambiguous', `"${text}" could be ${candidates.map(c => name(c.provider, c.kind)).sort().join(' or ')}; specify a provider and/or kind`)
  }
  if (candidates.length === 0) {
    throw new LinkError(ambiguousRepo ? 'ambiguous' : 'unresolvable', why.length ? why.join('; ') : `"${text}" is not a URL or a known short reference`)
  }
  const [c] = candidates
  return withTitle({ url: c!.url, provider: c!.provider.id, kind: c!.kind, ref: c!.ref }, opts.title)
}

// Turn what a person typed (a pasted URL or a short ref) into a stored link.
export function resolveLink(registry: Registry, input: string, ctx: ResolveContext = {}, opts: ResolveOptions = {}): Link {
  if (opts.title && opts.title.length > MAX_TITLE) throw new LinkError('invalid', `title is longer than ${MAX_TITLE} characters`)
  const text = input.trim()
  if (text.length > MAX_INPUT) throw new LinkError('invalid', `a link must be 1 to ${MAX_INPUT} characters`)
  return schemeOf(text) ? resolveUrl(registry, text, opts) : resolveShort(registry, text, ctx, opts)
}

export interface LinkView {
  label: string
  noun: string
  icon: string
  // null when the link has no safe, resolvable URL: render as plain text.
  href: string | null
  provider?: string
  kind?: Kind
}

function plainLabel(url: string) {
  if (/^https?:/.test(url)) {
    const u = new URL(url)
    return u.pathname === '/' ? u.host : `${u.host}${u.pathname}`
  }
  return url.replace(/^[a-z][a-z0-9+.-]*:/i, '')
}

// What a surface renders for a link, computed once here so the browser carries no provider logic.
export function viewLink(registry: Registry, link: Link): LinkView {
  const provider = link.provider ? registry.get(link.provider) : undefined
  let href = link.url ?? null
  if (!href && provider && link.kind && link.ref) {
    const fields = provider.fieldsFromRef(link.kind, link.ref)
    href = (fields && provider.buildUrl(link.kind, fields)) ?? null
  }
  if (href && !isSafeScheme(href, registry.schemes())) href = null

  const base = { href, ...(link.provider && { provider: link.provider }), ...(link.kind && { kind: link.kind }) }
  if (provider) return { ...provider.describe(link), ...base }
  const mail = link.url?.startsWith('mailto:')
  return {
    label: link.title ?? (link.url ? plainLabel(link.url) : link.ref ?? ''),
    noun: mail ? 'Email' : 'Link',
    icon: mail ? 'lucide:mail' : FALLBACK_ICON,
    ...base,
  }
}

// Every problem with a list of links, "links[2].kind: ..." style, for write paths to report.
export function validateLinks(links: unknown, allowedSchemes: Iterable<string> = DEFAULT_SCHEMES): string[] {
  const parsed = LinksSchema.safeParse(links)
  if (!parsed.success) return parsed.error.issues.map(i => `links${i.path.map(p => typeof p === 'number' ? `[${p}]` : `.${String(p)}`).join('')}: ${i.message}`)
  return parsed.data.flatMap((l, i) => l.url && !isSafeScheme(l.url, allowedSchemes) ? [`links[${i}].url: the "${schemeOf(l.url) ?? '?'}:" scheme is not allowed`] : [])
}

// What a write path stores: validated, URLs normalized, duplicates dropped (first one wins).
export function sanitizeLinks(registry: Registry, input: unknown): { links: Link[]; problems: string[] } {
  const schemes = registry.schemes()
  const problems = validateLinks(input, schemes)
  if (problems.length) return { links: [], problems }
  const out: Link[] = []
  const seen = new Set<string>()
  ;(input as Link[]).forEach((raw, i) => {
    let link = raw
    if (raw.url) {
      try {
        link = { ...raw, url: normalizeUrl(raw.url, schemes) }
      }
      catch (err) {
        problems.push(`links[${i}].url: ${(err as Error).message}`)
        return
      }
    }
    const key = linkKey(link)
    if (seen.has(key)) return
    seen.add(key)
    out.push(link)
  })
  return { links: problems.length ? [] : out, problems }
}

// ── Finding links on an item ─────────────────────────────────────────────────

// What a person typed to point at one of an item's links: "@2" (position in `link list`), a URL, a
// ref ("acme/widgets#42"), the displayed label ("#42"), or the title. Several matches are returned
// so the caller can report the ambiguity instead of removing the wrong one.
export function findLinks(registry: Registry, links: readonly Link[], target: string): Link[] {
  const t = target.trim()
  const index = /^@(\d+)$/.exec(t)
  if (index) {
    const link = links[Number(index[1]) - 1]
    return link ? [link] : []
  }
  let url: string | undefined
  try {
    url = normalizeUrl(t, registry.schemes())
  }
  catch {}
  return links.filter(l => (url !== undefined && l.url === url) || l.ref === t || l.title === t || viewLink(registry, l).label === t)
}

// `--linked provider[:kind[:ref]]`: tasks that have a link matching every part given.
export interface LinkedFilter {
  provider?: string
  kind?: Kind
  ref?: string
}

export function parseLinkedFilter(spec: string): LinkedFilter {
  const [provider, kind, ...ref] = spec.split(':')
  if (kind && !(KINDS as readonly string[]).includes(kind)) throw new LinkError('invalid', `--linked: kind must be one of ${KINDS.join(', ')} (got "${kind}")`)
  const filter: LinkedFilter = {}
  if (provider) filter.provider = provider
  if (kind) filter.kind = kind as Kind
  if (ref.length) filter.ref = ref.join(':')
  if (!filter.provider && !filter.kind && !filter.ref) throw new LinkError('invalid', '--linked needs provider[:kind[:ref]]')
  return filter
}

export const matchesLinked = (links: readonly Link[], f: LinkedFilter) =>
  links.some(l => (!f.provider || l.provider === f.provider) && (!f.kind || l.kind === f.kind) && (!f.ref || l.ref === f.ref))
