import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export interface InferredProject {
  slug: string
  via: 'marker' | 'git-remote' | 'directory-name'
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

export const MARKER_FILE = '.mdpm'

export function git(cwd: string, ...args: string[]) {
  try {
    return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  }
  catch {
    return undefined
  }
}

export const gitToplevel = (cwd: string) => git(cwd, 'rev-parse', '--show-toplevel')
export const gitOriginUrl = (cwd: string) => git(cwd, 'remote', 'get-url', 'origin')

// Add a pattern to the repo's local `.git/info/exclude` so a generated file is never committed.
export function excludeLocally(root: string, pattern: string): boolean {
  const rel = git(root, 'rev-parse', '--git-path', 'info/exclude')
  if (!rel) return false
  const file = resolve(root, rel)
  const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (current.split('\n').some(line => line.trim() === pattern)) return false
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, `${current === '' || current.endsWith('\n') ? '' : '\n'}${pattern}\n`)
  return true
}

// `.mdpm` holds `project: <slug>` (or just the slug); `#` starts a comment.
export function parseMarker(text: string) {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim()
    if (!line) continue
    const slug = line.match(/^project\s*:\s*(\S+)$/i)?.[1] ?? (/^[a-z0-9][a-z0-9-]*$/i.test(line) ? line : undefined)
    if (slug) return slug
  }
  return undefined
}

// Nearest `.mdpm` marker from `cwd` up to the git toplevel (or just `cwd` outside a repo).
export function readMarker(cwd: string): string | undefined {
  const stop = gitToplevel(cwd) ?? cwd
  for (let dir = cwd; ; dir = dirname(dir)) {
    const file = join(dir, MARKER_FILE)
    if (existsSync(file)) return parseMarker(readFileSync(file, 'utf8'))
    if (dir === stop || dirname(dir) === dir) return undefined
  }
}

// Which project does this directory belong to? An explicit `.mdpm` marker wins; then the git remote
// (any host) matching a project's githubRepo; then the repo (or cwd) directory name matching a slug.
export function inferProject(cwd: string, projects: { slug: string; githubRepo?: string | null }[]): InferredProject | undefined {
  const marked = readMarker(cwd)
  if (marked && projects.some(p => p.slug === marked)) return { slug: marked, via: 'marker', detail: MARKER_FILE }
  const remote = gitOriginUrl(cwd)
  if (remote) {
    const repo = normalizeRepoRef(remote)
    const hit = projects.find(p => p.githubRepo && normalizeRepoRef(p.githubRepo) === repo)
    if (hit) return { slug: hit.slug, via: 'git-remote', detail: repo }
  }
  const dirName = basename(gitToplevel(cwd) ?? cwd)
  const hit = projects.find(p => p.slug === dirName)
  return hit ? { slug: hit.slug, via: 'directory-name', detail: dirName } : undefined
}
