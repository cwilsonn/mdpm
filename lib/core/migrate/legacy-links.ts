import { isDeepStrictEqual } from 'node:util'
import matter from 'gray-matter'
import { hasLegacyFields, migrateLegacy, type FileKind, type LegacyMigration } from '../github-links'
import type { Link } from '../links'
import { projectRepoOf } from '../links-compat'

// Migration 001: githubRepo / githubIssues / githubPRs -> `links` (design doc, section 8.4).
// Two halves: a pure decision function over parsed frontmatter, and a text edit that applies the
// decision without reformatting any unrelated frontmatter or touching the body.

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

export { hasLegacyFields, migrateLegacy }
export type { FileKind, LegacyMigration }
