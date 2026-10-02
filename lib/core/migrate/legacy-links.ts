import { isDeepStrictEqual } from 'node:util'
import matter from 'gray-matter'
import { linkKey, type Link } from '../links'
import { isOwnerRepo, projectRepoOf } from '../links-compat'

// Migration 001: githubRepo / githubIssues / githubPRs -> `links` (design doc, section 8.4).
// Two halves: a pure decision function over parsed frontmatter, and a text edit that applies the
// decision without reformatting any unrelated frontmatter or touching the body.

export type FileKind = 'project' | 'task' | 'doc'

export interface LegacyMigration {
  // Legacy keys to delete from the frontmatter.
  remove: string[]
  // Links this migration creates (already de-duplicated against existing ones).
  added: Link[]
  // The complete links list to write when `added` is non-empty (existing + added).
  links: Link[]
  // Human-readable descriptions of each change, for the report.
  changes: string[]
  // Things that could not be converted exactly: reported, never guessed.
  unresolved: string[]
}

const LEGACY_KEYS = ['githubRepo', 'githubIssues', 'githubPRs'] as const

export function hasLegacyFields(data: Record<string, unknown>) {
  return LEGACY_KEYS.some(k => k in data)
}

const GITHUB = 'github'

function repoLink(repo: string): Link {
  return { url: `https://github.com/${repo}`, provider: GITHUB, kind: 'repo', ref: repo }
}

function numberLink(repo: string | null, kind: 'issue' | 'change', n: number): Link {
  if (!repo) return { provider: GITHUB, kind, ref: `#${n}` }
  return { url: `https://github.com/${repo}/${kind === 'change' ? 'pull' : 'issues'}/${n}`, provider: GITHUB, kind, ref: `${repo}#${n}` }
}

const describe = (l: Link) => `${l.kind} ${l.ref}${l.url ? '' : ' (unresolved)'}`

// `projectRepo` is the owning project's repo, from its legacy field or its repo link.
export function migrateLegacy(kind: FileKind, data: Record<string, unknown>, projectRepo: string | null): LegacyMigration {
  const out: LegacyMigration = { remove: [], added: [], links: [], changes: [], unresolved: [] }
  const existing = (Array.isArray(data.links) ? data.links : []) as Link[]
  const seen = new Set(existing.map(linkKey))
  const add = (link: Link) => {
    if (seen.has(linkKey(link))) return false
    seen.add(linkKey(link))
    out.added.push(link)
    return true
  }

  if (kind === 'project' && 'githubRepo' in data) {
    const repo = data.githubRepo
    if (isOwnerRepo(repo)) {
      out.remove.push('githubRepo')
      out.changes.push(add(repoLink(repo)) ? `githubRepo ${repo} -> links: repo ${repo}` : `githubRepo ${repo} (already a link; field removed)`)
    }
    else if (repo === null || repo === undefined || repo === '') {
      out.remove.push('githubRepo')
      out.changes.push('githubRepo (empty; removed)')
    }
    else {
      out.unresolved.push(`githubRepo ${JSON.stringify(repo)} is not "owner/name"; left in place`)
    }
  }

  if (kind === 'task') {
    for (const [key, linkKind] of [['githubIssues', 'issue'], ['githubPRs', 'change']] as const) {
      if (!(key in data)) continue
      const value = data[key]
      if (value === null || value === undefined) {
        out.remove.push(key)
        out.changes.push(`${key} (empty; removed)`)
        continue
      }
      if (!Array.isArray(value) || !value.every(n => Number.isInteger(n) && n > 0)) {
        out.unresolved.push(`${key} ${JSON.stringify(value)} has entries that are not positive integers; left in place`)
        continue
      }
      out.remove.push(key)
      if (value.length === 0) {
        out.changes.push(`${key} (empty; removed)`)
        continue
      }
      for (const n of value as number[]) {
        const link = numberLink(projectRepo, linkKind, n)
        if (!projectRepo) out.unresolved.push(`${key} ${n}: the project has no GitHub repo, so ${describe(link)} has no URL`)
        out.changes.push(add(link) ? `${key} ${n} -> links: ${describe(link)}` : `${key} ${n} (already a link; removed)`)
      }
    }
  }

  // Empty legacy fields (`githubIssues: []`, which the API still writes on create) are harmless and
  // are not a reason to touch a file. They are only dropped when the file changes for another reason.
  const meaningful = out.added.length > 0 || out.unresolved.length > 0 || out.changes.some(c => !c.endsWith('(empty; removed)'))
  if (!meaningful) return { remove: [], added: [], links: existing, changes: [], unresolved: [] }

  out.links = [...existing, ...out.added]
  return out
}

// ── Frontmatter text editing ──────────────────────────────────────────────────

const quote = (s: string) => /[\r\n]/.test(s) ? JSON.stringify(s) : `'${s.replace(/'/g, "''")}'`
const scalar = (v: unknown) => typeof v === 'string' ? quote(v) : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)

export function emitLinks(links: Link[]) {
  const order = ['url', 'provider', 'kind', 'ref', 'title']
  const lines = ['links:']
  for (const link of links) {
    const keys = Object.keys(link).sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    keys.forEach((k, i) => lines.push(`  ${i === 0 ? '- ' : '  '}${k}: ${scalar((link as Record<string, unknown>)[k])}`))
  }
  return lines
}

// A top-level key's block: its line, then every following line that is indented or a "- " item.
function blockRange(lines: string[], key: string) {
  const start = lines.findIndex(l => l === `${key}:` || l.startsWith(`${key}: `) || l.startsWith(`${key}:\t`))
  if (start < 0) return undefined
  let end = start + 1
  while (end < lines.length && /^(\s|-(\s|$))/.test(lines[end]!)) end++
  return [start, end] as const
}

export class FrontmatterError extends Error {
  override name = 'FrontmatterError'
}

// Apply a LegacyMigration to a file's text. Only the legacy keys and the links block change; every
// other line, and the body, is byte-identical. The result is re-parsed and compared with the
// expected data, so an unusual YAML shape fails loudly here instead of being written wrong.
export function applyToText(text: string, migration: LegacyMigration): string {
  if (text.includes('\r')) throw new FrontmatterError('CRLF line endings are not supported')
  const open = text.startsWith('---\n') ? 4 : -1
  const close = open < 0 ? -1 : text.indexOf('\n---', open - 1)
  if (open < 0 || close < 0) throw new FrontmatterError('no frontmatter block found')
  const afterClose = close + 4
  if (text[afterClose] !== undefined && text[afterClose] !== '\n') throw new FrontmatterError('malformed frontmatter delimiter')

  const before = matter(text)
  const lines = text.slice(open, close).split('\n')
  const drop = [...migration.remove, ...(migration.added.length ? ['links'] : [])]
  for (const key of drop) {
    const range = blockRange(lines, key)
    if (range) lines.splice(range[0], range[1] - range[0])
  }
  if (migration.added.length) lines.push(...emitLinks(migration.links))
  const next = `---\n${lines.join('\n')}${text.slice(close)}`

  const expected = Object.fromEntries(Object.entries(before.data).filter(([k]) => !drop.includes(k)))
  if (migration.added.length) expected.links = migration.links
  const after = matter(next)
  if (!isDeepStrictEqual(after.data, expected)) throw new FrontmatterError('the edited frontmatter does not parse to the expected data')
  if (after.content !== before.content) throw new FrontmatterError('the body changed')
  return next
}

export { projectRepoOf }
