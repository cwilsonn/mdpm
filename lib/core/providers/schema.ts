import { z } from 'zod/v4'

// Declarative provider files (schemaVersion 1). See the mdpm doc "design-links-and-providers".
// zod is authoritative; the JSON Schema in schemas/provider.schema.json is generated from it for
// editor autocomplete and cannot express the regex / template cross-checks done here.

export const KINDS = ['issue', 'change', 'doc', 'message', 'repo', 'url'] as const
export type Kind = typeof KINDS[number]

const MAX_PATTERN = 300

// Providers may be user-supplied, so cap pattern size (a cheap guard against pathological regexes;
// inputs are length-capped too, see links.ts).
const pattern = z.string().min(1).max(MAX_PATTERN).refine((source) => {
  try {
    new RegExp(source)
    return true
  }
  catch {
    return false
  }
}, 'must be a valid regular expression')

const icon = z.string().regex(/^(lucide|simple-icons):[a-z0-9-]+$/, 'icon must look like "lucide:link" or "simple-icons:github"')
const slug = z.string().regex(/^[a-z][a-z0-9-]*$/, 'lowercase letters, digits and dashes, starting with a letter')
const scheme = z.string().regex(/^[a-z][a-z0-9+.-]*$/, 'lowercase URI scheme, e.g. "https" or "message"')

const KindSpec = z.object({
  noun: z.string().min(1),
  plural: z.string().min(1).optional(),
  icon: icon.optional(),
  display: z.string().min(1),
  url: z.string().min(1),
  // Recognizes a pasted URL; named groups become fields. Optional: a kind without it is never matched
  // from a URL (the generic `git` provider's repo kind is recognized from git remotes only).
  match: pattern.optional(),
  ref: z.string().min(1),
  short: pattern.optional(),
}).strict()

export const ProviderSpec = z.object({
  $schema: z.string().optional(),
  schemaVersion: z.literal(1),
  id: slug,
  name: z.string().min(1),
  icon,
  hosts: z.array(z.string().min(1)).min(1).optional(),
  schemes: z.array(scheme).default(['https', 'http']),
  settings: z.record(slug, z.object({
    description: z.string(),
    required: z.boolean().default(false),
    default: z.string().optional(),
  }).strict()).optional(),
  kinds: z.partialRecord(z.enum(KINDS), KindSpec).refine(kinds => Object.keys(kinds).length > 0, 'at least one kind is required'),
  repo: z.object({ remote: pattern }).strict().optional(),
}).strict().superRefine((spec, ctx) => {
  const settings = new Set(Object.keys(spec.settings ?? {}))
  for (const [kind, k] of Object.entries(spec.kinds)) {
    if (!k) continue
    const at = (field: string) => ['kinds', kind, field]
    // Without `match`, a repo kind's fields come from the provider's git-remote pattern.
    const groups = new Set(k.match ? groupNames(k.match) : kind === 'repo' && spec.repo ? groupNames(spec.repo.remote) : [])
    if (!k.match && !(kind === 'repo' && spec.repo)) ctx.addIssue({ code: 'custom', path: at('match'), message: kind === 'repo' ? '"match" is required unless the provider has repo.remote' : '"match" is required' })
    const refFields = new Set(placeholders(k.ref))
    const check = (field: 'display' | 'ref', allowed: Set<string>) => {
      for (const name of placeholders(k[field])) {
        if (!allowed.has(name)) ctx.addIssue({ code: 'custom', path: at(field), message: `{${name}} is not a named group of "match"` })
      }
    }
    check('display', groups)
    check('ref', groups)
    for (const name of placeholders(k.url)) {
      if (name === 'host' || settings.has(name)) continue
      if (!groups.has(name)) ctx.addIssue({ code: 'custom', path: at('url'), message: `{${name}} is not a named group of "match", a setting, or {host}` })
      // The URL must be rebuildable from the stored ref alone.
      else if (!refFields.has(name)) ctx.addIssue({ code: 'custom', path: at('ref'), message: `must include {${name}} so the URL can be rebuilt from the ref` })
    }
    if (k.short) {
      for (const name of groupNames(k.short)) {
        if (!refFields.has(name)) ctx.addIssue({ code: 'custom', path: at('short'), message: `group "${name}" must appear in "ref"` })
      }
    }
  }
  if (spec.repo && !groupNames(spec.repo.remote).includes('repo')) {
    ctx.addIssue({ code: 'custom', path: ['repo', 'remote'], message: 'must have a named group "repo"' })
  }
})

export type ProviderSpec = z.infer<typeof ProviderSpec>
export type KindSpec = z.infer<typeof KindSpec>

export function placeholders(template: string) {
  return [...template.matchAll(/\{(\w+)\}/g)].map(m => m[1]!)
}

export function groupNames(source: string) {
  return [...source.matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map(m => m[1]!)
}

// What `mdpm providers validate` and the loader show: "path: reason", one per problem.
export function formatIssues(error: z.ZodError) {
  return error.issues.map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
}

export function providerJsonSchema() {
  return z.toJSONSchema(ProviderSpec, { target: 'draft-7', io: 'input' })
}
