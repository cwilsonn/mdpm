import { isDeepStrictEqual } from 'node:util'
import matter from 'gray-matter'

// Migration 002: links leave the frontmatter (audit decision 2026-11-13: no providers, no link fields).
//
// - Tasks and docs: every stored link and every legacy GitHub issue/PR number becomes a markdown line in a
//   `## Links` section at the end of the spec (before any appended notes). The fields are removed.
// - Projects: the repository becomes one `repo:` URL (used to match a git checkout to its project); any other
//   project link goes to a `## Links` section in the project file's body.
//
// Self-contained on purpose: it imports nothing from the link/provider code it replaces, so the whole
// migration can be deleted once every content directory has run it.

export type FileKind = 'project' | 'task' | 'doc'

export const LEGACY_KEYS = ['githubRepo', 'githubIssues', 'githubPRs', 'links'] as const

interface StoredLink {
  url?: unknown
  title?: unknown
  provider?: unknown
  kind?: unknown
  ref?: unknown
}

export interface FileMigration {
  // Frontmatter keys to drop (only those present in the file).
  remove: string[]
  // Projects only: the repository URL to store as `repo`.
  repo?: string
  // Markdown list lines for the `## Links` section (empty: no section).
  lines: string[]
  // Human-readable summary of what changes, and entries that could not become URLs.
  changes: string[]
  unresolved: string[]
}

export class MigrationTextError extends Error {
  override name = 'MigrationTextError'
}

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/

export const hasLegacyKeys = (data: Record<string, unknown>) => LEGACY_KEYS.some(k => k in data)

// A project's repository as a web URL: the legacy `githubRepo` (owner/repo on GitHub) or its `repo` link.
export function repoUrlOf(data: Record<string, unknown>): string | undefined {
  if (typeof data.githubRepo === 'string' && OWNER_REPO.test(data.githubRepo)) return `https://github.com/${data.githubRepo}`
  const links = Array.isArray(data.links) ? data.links as StoredLink[] : []
  const repoLink = links.find(l => l?.kind === 'repo')
  if (typeof repoLink?.url === 'string' && /^https?:\/\//.test(repoLink.url)) return repoLink.url
  if (repoLink?.provider === 'github' && typeof repoLink.ref === 'string' && OWNER_REPO.test(repoLink.ref)) return `https://github.com/${repoLink.ref}`
  return undefined
}

const githubRepoOf = (repoUrl: string | undefined) => /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+?)\/?$/.exec(repoUrl ?? '')?.[1]

// "PR #42" / "Issue #7" for a GitHub URL (with owner/repo when it isn't the project's own repo), else the URL.
function labelFor(url: string, projectRepo: string | undefined) {
  const m = /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(pull|issues)\/(\d+)(?:[/?#].*)?$/.exec(url)
  if (!m) return url
  const noun = m[2] === 'pull' ? 'PR' : 'Issue'
  return m[1] === projectRepo ? `${noun} #${m[3]}` : `${noun} ${m[1]}#${m[3]}`
}

const escapeLabel = (s: string) => s.replace(/([[\]\\])/g, '\\$1').replace(/\s+/g, ' ').trim()

// One stored link as a URL, when it has or implies one. Only GitHub refs need rebuilding: every other
// provider's links in real content carry their URL.
function urlOf(link: StoredLink, projectRepo: string | undefined): string | undefined {
  if (typeof link.url === 'string' && link.url) return link.url
  if (link.provider !== 'github' || typeof link.ref !== 'string') return undefined
  const path = link.kind === 'change' ? 'pull' : link.kind === 'issue' ? 'issues' : undefined
  const m = /^(?:([\w.-]+\/[\w.-]+))?#(\d+)$/.exec(link.ref)
  const repo = m?.[1] ?? projectRepo
  if (!path || !m || !repo) return undefined
  return `https://github.com/${repo}/${path}/${m[2]}`
}

export function planFile(kind: FileKind, data: Record<string, unknown>, projectRepoUrl: string | undefined): FileMigration {
  const remove = LEGACY_KEYS.filter(k => k in data)
  const projectRepo = githubRepoOf(projectRepoUrl)
  const lines: string[] = []
  const changes: string[] = []
  const unresolved: string[] = []
  const seen = new Set<string>()
  const add = (url: string, title?: unknown) => {
    if (seen.has(url)) return
    seen.add(url)
    const label = typeof title === 'string' && title.trim() ? title : labelFor(url, projectRepo)
    lines.push(`- [${escapeLabel(label)}](${url})`)
  }

  let repo: string | undefined
  if (kind === 'project') {
    repo = repoUrlOf(data)
    if (repo) changes.push(`repo: ${repo}`)
  }

  const links = Array.isArray(data.links) ? data.links as StoredLink[] : []
  for (const link of links) {
    if (kind === 'project' && link?.kind === 'repo' && repo) continue
    const url = urlOf(link ?? {}, projectRepo)
    if (url) add(url, link.title)
    else {
      const text = [link?.provider, link?.kind, link?.ref ?? link?.title].filter(v => typeof v === 'string' && v).join(' ')
      const line = `- ${escapeLabel(text || JSON.stringify(link))} (no URL)`
      lines.push(line)
      unresolved.push(`kept as text: ${text || JSON.stringify(link)}`)
    }
  }
  for (const [key, path, noun] of [['githubPRs', 'pull', 'PR'], ['githubIssues', 'issues', 'Issue']] as const) {
    const numbers = Array.isArray(data[key]) ? (data[key] as unknown[]).filter((n): n is number => Number.isInteger(n)) : []
    for (const n of numbers) {
      if (projectRepo) add(`https://github.com/${projectRepo}/${path}/${n}`)
      else {
        lines.push(`- GitHub ${noun} #${n} (no repository to resolve it)`)
        unresolved.push(`kept as text: ${noun} #${n} (project has no GitHub repo)`)
      }
    }
  }
  if (lines.length) changes.push(`${lines.length} link${lines.length > 1 ? 's' : ''} -> ## Links in the body`)
  if (remove.length) changes.push(`remove ${remove.join(', ')}`)
  return { remove, ...(repo && { repo }), lines, changes, unresolved }
}

// ── Text editing ──────────────────────────────────────────────────────────────

const NOTE_START = /(?:^|\n\n---\n)\*\*Note\*\* _\(\d{4}-\d{2}-\d{2} \d{2}:\d{2}\)_/

// A top-level key's block: its line, then every following line that is indented or a "- " item.
function blockRange(lines: string[], key: string) {
  const start = lines.findIndex(l => l === `${key}:` || l.startsWith(`${key}: `) || l.startsWith(`${key}:\t`))
  if (start < 0) return undefined
  let end = start + 1
  while (end < lines.length && /^(\s|-(\s|$))/.test(lines[end]!)) end++
  return [start, end] as const
}

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`

// The body with a `## Links` section added at the end of the spec, before any notes.
export function insertLinks(body: string, lines: string[]) {
  if (!lines.length) return body
  const section = `## Links\n\n${lines.join('\n')}`
  const at = body.search(NOTE_START)
  if (at < 0) return body.trim() ? `${body.trimEnd()}\n\n${section}\n` : `${section}\n`
  const spec = body.slice(0, at)
  const rest = body.slice(at)
  // A body that opens with a note has no separator in front of it; add one after the new section.
  if (!spec.trim()) return `${section}\n\n---\n${rest.replace(/^\n+/, '')}`
  return `${spec.trimEnd()}\n\n${section}${rest}`
}

// Apply a FileMigration to a file's text. Frontmatter lines other than the removed keys stay byte-identical;
// the body only gains the Links section. The result is parsed back and checked, so an unusual file fails
// here instead of being written wrong.
export function applyToText(text: string, migration: FileMigration): string {
  if (text.includes('\r')) throw new MigrationTextError('CRLF line endings are not supported')
  if (!text.startsWith('---\n')) throw new MigrationTextError('no frontmatter block found')
  const close = text.indexOf('\n---', 3)
  if (close < 0) throw new MigrationTextError('no frontmatter block found')
  const afterClose = close + 4
  if (text[afterClose] !== undefined && text[afterClose] !== '\n') throw new MigrationTextError('malformed frontmatter delimiter')

  const before = matter(text)
  const fm = text.slice(4, close).split('\n')
  for (const key of migration.remove) {
    const range = blockRange(fm, key)
    if (range) fm.splice(range[0], range[1] - range[0])
  }
  if (migration.repo) fm.push(`repo: ${quote(migration.repo)}`)

  const bodyStart = text[afterClose] === '\n' ? afterClose + 1 : afterClose
  const body = text.slice(bodyStart)
  const next = `---\n${fm.join('\n')}\n---\n${insertLinks(body, migration.lines)}`

  // Check: frontmatter is the original minus the removed keys (plus repo), the spec only gained the
  // Links section, and the notes are byte-identical.
  const after = matter(next)
  const expected: Record<string, unknown> = Object.fromEntries(Object.entries(before.data).filter(([k]) => !migration.remove.includes(k)))
  if (migration.repo) expected.repo = migration.repo
  if (!isDeepStrictEqual(after.data, expected)) throw new MigrationTextError('the edited frontmatter does not parse to the expected data')
  const notesOf = (s: string) => { const i = s.search(NOTE_START); return i < 0 ? '' : s.slice(i).replace(/^\n\n---\n/, '') }
  if (notesOf(after.content) !== notesOf(before.content)) throw new MigrationTextError('the notes changed')
  const specOf = (s: string) => { const i = s.search(NOTE_START); return (i < 0 ? s : s.slice(0, i)).trim() }
  const wantSpec = migration.lines.length ? [specOf(before.content), `## Links\n\n${migration.lines.join('\n')}`].filter(Boolean).join('\n\n') : specOf(before.content)
  if (specOf(after.content) !== wantSpec) throw new MigrationTextError('the spec changed beyond the Links section')
  return next
}
