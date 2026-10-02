import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { REPO_ROOT } from './config'
import { NotFoundError } from './errors'
import type { Link } from './links'
import type { Ops } from './ops'
import { builtinRegistry } from './providers/registry'
import { installHooks } from './hooks'
import { excludeLocally, gitOriginUrl, gitToplevel, inferProject, MARKER_FILE, readMarker } from './project'

const BLOCK_START = '<!-- mdpm:work-logging:start -->'
const BLOCK_END = '<!-- mdpm:work-logging:end -->'

export type BlockAction = 'created' | 'appended' | 'updated' | 'unchanged'

// The reusable work-logging block (templates/work-logging.md) with the project slug filled in.
export function renderWorkLogging(project: string) {
  return readFileSync(join(REPO_ROOT, 'templates', 'work-logging.md'), 'utf8').replaceAll('{{project}}', project)
}

// Install or refresh the marked block inside a markdown file's contents, idempotently: replace it
// in place when the markers exist, otherwise append it; everything outside the markers is preserved.
export function upsertWorkLoggingBlock(existing: string | undefined, block: string): { content: string; action: BlockAction } {
  const body = block.trimEnd()
  if (existing === undefined) return { content: `${body}\n`, action: 'created' }
  const start = existing.indexOf(BLOCK_START)
  const end = existing.indexOf(BLOCK_END)
  if ((start === -1) !== (end === -1) || end < start) throw new Error(`unbalanced mdpm work-logging markers; fix or remove them by hand`)
  if (start !== -1) {
    const next = existing.slice(0, start) + body + existing.slice(end + BLOCK_END.length)
    return next === existing ? { content: existing, action: 'unchanged' } : { content: next, action: 'updated' }
  }
  const separator = existing === '' || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
  return { content: `${existing}${separator}${body}\n`, action: 'appended' }
}

// The repo link a remote stands for, through whichever provider claims its host (GitHub, GitLab, or the
// generic `git` provider for everything else), so any host is recorded and findable.
function repoLinkFor(remote?: string): Link | undefined {
  const hit = remote ? builtinRegistry().inferRepo(remote) : undefined
  if (!hit) return undefined
  const url = hit.provider.buildUrl('repo', { repo: hit.ref }, { host: hit.host })
  return { ...(url && { url }), provider: hit.provider.id, kind: 'repo', ref: hit.ref }
}

export interface InitOptions {
  cwd: string
  /** Link to this existing project instead of inferring/creating one. */
  project?: string
  title?: string
  description?: string
  /** Write a `.mdpm` marker: true forces, false disables, undefined = only when inference would not find the project. */
  marker?: boolean
  /** Install the work-logging block (default true). */
  claudeMd?: boolean
  /** Use CLAUDE.local.md (kept out of git) instead of CLAUDE.md. */
  local?: boolean
  /** Also install the audit-trail hooks into the repo's .claude/settings.local.json. */
  hooks?: boolean
  dryRun?: boolean
}

export interface InitStep {
  step: 'project' | 'marker' | 'claude-md' | 'hooks' | 'exclude'
  action: string
  target: string
  detail?: string
}

export interface InitResult {
  project: string | undefined
  created: boolean
  root: string
  steps: InitStep[]
}

// Register the current repo with mdpm: link or create its project, optionally pin the mapping with a
// local `.mdpm` marker, and install the work-logging block into the repo's CLAUDE.md. Safe to re-run.
export async function initRepo(ops: Ops, opts: InitOptions): Promise<InitResult> {
  const root = gitToplevel(opts.cwd) ?? resolve(opts.cwd)
  const remote = gitOriginUrl(root)
  const repoLink = repoLinkFor(remote)
  const projects = ops.listProjects({ includeArchived: true })
  const steps: InitStep[] = []
  const dry = !!opts.dryRun

  // 1. Which project?
  let slug: string | undefined
  let created = false
  if (opts.project) {
    slug = ops.resolveProject(opts.project).slug
    steps.push({ step: 'project', action: 'linked', target: slug, detail: 'existing project' })
  }
  else {
    const found = inferProject(root, projects)
    if (found) {
      slug = found.slug
      steps.push({ step: 'project', action: 'found', target: slug, detail: `matched by ${found.via}: ${found.detail}` })
    }
    else {
      const title = opts.title ?? basename(root)
      const detail = repoLink ? `repo ${repoLink.ref}` : undefined
      if (dry) {
        steps.push({ step: 'project', action: 'would-create', target: title, detail })
      }
      else {
        const result = await ops.createProject({ title, description: opts.description, ...(repoLink && { links: [repoLink] }) })
        slug = result.slug as string
        created = true
        steps.push({ step: 'project', action: 'created', target: slug, detail })
      }
    }
  }

  // 2. Marker: pin the repo to the project when nothing else would find it.
  const markerFile = join(root, MARKER_FILE)
  const alreadyMarked = slug !== undefined && readMarker(root) === slug
  // Would inference find this project without a marker? An existing project keeps its own repo links;
  // a new one gets the repo link we are about to store.
  const candidate = projects.find(p => p.slug === slug) ?? { slug: slug ?? '', links: repoLink ? [repoLink] : [] }
  const findable = slug !== undefined && inferProject(root, [...projects.filter(p => p.slug !== slug), candidate])?.slug === slug
  const wantMarker = opts.marker ?? !findable
  if (wantMarker && !alreadyMarked && (slug || dry)) {
    steps.push({ step: 'marker', action: dry ? 'would-write' : 'written', target: markerFile, detail: slug ? `project: ${slug}` : undefined })
    if (!dry) {
      writeFileSync(markerFile, `# Maps this repo to its mdpm project (read by the mdpm CLI).\nproject: ${slug}\n`)
      if (excludeLocally(root, MARKER_FILE)) steps.push({ step: 'exclude', action: 'added', target: MARKER_FILE, detail: '.git/info/exclude' })
    }
  }
  else {
    steps.push({ step: 'marker', action: 'skipped', target: markerFile, detail: alreadyMarked ? 'already set' : opts.marker === false ? 'disabled' : 'not needed: the project is found without it' })
  }

  // 3. Work-logging block.
  if (opts.claudeMd !== false) {
    const name = opts.local ? 'CLAUDE.local.md' : 'CLAUDE.md'
    const file = join(root, name)
    const planned = upsertWorkLoggingBlock(existsSync(file) ? readFileSync(file, 'utf8') : undefined, renderWorkLogging(slug ?? '<project-slug>'))
    steps.push({ step: 'claude-md', action: dry && planned.action !== 'unchanged' ? `would-${planned.action === 'created' ? 'create' : planned.action === 'appended' ? 'append' : 'update'}` : planned.action, target: file })
    if (!dry && planned.action !== 'unchanged') {
      writeFileSync(file, planned.content)
      if (opts.local && excludeLocally(root, name)) steps.push({ step: 'exclude', action: 'added', target: name, detail: '.git/info/exclude' })
    }
  }
  else {
    steps.push({ step: 'claude-md', action: 'skipped', target: join(root, 'CLAUDE.md'), detail: 'disabled' })
  }

  // 4. Hooks (opt-in): warn-only audit-trail reminders for Claude Code, kept local to this repo.
  if (opts.hooks) {
    if (dry) steps.push({ step: 'hooks', action: 'would-install', target: '.claude/settings.local.json' })
    else {
      const result = installHooks(root)
      steps.push({ step: 'hooks', action: result.action, target: result.file })
    }
  }

  if (!slug && !dry) throw new NotFoundError('could not determine a project for this repository')
  return { project: slug, created, root, steps }
}
