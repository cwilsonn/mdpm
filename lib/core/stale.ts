import { execFileSync } from 'node:child_process'
import type { ParsedNote } from './notes'

// Staleness check: what task notes claim about commits, cross-checked against the repository.
//
// A task cites commits by hash in its spec or notes. Three findings come out of that:
// - `landed`: an open task cites a commit that is on the default branch, so the work may be done already.
// - `rewritten`: a cited commit is not on the branch, but a commit with the same subject is. Rebase merges
//   rewrite SHAs, so notes written before a merge cite branch SHAs; the finding names the one to cite instead.
// - `unverified`: a done task cites commits, none of which (or their rewritten twins) are on the branch.
// Hashes that don't name a commit in this repository (action pins, other repos, plain hex words) are ignored.

export type StaleKind = 'landed' | 'rewritten' | 'unverified'
export const STALE_KINDS: readonly StaleKind[] = ['landed', 'unverified', 'rewritten']

export interface StaleFinding {
  kind: StaleKind
  project: string
  slug: string
  title: string
  status: string
  /** The hashes as cited in the task. */
  cited: string[]
  /** Short SHAs on the branch: the landed commits, or for `rewritten` the ones to cite instead (same order as `cited`). */
  onBranch: string[]
  /** Subject of the (first) commit concerned. */
  subject?: string
}

export interface CommitInfo { sha: string; subject: string }

// What the check needs from git. `createGitRepo` is the real one; tests pass a stub.
export interface CommitSource {
  /** The branch checked against, as given to git. */
  branch: string
  /** Commits reachable from the branch, newest first. */
  branchCommits(): CommitInfo[]
  /** The commit each abbreviation names; absent when it names no commit (missing, ambiguous, not a commit). */
  resolve(abbrevs: string[]): Map<string, CommitInfo>
}

export interface StaleTask {
  project: string
  slug: string
  title: string
  status: string
  body: string
  notes?: ParsedNote[]
}

// 7 to 40 hex digits standing alone: not inside a slug, word or longer hex run (a `/commit/<sha>` URL counts).
// At least one digit and one letter, so English words made of a-f ("decade", "accede") and plain numbers
// don't become candidates; git has the final say on the rest.
const HASH = /(?<![\w-])[0-9a-f]{7,40}(?![\w-])/g
export function citedHashes(text: string): string[] {
  const found = new Set<string>()
  for (const [hash] of text.matchAll(HASH)) {
    if (/\d/.test(hash) && /[a-f]/.test(hash)) found.add(hash)
  }
  return [...found]
}

const short = (sha: string) => sha.slice(0, 7)

export function checkStaleness(tasks: StaleTask[], git: CommitSource): StaleFinding[] {
  const cited = tasks.map(t => ({ task: t, hashes: citedHashes([t.body, ...(t.notes ?? []).map(n => n.text)].join('\n')) }))
  const commits = git.resolve([...new Set(cited.flatMap(c => c.hashes))])
  if (!commits.size) return []

  const branch = git.branchCommits()
  const onBranch = new Set(branch.map(c => c.sha))
  // Newest first, so a subject used twice maps to its latest commit.
  const bySubject = new Map<string, string>()
  for (const c of branch) if (!bySubject.has(c.subject)) bySubject.set(c.subject, c.sha)

  const findings: StaleFinding[] = []
  for (const { task, hashes } of cited) {
    const base = { project: task.project, slug: task.slug, title: task.title, status: task.status }
    const landed: { hash: string; sha: string; subject: string }[] = []
    const missing: { hash: string; subject: string }[] = []
    const rewritten: { hash: string; sha: string; subject: string }[] = []
    for (const hash of hashes) {
      const commit = commits.get(hash)
      if (!commit) continue
      if (onBranch.has(commit.sha)) {
        landed.push({ hash, sha: commit.sha, subject: commit.subject })
        continue
      }
      const twin = commit.subject ? bySubject.get(commit.subject) : undefined
      if (twin) {
        landed.push({ hash, sha: twin, subject: commit.subject })
        rewritten.push({ hash, sha: twin, subject: commit.subject })
      }
      else missing.push({ hash, subject: commit.subject })
    }
    // One finding per task; `cited[i]` was rewritten as `onBranch[i]`. A branch SHA cited next to its landed
    // twin ("PR merged as …") is fine as it is.
    const citedDirectly = new Set(hashes.map(h => commits.get(h)?.sha).filter(sha => sha && onBranch.has(sha)))
    const toCite = rewritten.filter(r => !citedDirectly.has(r.sha))
    if (toCite.length) {
      findings.push({ kind: 'rewritten', ...base, cited: toCite.map(r => r.hash), onBranch: toCite.map(r => short(r.sha)), subject: toCite[0]!.subject })
    }
    if (task.status !== 'done' && landed.length) {
      findings.push({ kind: 'landed', ...base, cited: landed.map(l => l.hash), onBranch: [...new Set(landed.map(l => short(l.sha)))], subject: landed[0]!.subject })
    }
    if (task.status === 'done' && !landed.length && missing.length) {
      findings.push({ kind: 'unverified', ...base, cited: missing.map(m => m.hash), onBranch: [], subject: missing[0]!.subject })
    }
  }
  const rank = (k: StaleKind) => STALE_KINDS.indexOf(k)
  return findings.sort((a, b) => rank(a.kind) - rank(b.kind) || a.slug.localeCompare(b.slug))
}

function run(cwd: string, args: string[], input?: string) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 256 * 1024 * 1024 })
}

// The branch the work lands on. `origin/HEAD` is not trusted: it is set once at clone time and goes stale.
export function defaultBranch(cwd: string): string | undefined {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      run(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
      return ref
    }
    catch {}
  }
  return undefined
}

// The real commit source: three git processes however many hashes are cited.
export function createGitRepo(cwd: string, branch: string): CommitSource {
  const parse = (out: string) => out.split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t')
    return { sha: line.slice(0, tab), subject: line.slice(tab + 1) }
  })
  return {
    branch,
    branchCommits: () => parse(run(cwd, ['log', '--format=%H%x09%s', branch, '--'])),
    resolve(abbrevs) {
      const result = new Map<string, CommitInfo>()
      if (!abbrevs.length) return result
      // One line out per line in: `<sha> commit`, or `<input> missing` / `<input> ambiguous`.
      const out = run(cwd, ['cat-file', '--batch-check=%(objectname) %(objecttype)'], abbrevs.map(a => `${a}^{commit}`).join('\n') + '\n').split('\n')
      const shas = new Map<string, string>()
      abbrevs.forEach((abbrev, i) => {
        const [sha, type] = (out[i] ?? '').split(' ')
        if (type === 'commit' && sha) shas.set(abbrev, sha)
      })
      if (!shas.size) return result
      const subjects = new Map(parse(run(cwd, ['log', '--no-walk=unsorted', '--format=%H%x09%s', ...new Set(shas.values()), '--'])).map(c => [c.sha, c.subject]))
      for (const [abbrev, sha] of shas) result.set(abbrev, { sha, subject: subjects.get(sha) ?? '' })
      return result
    },
  }
}
