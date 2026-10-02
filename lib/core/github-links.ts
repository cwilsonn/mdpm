import { linkKey, type Link } from './links'
import { isOwnerRepo } from './links-compat'

// Constructors for the GitHub links that legacy fields stand for. Shared by migration 001 and by
// the write path that maps legacy arguments (githubRepo/githubIssues/githubPRs) onto links.

const GITHUB = 'github'

export function repoLink(repo: string): Link {
  return { url: `https://github.com/${repo}`, provider: GITHUB, kind: 'repo', ref: repo }
}

export function numberLink(repo: string | null, kind: 'issue' | 'change', n: number): Link {
  if (!repo) return { provider: GITHUB, kind, ref: `#${n}` }
  return { url: `https://github.com/${repo}/${kind === 'change' ? 'pull' : 'issues'}/${n}`, provider: GITHUB, kind, ref: `${repo}#${n}` }
}

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


// The links a reader should present: the ones stored plus those legacy fields stand for, so a file
// that has not been migrated yet reads like one that has.
export function effectiveLinks(kind: FileKind, data: Record<string, unknown>, projectRepo: string | null): Link[] {
  return migrateLegacy(kind, data, projectRepo).links
}
