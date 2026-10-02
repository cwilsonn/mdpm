import { migrateLegacy, numberLink, repoLink, type FileKind } from './github-links'
import { isOwnerRepo, githubLinks, numberFromRef } from './links-compat'
import { sanitizeLinks, type Link } from './links'
import type { Registry } from './providers/registry'
import { removalVersion } from './version'

// Write-side compatibility: the legacy arguments githubRepo / githubIssues / githubPRs are still
// accepted (CLI flags, MCP tools, the API, the pre-1d UI form) and become links. The legacy keys are
// never written back, so every write moves a file toward the new shape. Pure; used by the server.

export interface LegacyInput {
  githubRepo?: unknown
  githubIssues?: unknown
  githubPRs?: unknown
}

export interface LegacyResult {
  links: Link[]
  // Legacy frontmatter keys the caller must delete from the file.
  dropKeys: string[]
  notices: string[]
  problems: string[]
}

const deprecated = (field: string, use: string) => `${field} is deprecated; use ${use}. Removal planned for ${removalVersion()}.`

// "Replace the list" semantics, but links already present for a kept number are left untouched
// (title, URL), so re-saving an unchanged form never rewrites them.
function replaceNumbers(links: Link[], kind: 'issue' | 'change', numbers: number[], repo: string | null) {
  const wanted = new Set(numbers)
  const scoped = (l: Link) => l.provider === 'github' && l.kind === kind && typeof l.ref === 'string' && numberFromRef(l.ref, repo) !== undefined
  const kept: Link[] = []
  const have = new Set<number>()
  for (const l of links) {
    if (!scoped(l)) { kept.push(l); continue }
    const n = numberFromRef(l.ref!, repo)!
    if (wanted.has(n) && !have.has(n)) { kept.push(l); have.add(n) }
  }
  for (const n of numbers) if (!have.has(n)) { have.add(n); kept.push(numberLink(repo, kind, n)) }
  return kept
}

export function applyLegacyInput(kind: 'task' | 'project', links: Link[], input: LegacyInput, projectRepo: string | null): LegacyResult {
  const out: LegacyResult = { links, dropKeys: [], notices: [], problems: [] }

  if (kind === 'project' && input.githubRepo !== undefined) {
    const value = input.githubRepo
    out.dropKeys.push('githubRepo')
    out.notices.push(deprecated('githubRepo', 'links (kind repo)'))
    if (value !== null && value !== '' && !isOwnerRepo(value)) out.problems.push('githubRepo must be "owner/name"')
    else {
      const wanted = value ? String(value) : null
      const existing = githubLinks(out.links, 'repo') as Link[]
      if (!(wanted && existing.length === 1 && existing[0]!.ref === wanted)) {
        out.links = [...out.links.filter(l => !existing.includes(l)), ...(wanted ? [repoLink(wanted)] : [])]
      }
    }
  }

  if (kind === 'task') {
    for (const [key, linkKind] of [['githubIssues', 'issue'], ['githubPRs', 'change']] as const) {
      const value = input[key]
      if (value === undefined) continue
      out.dropKeys.push(key)
      out.notices.push(deprecated(key, 'links'))
      const numbers = value === null ? [] : value
      if (!Array.isArray(numbers) || !numbers.every(n => Number.isInteger(n) && n > 0)) {
        out.problems.push(`${key} must be a list of positive integers`)
        continue
      }
      if (numbers.length && !projectRepo) out.notices.push(`${key}: the project has no GitHub repo, so ${numbers.map(n => `#${n}`).join(', ')} are stored as links without a URL.`)
      out.links = replaceNumbers(out.links, linkKind, numbers as number[], projectRepo)
    }
  }
  return out
}


export interface LinkWrite {
  // The complete links list to store (empty = remove the key); undefined when the request didn't touch links.
  links?: Link[]
  // Frontmatter keys to delete: the legacy keys this write replaced or folded into links.
  dropKeys: string[]
  notices: string[]
  problems: string[]
}

// Plan how a create/update request changes a file's links.
//  - `body.links` replaces the whole (effective) list; legacy arguments then edit it on top.
//  - Any write that touches links first folds the file's own legacy fields in, so a client that
//    read the effective list and sent it back loses nothing.
//  - A request that touches neither leaves the file alone (no surprise migrations on a status change).
export function planLinkWrite(registry: Registry, kind: FileKind, data: Record<string, unknown>, body: Record<string, unknown>, projectRepo: string | null): LinkWrite {
  const legacyKeys = kind === 'doc' ? [] : kind === 'project' ? ['githubRepo'] : ['githubIssues', 'githubPRs']
  const legacyGiven = legacyKeys.some(k => body[k] !== undefined)
  if (body.links === undefined && !legacyGiven) return { dropKeys: [], notices: [], problems: [] }

  const migration = migrateLegacy(kind, data, projectRepo)
  const out: LinkWrite = { dropKeys: [...migration.remove], notices: [], problems: [] }
  let links = migration.links

  if (body.links !== undefined) {
    if (body.links === null) links = []
    else {
      const clean = sanitizeLinks(registry, body.links)
      out.problems.push(...clean.problems)
      links = clean.links
    }
  }
  if (legacyGiven && kind !== 'doc') {
    const legacy = applyLegacyInput(kind, links, body, projectRepo)
    links = legacy.links
    out.dropKeys.push(...legacy.dropKeys)
    out.notices.push(...legacy.notices)
    out.problems.push(...legacy.problems)
  }
  out.links = links
  return out
}
