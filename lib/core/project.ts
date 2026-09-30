import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

export interface InferredProject {
  slug: string
  via: 'github-remote' | 'directory-name'
  detail: string
}

// `git@github.com:owner/repo.git`, `https://github.com/owner/repo`, or plain `owner/repo`.
export function normalizeGithubRepo(value: string) {
  const match = value.trim().match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i)
  return (match?.[1] ?? value.trim()).toLowerCase()
}

function git(cwd: string, ...args: string[]) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }
  catch {
    return undefined
  }
}

// Which project does this directory belong to? Prefer the git remote matching a project's
// githubRepo; fall back to the repo (or cwd) directory name matching a project slug.
export function inferProject(cwd: string, projects: { slug: string; githubRepo?: string | null }[]): InferredProject | undefined {
  const remote = git(cwd, 'remote', 'get-url', 'origin')
  if (remote) {
    const repo = normalizeGithubRepo(remote)
    const hit = projects.find(p => p.githubRepo && normalizeGithubRepo(p.githubRepo) === repo)
    if (hit) return { slug: hit.slug, via: 'github-remote', detail: repo }
  }
  const dirName = basename(git(cwd, 'rev-parse', '--show-toplevel') ?? cwd)
  const hit = projects.find(p => p.slug === dirName)
  return hit ? { slug: hit.slug, via: 'directory-name', detail: dirName } : undefined
}
