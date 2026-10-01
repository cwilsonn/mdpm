import { spawn } from 'node:child_process'
import { lookup } from 'node:dns/promises'
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { setTimeout as sleep } from 'node:timers/promises'
import { REPO_ROOT, type CoreConfig } from './config'

const DEFAULT_PORT = 3333
// A pid file whose server never came up is trusted this long (covers a slow cold start),
// after which a live-but-silent pid is assumed to be a recycled pid.
const STARTING_GRACE_MS = 120_000

export type ServerState = 'running' | 'starting' | 'stopped'

export interface ServerStatus {
  state: ServerState
  running: boolean
  port: number
  url: string
  // Set when we know the server's process: from our own pid record, or Nuxt's lock file.
  pid?: number
  // False when the server wasn't started by this CLI (pid came from nuxt.lock; no log file).
  managed?: boolean
  startedAt?: string
  uptimeSeconds?: number
  logFile?: string
}

interface PidRecord {
  pid: number
  port: number
  startedAt: string
}

export interface StartOptions {
  port?: number
  foreground?: boolean
  timeoutMs?: number
}

export interface StopOptions {
  port?: number
  timeoutMs?: number
}

export class LifecycleError extends Error {
  override name = 'LifecycleError'
}

function stateDir() {
  return process.env.MDPM_STATE_DIR ?? join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'mdpm')
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  }
  catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function tryConnect(port: number, host: string, timeoutMs = 500) {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ port, host })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

// The dev server binds whichever address `mdpm.local` resolves to, so check both loopbacks.
async function portListening(port: number) {
  const results = await Promise.all([tryConnect(port, '127.0.0.1'), tryConnect(port, '::1')])
  return results.some(Boolean)
}

// Accepting TCP isn't enough for Nuxt: it listens before the first request is servable.
async function httpReady(port: number) {
  try {
    await fetch(`http://localhost:${port}/`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
    return true
  }
  catch {
    return false
  }
}

interface NuxtLock {
  pid: number
  port: number
  command: string
  startedAt: number
}

// Nuxt's own dev lock (`<buildDir>/nuxt.lock`). Internal format, so read it defensively and
// only as a fallback for servers started outside this CLI (e.g. plain `pnpm dev`).
function readNuxtLock(): NuxtLock | undefined {
  try {
    const lock = JSON.parse(readFileSync(join(REPO_ROOT, '.nuxt', 'nuxt.lock'), 'utf8'))
    return [lock.pid, lock.port, lock.startedAt].every(Number.isFinite) && lock.command === 'dev' ? lock : undefined
  }
  catch {
    return undefined
  }
}

export function createLifecycle(config: CoreConfig) {
  function resolvePort(port?: number) {
    return port ?? (Number(new URL(config.baseUrl).port) || DEFAULT_PORT)
  }

  function urlFor(port: number) {
    const url = new URL(config.baseUrl)
    url.port = String(port)
    return url.toString().replace(/\/$/, '')
  }

  const pidFile = (port: number) => join(stateDir(), `server-${port}.json`)
  const logFile = (port: number) => join(stateDir(), `server-${port}.log`)

  function readRecord(port: number): PidRecord | undefined {
    try {
      return JSON.parse(readFileSync(pidFile(port), 'utf8'))
    }
    catch {
      return undefined
    }
  }

  const clearRecord = (port: number) => rmSync(pidFile(port), { force: true })

  async function status(portOverride?: number): Promise<ServerStatus> {
    const port = resolvePort(portOverride)
    const listening = await portListening(port)
    let record = readRecord(port)

    if (record) {
      const age = Date.now() - Date.parse(record.startedAt)
      const stale = !pidAlive(record.pid) || (!listening && age > STARTING_GRACE_MS)
      if (stale) {
        clearRecord(port)
        record = undefined
      }
    }

    const state: ServerState = listening ? 'running' : record ? 'starting' : 'stopped'

    if (!record && listening) {
      const lock = readNuxtLock()
      if (lock && lock.port === port && pidAlive(lock.pid)) {
        return {
          state,
          running: true,
          port,
          url: urlFor(port),
          pid: lock.pid,
          managed: false,
          startedAt: new Date(lock.startedAt).toISOString(),
          uptimeSeconds: Math.max(0, Math.round((Date.now() - lock.startedAt) / 1000)),
        }
      }
    }
    return {
      state,
      running: listening,
      port,
      url: urlFor(port),
      ...(record && {
        pid: record.pid,
        managed: true,
        startedAt: record.startedAt,
        uptimeSeconds: Math.max(0, Math.round((Date.now() - Date.parse(record.startedAt)) / 1000)),
        logFile: logFile(port),
      }),
    }
  }

  async function waitReady(port: number, deadline: number, hasExited: () => boolean) {
    while (Date.now() < deadline) {
      if (hasExited()) return 'exited' as const
      if (await portListening(port) && await httpReady(port)) return 'ready' as const
      await sleep(250)
    }
    return 'timeout' as const
  }

  async function start(opts: StartOptions = {}): Promise<{ action: 'started' | 'already-running' } & ServerStatus> {
    const port = resolvePort(opts.port)
    const before = await status(port)
    if (before.running) return { action: 'already-running', ...before }
    if (before.state === 'starting' && before.pid && !opts.foreground) {
      // Someone else's start is in flight (live pid, port not open yet): wait for it, don't spawn a second.
      const pid = before.pid
      const outcome = await waitReady(port, Date.now() + (opts.timeoutMs ?? 60_000), () => !pidAlive(pid))
      if (outcome !== 'ready') throw new LifecycleError(`server start in progress (pid ${pid}) did not become ready; see ${logFile(port)}`)
      return { action: 'already-running', ...await status(port) }
    }

    // The dev server binds the base URL's hostname. If it doesn't resolve, Nuxt dies with an opaque error,
    // so check up front and say how to fix it.
    const host = new URL(config.baseUrl).hostname
    await lookup(host).catch(() => {
      throw new LifecycleError(
        `cannot resolve "${host}", so the server can't bind it. Either add "127.0.0.1 ${host}" (and "::1 ${host}") to your hosts file, `
        + 'or use localhost, which needs no admin rights: set MDPM_BASE_URL=http://localhost:3333 or "baseUrl" in ~/.config/mdpm/config.json',
      )
    })

    mkdirSync(stateDir(), { recursive: true })
    const log = opts.foreground ? undefined : openSync(logFile(port), 'a')
    // detached => own process group, so stop() can signal pnpm, nuxt, and its worker in one go.
    // Test seam: MDPM_SERVER_COMMAND replaces `pnpm dev` (the port is still appended as `--port N`).
    const [command, ...commandArgs] = process.env.MDPM_SERVER_COMMAND?.split(/\s+/).filter(Boolean) ?? ['pnpm', 'dev']
    const child = spawn(command!, [...commandArgs, '--port', String(port)], {
      cwd: REPO_ROOT,
      // The server must read/write the same content directory and bind the same host the CLI resolved
      // (flag, env, or config), so the CLI and the server never disagree about where things are.
      env: { ...process.env, MDPM_CONTENT_PATH: config.contentPath, MDPM_HOST: host },
      detached: true,
      stdio: opts.foreground ? 'inherit' : ['ignore', log!, log!],
    })
    if (log !== undefined) closeSync(log)

    let exited = false
    let spawnError: Error | undefined
    child.once('exit', () => { exited = true })
    child.once('error', (err) => { spawnError = err; exited = true })
    // Let spawn settle so ENOENT (pnpm missing) surfaces before we record a pid.
    await sleep(50)
    if (spawnError || !child.pid) {
      throw new LifecycleError(`could not launch the server command: ${spawnError?.message ?? 'no pid'}`)
    }

    writeFileSync(pidFile(port), JSON.stringify({ pid: child.pid, port, startedAt: new Date().toISOString() } satisfies PidRecord))

    if (opts.foreground) {
      const forward = (signal: NodeJS.Signals) => { try { process.kill(-child.pid!, signal) } catch {} }
      for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => forward(sig))
      const code = await new Promise<number>(resolve => child.once('exit', (c, s) => resolve(c ?? (s ? 128 : 0))))
      clearRecord(port)
      process.exitCode = code
      return { action: 'started', ...await status(port) }
    }

    child.unref()
    const outcome = await waitReady(port, Date.now() + (opts.timeoutMs ?? 60_000), () => exited)
    if (outcome === 'exited') {
      clearRecord(port)
      throw new LifecycleError(`server exited during startup; see ${logFile(port)}`)
    }
    if (outcome === 'timeout') {
      throw new LifecycleError(`server not ready in time (still starting, pid ${child.pid}); see ${logFile(port)}, or run \`mdpm stop\``)
    }
    return { action: 'started', ...await status(port) }
  }

  function signalGroup(pid: number, signal: NodeJS.Signals) {
    try {
      process.kill(-pid, signal)
    }
    catch {
      try { process.kill(pid, signal) } catch {}
    }
  }

  async function stop(opts: StopOptions = {}): Promise<{ action: 'stopped' | 'not-running' } & ServerStatus> {
    const port = resolvePort(opts.port)
    const before = await status(port)
    if (before.state === 'stopped') return { action: 'not-running', ...before }
    if (!before.pid) {
      throw new LifecycleError(`a server is listening on port ${port} but wasn't started by \`mdpm start\` and no Nuxt lock identifies it; stop it manually`)
    }

    const pid = before.pid
    const gone = async () => !pidAlive(pid) && !await portListening(port)
    const waitGone = async (ms: number) => {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (await gone()) return true
        await sleep(200)
      }
      return false
    }

    signalGroup(pid, 'SIGTERM')
    if (!await waitGone(opts.timeoutMs ?? 10_000)) {
      signalGroup(pid, 'SIGKILL')
      if (!await waitGone(3_000)) throw new LifecycleError(`server (pid ${pid}) did not stop; check the process manually`)
    }
    clearRecord(port)
    return { action: 'stopped', ...await status(port) }
  }

  return { status, start, stop, resolvePort }
}

export type Lifecycle = ReturnType<typeof createLifecycle>
