import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { REPO_ROOT } from './config'
import type { Ops } from './ops'
import { BLOCK_START } from './init'
import { excludeLocally, git, gitToplevel } from './project'

// Audit-trail hooks for Claude Code (warn-only):
//   SessionStart -> inject the work-logging reminder and the project's open tasks (reaches Claude)
//   Stop         -> if the session changed code but no task was touched, tell the user (never blocks;
//                   a Stop hook cannot add context for Claude without blocking)
// Both are no-ops outside repos registered in mdpm, never need the server, and never fail loudly.

const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 }
const WARN_EVERY_MS = 30 * 60 * 1000
const FALLBACK_WINDOW_MS = 2 * 60 * 60 * 1000
const MDPM_ARTIFACTS = new Set(['.mdpm', 'CLAUDE.local.md', '.claude/settings.local.json', '.claude/'])

const stateDir = () => join(process.env.MDPM_STATE_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'mdpm'), 'hooks')
const sessionFile = (id: string) => join(stateDir(), `${id.replace(/[^\w.-]/g, '_')}.json`)

interface SessionState {
  startedAt: string
  project: string
  warnedAt?: string
}

function readSession(id: string): SessionState | undefined {
  try { return JSON.parse(readFileSync(sessionFile(id), 'utf8')) }
  catch { return undefined }
}

function writeSession(id: string, state: SessionState) {
  mkdirSync(stateDir(), { recursive: true })
  writeFileSync(sessionFile(id), JSON.stringify(state))
}

// ── SessionStart ──────────────────────────────────────────────────────────────

// The rules live in the work-logging block of CLAUDE.md (or CLAUDE.local.md), which Claude Code loads anyway;
// the hook adds state, the open tasks, and repeats the short rules only where that block is missing.
export function hasWorkLoggingBlock(cwd: string) {
  const root = gitToplevel(cwd) ?? cwd
  return ['CLAUDE.md', 'CLAUDE.local.md'].some((f) => {
    try { return readFileSync(join(root, f), 'utf8').includes(BLOCK_START) }
    catch { return false }
  })
}

export function buildSessionContext(ops: Ops, project: string, opts: { rules?: boolean } = {}) {
  const open = ops.listTasks({ project, status: ['in-progress', 'blocked', 'todo'] })
  const line = (t: { slug: string; title: string; priority: string }) => `- ${t.slug}: ${t.title} [${t.priority}]`
  const inProgress = open.filter(t => t.status === 'in-progress')
  const blocked = open.filter(t => t.status === 'blocked')
  const todo = open
    .filter(t => t.status === 'todo')
    .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9) || a.order - b.order)
  const section = (title: string, tasks: typeof open, max: number) =>
    tasks.length ? [`${title}${tasks.length > max ? ` (top ${max} of ${tasks.length})` : ''}:`, ...tasks.slice(0, max).map(line)] : []
  const rules = opts.rules === false
    ? [`This repo is tracked in mdpm as project "${project}"; log work as its Work logging section in CLAUDE.md says.`]
    : [
        `This repo is tracked in mdpm as project "${project}". Log your work there, cheaply: touch a task when a unit of work starts and when it ends, not in between.`,
        '1. Start: mdpm task start "<title>" (resumes the open task with that exact title, or creates it; marks it in-progress).',
        '2. Meanwhile: no per-step notes or status updates.',
        '3. Finish, once: mdpm task done <ref> --note "what was done and why, decisions, verification, commits/PRs" (or set --status in-review --note ...). Several tasks: mdpm task batch.',
      ]
  return [
    ...rules,
    '',
    ...section('In progress', inProgress, 10),
    ...section('Blocked', blocked, 5),
    ...section('Todo', todo, 8),
    ...(open.length ? [] : ['No open tasks yet.']),
  ].join('\n')
}

export function startSession(ops: Ops, input: { sessionId?: string; project: string; cwd?: string }) {
  if (input.sessionId) writeSession(input.sessionId, { startedAt: new Date().toISOString(), project: input.project })
  return buildSessionContext(ops, input.project, { rules: !(input.cwd && hasWorkLoggingBlock(input.cwd)) })
}

// ── Stop ──────────────────────────────────────────────────────────────────────

export interface WorkCheck {
  changedFiles: number
  commits: number
  taskTouched: boolean
}

function transcriptStart(path?: string) {
  if (!path || !existsSync(path)) return undefined
  try {
    const first = readFileSync(path, 'utf8').split('\n', 1)[0]!
    const ts = JSON.parse(first).timestamp
    return typeof ts === 'string' && !Number.isNaN(Date.parse(ts)) ? ts : undefined
  }
  catch { return undefined }
}

// Did this session change code, and did anyone touch a task for the project since it started?
export function checkWork(ops: Ops, input: { cwd: string; project: string; since: string }): WorkCheck {
  const porcelain = git(input.cwd, 'status', '--porcelain') ?? ''
  const changedFiles = porcelain.split('\n').map(l => l.slice(3).trim()).filter(f => f && !MDPM_ARTIFACTS.has(f)).length
  const commits = Number(git(input.cwd, 'rev-list', '--count', `--since=${input.since}`, 'HEAD') ?? 0) || 0
  // Creating, editing, or noting a task rewrites its file, so the file's mtime is the accurate signal
  // (frontmatter dates are date-only or only set on update).
  const sinceMs = Date.parse(input.since)
  const tasksDir = join(ops.config.contentPath, 'projects', input.project, 'tasks')
  const taskTouched = existsSync(tasksDir) && readdirSync(tasksDir).some(f => f.endsWith('.md') && statSync(join(tasksDir, f)).mtimeMs >= sinceMs)
  return { changedFiles, commits, taskTouched }
}

// Returns a message for the user, or undefined when there is nothing to say.
export function stopCheck(ops: Ops, input: { sessionId?: string; cwd: string; project: string; transcriptPath?: string; now?: Date }): string | undefined {
  const now = input.now ?? new Date()
  const saved = input.sessionId ? readSession(input.sessionId) : undefined
  const since = saved?.startedAt ?? transcriptStart(input.transcriptPath) ?? new Date(now.getTime() - FALLBACK_WINDOW_MS).toISOString()
  const work = checkWork(ops, { cwd: input.cwd, project: input.project, since })
  if ((work.changedFiles === 0 && work.commits === 0) || work.taskTouched) return undefined
  if (saved?.warnedAt && now.getTime() - Date.parse(saved.warnedAt) < WARN_EVERY_MS) return undefined
  if (input.sessionId) writeSession(input.sessionId, { ...(saved ?? { startedAt: since, project: input.project }), warnedAt: now.toISOString() })
  const did = [work.changedFiles && `${work.changedFiles} changed file${work.changedFiles === 1 ? '' : 's'}`, work.commits && `${work.commits} commit${work.commits === 1 ? '' : 's'}`].filter(Boolean).join(' and ')
  return `mdpm: this session left ${did} in project "${input.project}", but no task was created or updated. Log it so the work has an audit trail: mdpm task start "<title>" if there is no task yet, then mdpm task done <ref> --note "what and why" (one call per task, or mdpm task batch for several).`
}

// ── Installation (repo-local .claude/settings.local.json) ────────────────────

export const HOOK_EVENTS = { SessionStart: 'session-start', Stop: 'stop' } as const

interface HookEntry { type?: string; command?: string; timeout?: number; statusMessage?: string }
interface HookGroup { matcher?: string; hooks?: HookEntry[] }
type Settings = { hooks?: Record<string, HookGroup[]> } & Record<string, unknown>

export const settingsFile = (root: string) => join(root, '.claude', 'settings.local.json')

// Absolute node + absolute entry file: hook shells don't reliably have the pnpm bin dir (or nvm's node) on PATH.
export function hookCommand(sub: string, node = process.execPath, bin = join(REPO_ROOT, 'bin', 'mdpm.mjs')) {
  return `"${node}" "${bin}" hooks ${sub}`
}

const isOurs = (entry: HookEntry) => /\bmdpm(\.mjs)?"?\s+hooks\s+(session-start|stop)\b/.test(entry.command ?? '')

function readSettings(root: string): Settings {
  const file = settingsFile(root)
  if (!existsSync(file)) return {}
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  }
  catch {}
  throw new Error(`${file} is not valid JSON; fix it by hand before installing hooks`)
}

function stripOurs(settings: Settings) {
  for (const [event, groups] of Object.entries(settings.hooks ?? {})) {
    const kept = groups
      .map(g => ({ ...g, hooks: (g.hooks ?? []).filter(h => !isOurs(h)) }))
      .filter(g => g.hooks.length > 0)
    if (kept.length) settings.hooks![event] = kept
    else delete settings.hooks![event]
  }
  if (settings.hooks && Object.keys(settings.hooks).length === 0) delete settings.hooks
}

export type HooksAction = 'installed' | 'unchanged' | 'updated' | 'removed' | 'absent'

export function installHooks(root: string, opts: { node?: string; bin?: string } = {}): { action: HooksAction; file: string } {
  const file = settingsFile(root)
  const before = existsSync(file) ? readFileSync(file, 'utf8') : undefined
  const settings = readSettings(root)
  const hadOurs = JSON.stringify(settings.hooks ?? {}).includes('hooks session-start') || JSON.stringify(settings.hooks ?? {}).includes('hooks stop')
  stripOurs(settings)
  settings.hooks ??= {}
  for (const [event, sub] of Object.entries(HOOK_EVENTS)) {
    settings.hooks[event] = [...(settings.hooks[event] ?? []), {
      hooks: [{ type: 'command', command: hookCommand(sub, opts.node, opts.bin), timeout: 10, statusMessage: event === 'SessionStart' ? 'Loading mdpm project context...' : undefined }],
    }]
  }
  const next = `${JSON.stringify(settings, null, 2)}\n`
  if (next === before) return { action: 'unchanged', file }
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, next)
  excludeLocally(root, '.claude/settings.local.json')
  return { action: hadOurs ? 'updated' : 'installed', file }
}

export function uninstallHooks(root: string): { action: HooksAction; file: string } {
  const file = settingsFile(root)
  if (!existsSync(file)) return { action: 'absent', file }
  const settings = readSettings(root)
  const before = JSON.stringify(settings)
  stripOurs(settings)
  if (JSON.stringify(settings) === before) return { action: 'absent', file }
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`)
  return { action: 'removed', file }
}

export function hooksStatus(root: string) {
  const file = settingsFile(root)
  const settings = existsSync(file) ? readSettings(root) : {}
  const installed = (event: string) => (settings.hooks?.[event] ?? []).some(g => (g.hooks ?? []).some(isOurs))
  return { file, events: Object.fromEntries(Object.keys(HOOK_EVENTS).map(e => [e, installed(e)])) as Record<string, boolean> }
}
