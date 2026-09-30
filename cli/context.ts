import { createCore } from '../lib/core'
import { colorEnabled, createStyle } from './output'

// Flags every command accepts. citty parses per-command, so each command spreads these in.
export const globalArgs = {
  json: { type: 'boolean', description: 'Machine-readable JSON output', default: false },
  color: { type: 'boolean', description: 'Colored output (--no-color to disable)', default: true },
} as const

export interface GlobalFlags {
  json?: boolean
  color?: boolean
}

export function createContext(flags: GlobalFlags) {
  const json = !!flags.json
  let core: ReturnType<typeof createCore> | undefined
  return {
    json,
    style: createStyle(colorEnabled(process.stdout, flags.color !== false)),
    // Lazy: --help / --version and usage errors must never touch config or the filesystem.
    get core() {
      return core ??= createCore()
    },
  }
}

export type Context = ReturnType<typeof createContext>
