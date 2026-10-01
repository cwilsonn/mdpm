import { execFileSync } from 'node:child_process'
import { basename } from 'node:path'

export interface InferredProject {
  slug: string
  via: 'git-remote' | 'directory-name'
  detail: string
}

// Reduce a git remote (or a project's stored `githubRepo`) to a host-independent `owner/repo`
// key so remotes on any host match: GitHub, GitHub Enterprise, GitLab (incl. nested groups),
// Azure DevOps (https and ssh), Bitbucket, or a plain `owner/repo`. The last two path segments
// win, with Azure's `_git` and `v3` marker segments dropped first.
//   git@github.com:owner/repo.git              -> owner/repo
//   https://gitlab.corp.com/group/sub/repo     -> sub/repo
//   https://dev.azure.com/org/proj/_git/repo   -> proj/repo
//   git@ssh.dev.azure.com:v3/org/proj/repo     -> proj/repo
export function normalizeRepoRef(value: string) {
  let path = value.trim()
  // scp-like `user@host:path` has no scheme; URLs have `scheme://[user@]host[:port]/path`.
  const scp = path.match(/^[^/@\s]+@[^/:\s]+:(?!\/\/)(.+)$/)
  if (scp) path = scp[1]!
  else path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i, '')
  const segments = path
    .replace(/[?#].*$/, '')
    .replace(/\.git\/?$/i, '')
    .split('/')
    .filter(Boolean)
    .filter(segment => segment !== '_git' && segment !== 'v3')
  return segments.slice(-2).join('/').toLowerCase()
}

function git(cwd: string, ...args: string[]) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }
  catch {
    return undefined
  }
}

// Which project does this directory belong to? Prefer the git remote (any host) matching a project's
// githubRepo; fall back to the repo (or cwd) directory name matching a project slug.
export function inferProject(cwd: string, projects: { slug: string; githubRepo?: string | null }[]): InferredProject | undefined {
  const remote = git(cwd, 'remote', 'get-url', 'origin')
  if (remote) {
    const repo = normalizeRepoRef(remote)
    const hit = projects.find(p => p.githubRepo && normalizeRepoRef(p.githubRepo) === repo)
    if (hit) return { slug: hit.slug, via: 'git-remote', detail: repo }
  }
  const dirName = basename(git(cwd, 'rev-parse', '--show-toplevel') ?? cwd)
  const hit = projects.find(p => p.slug === dirName)
  return hit ? { slug: hit.slug, via: 'directory-name', detail: dirName } : undefined
}
