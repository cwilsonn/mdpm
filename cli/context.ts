import { createCore, createLifecycle, inferProject, loadConfig } from '../lib/core'
import { CliError, colorEnabled, createStyle, ExitCode } from './output'

// Flags every command accepts. citty parses per-command, so each command spreads these in.
export const globalArgs = {
  json: { type: 'boolean', description: 'Machine-readable JSON output', default: false },
  color: { type: 'boolean', description: 'Colored output (--no-color to disable)', default: true },
  'content-path': { type: 'string', description: 'Content directory (overrides MDPM_CONTENT_PATH and config file)' },
  url: { type: 'string', description: 'Server base URL (overrides MDPM_BASE_URL and config file)' },
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
}

export function createContext(flags: GlobalFlags) {
  const json = !!flags.json
  let loaded: ReturnType<typeof loadConfig> | undefined
  let core: ReturnType<typeof createCore> | undefined
  let lifecycle: ReturnType<typeof createLifecycle> | undefined
  // Lazy: --help / --version and usage errors must never touch config or the filesystem.
  const resolved = () => loaded ??= loadConfig({ flags: { contentPath: flags['content-path'], baseUrl: flags.url } })
  return {
    json,
    style: createStyle(colorEnabled(process.stdout, flags.color !== false)),
    get loadedConfig() {
      return resolved()
    },
    get core() {
      return core ??= createCore(resolved().config)
    },
    // Config only, no content reads: lifecycle must work before the content dir is reachable.
    get lifecycle() {
      return lifecycle ??= createLifecycle(resolved().config)
    },
    // Project for a directory (default cwd), from its git remote or directory name.
    inferProject(cwd = process.cwd()) {
      return inferProject(cwd, this.core.listProjects({ includeArchived: true }))
    },
  }
}

export type Context = ReturnType<typeof createContext>
