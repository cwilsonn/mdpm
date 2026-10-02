import type { Link } from '../links'
import type { Kind, KindSpec, ProviderSpec } from './schema'

// The runtime shape every provider has, whether it came from a declarative file (below) or, later,
// from code. Registry, links, API and UI depend on this interface, never on a provider by name.

export type Fields = Record<string, string>

export interface LinkMatch {
  kind: Kind
  ref: string
  fields: Fields
  display: string
}

export interface ShortMatch {
  kind: Kind
  fields: Fields
}

export interface BuildContext {
  // Host to use when the fields don't carry one (e.g. the host of the project's repo link).
  host?: string
  // User-supplied provider settings (Jira's `host`).
  settings?: Record<string, string>
}

export interface Described {
  label: string
  noun: string
  icon: string
}

export interface Provider {
  id: string
  name: string
  icon: string
  schemes: string[]
  // Host patterns this provider claims (absent: any host).
  hosts?: string[]
  kinds: Partial<Record<Kind, KindSpec>>
  settings: NonNullable<ProviderSpec['settings']>
  // 0: doesn't claim the host; higher is more specific (exact host 3, glob 2, unrestricted 1).
  claims(host: string): number
  parseUrl(url: string): LinkMatch[]
  parseShort(input: string): ShortMatch[]
  fieldsFromRef(kind: Kind, ref: string): Fields | undefined
  buildRef(kind: Kind, fields: Fields): string | undefined
  // undefined when a placeholder can't be filled (missing setting, no host).
  buildUrl(kind: Kind, fields: Fields, ctx?: BuildContext): string | undefined
  describe(link: Link): Described
  inferRepo?(remote: string): { host: string; ref: string } | undefined
}

export const FALLBACK_ICON = 'lucide:link'

export function fill(template: string, fields: Fields) {
  let missing = false
  const out = template.replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = fields[name]
    if (value === undefined) missing = true
    return value ?? ''
  })
  return missing ? undefined : out
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// "{repo}#{number}" -> /^(?<repo>.+?)#(?<number>.+?)$/ : turns a stored ref back into fields.
function refPattern(template: string) {
  const seen = new Set<string>()
  const source = template.split(/(\{\w+\})/).map((part) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1]
    if (!name) return escapeRegex(part)
    if (seen.has(name)) return `\\k<${name}>`
    seen.add(name)
    return `(?<${name}>.+?)`
  }).join('')
  return new RegExp(`^${source}$`)
}

function hostPattern(pattern: string) {
  // `*` stands for exactly one DNS label: "*.atlassian.net" matches "acme.atlassian.net" only.
  return new RegExp(`^${escapeRegex(pattern.toLowerCase()).replace(/\\\*/g, '[^.]+')}$`)
}

export function createProvider(spec: ProviderSpec): Provider {
  const kinds = Object.entries(spec.kinds) as [Kind, KindSpec][]
  const compiled = new Map(kinds.map(([kind, k]) => [kind, {
    spec: k,
    match: new RegExp(k.match),
    short: k.short ? new RegExp(k.short) : undefined,
    ref: refPattern(k.ref),
  }]))
  const hosts = spec.hosts?.map(pattern => ({ exact: !pattern.includes('*'), re: hostPattern(pattern), pattern: pattern.toLowerCase() }))
  const remote = spec.repo ? new RegExp(spec.repo.remote) : undefined

  const provider: Provider = {
    id: spec.id,
    name: spec.name,
    icon: spec.icon,
    schemes: spec.schemes,
    ...(spec.hosts && { hosts: spec.hosts }),
    kinds: spec.kinds,
    settings: spec.settings ?? {},

    claims(host) {
      if (!hosts) return 1
      const h = host.toLowerCase()
      return Math.max(0, ...hosts.map(p => p.re.test(h) ? (p.exact ? 3 : 2) : 0))
    },

    parseUrl(url) {
      // A provider only parses URLs on hosts it claims, so callers can't match the wrong service.
      const host = /^https?:/i.test(url) ? URL.canParse(url) && new URL(url).hostname : undefined
      if (host === false || (host !== undefined && provider.claims(host) === 0)) return []
      const out: LinkMatch[] = []
      for (const [kind, c] of compiled) {
        const fields = c.match.exec(url)?.groups
        if (!fields) continue
        const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Fields
        const ref = fill(c.spec.ref, clean)
        const display = fill(c.spec.display, clean)
        if (ref !== undefined && display !== undefined) out.push({ kind, ref, fields: clean, display })
      }
      return out
    },

    parseShort(input) {
      const out: ShortMatch[] = []
      for (const [kind, c] of compiled) {
        const fields = c.short?.exec(input)?.groups
        if (fields) out.push({ kind, fields: { ...fields } })
      }
      return out
    },

    fieldsFromRef(kind, ref) {
      const groups = compiled.get(kind)?.ref.exec(ref)?.groups
      return groups ? { ...groups } : undefined
    },

    buildRef(kind, fields) {
      const c = compiled.get(kind)
      return c && fill(c.spec.ref, fields)
    },

    buildUrl(kind, fields, ctx = {}) {
      const c = compiled.get(kind)
      if (!c) return undefined
      const settings = Object.fromEntries(Object.entries(provider.settings).flatMap(([name, s]) => {
        const value = ctx.settings?.[name] ?? s.default
        return value === undefined ? [] : [[name, value]]
      }))
      const literalHost = hosts?.find(p => p.exact)?.pattern
      const host = fields.host ?? ctx.host ?? settings.host ?? literalHost
      return fill(c.spec.url, { ...settings, ...(host !== undefined && { host }), ...fields })
    },

    describe(link) {
      const c = link.kind ? compiled.get(link.kind) : undefined
      const fields = c && link.ref ? provider.fieldsFromRef(link.kind!, link.ref) : undefined
      const display = c && fields ? fill(c.spec.display, fields) : undefined
      return {
        label: link.title ?? display ?? link.ref ?? link.url ?? '',
        noun: c?.spec.noun ?? spec.name,
        icon: c?.spec.icon ?? spec.icon,
      }
    },
  }

  if (remote) {
    provider.inferRepo = (input) => {
      const groups = remote.exec(input.trim())?.groups
      if (!groups?.repo || !groups.host || provider.claims(groups.host) === 0) return undefined
      return { host: groups.host.toLowerCase(), ref: groups.repo }
    }
  }
  return provider
}
