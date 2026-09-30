import { createCore, createLifecycle, inferProject, loadConfig } from '../lib/core'
import { CliError, colorEnabled, createStyle, ExitCode } from './output'

// Flags every command accepts. citty parses per-command, so each command spreads these in.
export const globalArgs = {
  json: { type: 'boolean', description: 'Machine-readable JSON output', default: false },
  color: { type: 'boolean', description: 'Colored output (--no-color to disable)', default: true },
  'content-path': { type: 'string', description: 'Content directory (overrides MDPM_CONTENT_PATH and config file)' },
  url: { type: 'string', description: 'Server base URL (overrides MDPM_BASE_URL and config file)' },
} as const

// Flags for commands that write through the server. Left undefined when absent so the
// MDPM_AUTO_START env and config-file `autoStart` can supply the default.
export const writeArgs = {
  'auto-start': { type: 'boolean', description: 'Start the server if it is down, run the write, then stop it again (--no-auto-start to disable)' },
  'keep-running': { type: 'boolean', description: 'With --auto-start, leave a server this command started running', default: false },
} as const

export const portArg = {
  port: { type: 'string', description: 'Server port (default: from MDPM_BASE_URL, else 3333)' },
} as const

export function parsePort(value: unknown) {
  if (value === undefined) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new CliError(`invalid --port: ${value}`, ExitCode.usage)
  return port
}

export interface GlobalFlags {
  json?: boolean
  color?: boolean
  'content-path'?: string
  url?: string
  'auto-start'?: boolean
  'keep-running'?: boolean
}

// Work to do after the command finishes, success or failure (e.g. stopping a server we started).
const cleanups: (() => Promise<void>)[] = []

export async function runCleanups() {
  for (const cleanup of cleanups.splice(0)) await cleanup()
}

export function createContext(flags: GlobalFlags) {
  const json = !!flags.json
  let loaded: ReturnType<typeof loadConfig> | undefined
  let core: ReturnType<typeof createCore> | undefined
  let lifecycle: ReturnType<typeof createLifecycle> | undefined
  // Lazy: --help / --version and usage errors must never touch config or the filesystem.
  const resolved = () => loaded ??= loadConfig({ flags: { contentPath: flags['content-path'], baseUrl: flags.url, autoStart: flags['auto-start'] } })
  const lifecycleOf = () => lifecycle ??= createLifecycle(resolved().config)
  const style = createStyle(colorEnabled(process.stderr, flags.color !== false))

  // Writes that find the server down start it (when auto-start is on) and retry once. Only a
  // server this command actually started is stopped afterwards; a pre-existing one never is.
  async function autoStartServer() {
    console.error(style.dim('server not running; starting it (auto-start)…'))
    const result = await lifecycleOf().start()
    if (result.action !== 'started' || flags['keep-running']) return
    cleanups.push(async () => {
      await lifecycleOf().stop()
      console.error(style.dim('stopped the server this command started (--keep-running to leave it up)'))
    })
  }

  return {
    json,
    style: createStyle(colorEnabled(process.stdout, flags.color !== false)),
    get loadedConfig() {
      return resolved()
    },
    get core() {
      return core ??= createCore(resolved().config, resolved().autoStart.value ? { onUnreachable: autoStartServer } : {})
    },
    // Config only, no content reads: lifecycle must work before the content dir is reachable.
    get lifecycle() {
      return lifecycleOf()
    },
    // Project for a directory (default cwd), from its git remote or directory name.
    inferProject(cwd = process.cwd()) {
      return inferProject(cwd, this.core.listProjects({ includeArchived: true }))
    },
  }
}

export type Context = ReturnType<typeof createContext>
