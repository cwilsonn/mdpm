import { createCore, createLifecycle, resolveConfig } from '../lib/core'
import { CliError, colorEnabled, createStyle, ExitCode } from './output'

// Flags every command accepts. citty parses per-command, so each command spreads these in.
export const globalArgs = {
  json: { type: 'boolean', description: 'Machine-readable JSON output', default: false },
  color: { type: 'boolean', description: 'Colored output (--no-color to disable)', default: true },
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
}

export function createContext(flags: GlobalFlags) {
  const json = !!flags.json
  let core: ReturnType<typeof createCore> | undefined
  let lifecycle: ReturnType<typeof createLifecycle> | undefined
  return {
    json,
    style: createStyle(colorEnabled(process.stdout, flags.color !== false)),
    // Lazy: --help / --version and usage errors must never touch config or the filesystem.
    get core() {
      return core ??= createCore()
    },
    // Config only, no content reads: lifecycle must work before the content dir is reachable.
    get lifecycle() {
      return lifecycle ??= createLifecycle(resolveConfig())
    },
  }
}

export type Context = ReturnType<typeof createContext>
