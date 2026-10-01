import { readFileSync } from 'node:fs'
import { defineCommand } from 'citty'
import { gitToplevel, hooksStatus, inferProject, installHooks, startSession, stopCheck, uninstallHooks } from '../../lib/core'
import { createContext, globalArgs } from '../context'
import { CliError, emit, ExitCode, table } from '../output'

interface HookInput {
  cwd?: string
  session_id?: string
  transcript_path?: string
}

// Claude Code pipes a JSON object on stdin; tolerate a TTY or garbage (manual runs).
function readHookInput(): HookInput {
  if (process.stdin.isTTY) return {}
  try { return JSON.parse(readFileSync(0, 'utf8')) as HookInput }
  catch { return {} }
}

// Hook runners must never break a session: any failure means "say nothing" with exit 0.
async function runHook(args: Record<string, unknown>, body: (ctx: ReturnType<typeof createContext>, input: HookInput, project: string, cwd: string) => void) {
  try {
    const ctx = createContext({ ...args, json: false })
    const input = readHookInput()
    const cwd = input.cwd ?? process.cwd()
    const project = inferProject(cwd, ctx.core.listProjects({ includeArchived: false }))?.slug
    if (project) body(ctx, input, project, cwd)
  }
  catch {}
}

const sessionStart = defineCommand({
  meta: { name: 'session-start', description: 'Claude Code SessionStart hook: inject the work-logging reminder and open tasks (no-op outside registered repos)' },
  args: { ...globalArgs },
  run: ({ args }) => runHook(args, (ctx, input, project) => {
    const additionalContext = startSession(ctx.core, { sessionId: input.session_id, project })
    console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext } }))
  }),
})

const stop = defineCommand({
  meta: { name: 'stop', description: 'Claude Code Stop hook: warn (never block) when a session changed code without touching a task' },
  args: { ...globalArgs },
  run: ({ args }) => runHook(args, (ctx, input, project, cwd) => {
    const message = stopCheck(ctx.core, { sessionId: input.session_id, cwd, project, transcriptPath: input.transcript_path })
    if (message) console.log(JSON.stringify({ systemMessage: message }))
  }),
})

const repoRoot = () => gitToplevel(process.cwd()) ?? process.cwd()

const install = defineCommand({
  meta: { name: 'install', description: 'Install the hooks into this repo\'s .claude/settings.local.json (not committed)' },
  args: { ...globalArgs },
  run({ args }) {
    const ctx = createContext(args)
    const root = repoRoot()
    const project = inferProject(root, ctx.core.listProjects({ includeArchived: true }))?.slug
    if (!project) throw new CliError('this repo is not registered in mdpm; run `mdpm init` first (or `mdpm init --hooks`)', ExitCode.usage)
    const result = installHooks(root)
    emit(ctx.json, { project, ...result }, () => `${ctx.style.green('✓')} hooks ${result.action}: ${result.file}\n${ctx.style.dim('SessionStart injects the work-logging reminder; Stop warns when work went unlogged. Never blocks.')}`)
  },
})

const uninstall = defineCommand({
  meta: { name: 'uninstall', description: 'Remove the mdpm hooks from this repo\'s .claude/settings.local.json' },
  args: { ...globalArgs },
  run({ args }) {
    const ctx = createContext(args)
    const result = uninstallHooks(repoRoot())
    emit(ctx.json, result, () => `${result.action === 'removed' ? ctx.style.green('✓') : ctx.style.dim('-')} hooks ${result.action}: ${result.file}`)
  },
})

const status = defineCommand({
  meta: { name: 'status', description: 'Show which hooks are installed for this repo (exit 1 unless all are)' },
  args: { ...globalArgs },
  run({ args }) {
    const ctx = createContext(args)
    const result = hooksStatus(repoRoot())
    emit(ctx.json, result, () => `${ctx.style.dim(result.file)}\n${table(Object.entries(result.events).map(([e, on]) => [e, on ? ctx.style.green('installed') : ctx.style.yellow('missing')]))}`)
    if (!Object.values(result.events).every(Boolean)) process.exitCode = ExitCode.error
  },
})

export default defineCommand({
  meta: { name: 'hooks', description: 'Claude Code audit-trail hooks (warn-only), installed per repo' },
  subCommands: { install, uninstall, status, 'session-start': sessionStart, stop },
})
