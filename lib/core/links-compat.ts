// Bridge between the legacy GitHub fields (githubRepo / githubIssues / githubPRs) and `links`.
// Pure and dependency-free on purpose: the Nitro server imports it directly, and until the UI
// understands links (design doc phase 1d) it keeps showing the legacy shape from either storage form.

interface LinkLike {
  provider?: unknown
  kind?: unknown
  ref?: unknown
}

export interface GithubView {
  githubRepo: string | null
  githubIssues: number[]
  githubPRs: number[]
}

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/

export const isOwnerRepo = (value: unknown): value is string => typeof value === 'string' && OWNER_REPO.test(value)

const githubLinks = (links: unknown, kind: string) =>
  (Array.isArray(links) ? links as LinkLike[] : []).filter(l => l && l.provider === 'github' && l.kind === kind && typeof l.ref === 'string')

// The project's repo: the legacy field when present, else its GitHub repo link.
export function projectRepoOf(data: Record<string, unknown>): string | null {
  if (typeof data.githubRepo === 'string' && data.githubRepo) return data.githubRepo
  return (githubLinks(data.links, 'repo')[0]?.ref as string | undefined) ?? null
}

// "acme/widgets#42" or an unresolved "#42" -> 42, when it belongs to `repo` (or to no repo at all).
function numberFromRef(ref: string, repo: string | null) {
  const m = /^(?:(.+))?#(\d+)$/.exec(ref)
  if (!m || (m[1] && m[1] !== repo)) return undefined
  return Number(m[2])
}

const unique = (numbers: number[]) => [...new Set(numbers)].sort((a, b) => a - b)

// What the UI should see for a task or project, whichever form the file is in.
export function githubView(data: Record<string, unknown>, repo: string | null): GithubView {
  const legacy = (key: string) => Array.isArray(data[key]) ? (data[key] as unknown[]).filter((n): n is number => Number.isInteger(n)) : []
  const fromLinks = (kind: string) => githubLinks(data.links, kind).flatMap((l) => {
    const n = numberFromRef(l.ref as string, repo)
    return n === undefined ? [] : [n]
  })
  return {
    githubRepo: projectRepoOf(data) ?? repo,
    githubIssues: unique([...legacy('githubIssues'), ...fromLinks('issue')]),
    githubPRs: unique([...legacy('githubPRs'), ...fromLinks('change')]),
  }
}
