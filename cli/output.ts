import { NotFoundError, ServerUnreachableError } from '../lib/core'

// Stable contract, documented in plan-cli-v1. Scripts and agents rely on these.
export const ExitCode = {
  ok: 0,
  error: 1,
  usage: 2,
  unreachable: 3,
  notFound: 4,
} as const

export type ExitCode = typeof ExitCode[keyof typeof ExitCode]

export class CliError extends Error {
  constructor(message: string, readonly exitCode: ExitCode = ExitCode.error) {
    super(message)
  }
}

export function exitCodeFor(err: unknown): ExitCode {
  if (err instanceof CliError) return err.exitCode
  if (err instanceof NotFoundError) return ExitCode.notFound
  if (err instanceof ServerUnreachableError) return ExitCode.unreachable
  // citty's usage errors (unknown command, missing arg) aren't exported, so match by name.
  if ((err as Error)?.name === 'CLIError') return ExitCode.usage
  return ExitCode.error
}

const ANSI = { dim: 2, red: 31, green: 32, yellow: 33, cyan: 36, bold: 1 } as const
type StyleName = keyof typeof ANSI
export type Style = Record<StyleName, (s: string) => string>

export function createStyle(enabled: boolean): Style {
  return Object.fromEntries(
    Object.entries(ANSI).map(([name, code]) => [name, (s: string) => enabled ? `\x1b[${code}m${s}\x1b[0m` : s]),
  ) as Style
}

// Color only when writing to a terminal, NO_COLOR is unset, and --no-color wasn't passed.
export function colorEnabled(stream: NodeJS.WriteStream, flag: boolean) {
  return flag && !process.env.NO_COLOR && !!stream.isTTY
}

// stdout carries the result (JSON or human); everything diagnostic goes to stderr.
export function emit(json: boolean, data: unknown, human: () => string) {
  console.log(json ? JSON.stringify(data, null, 2) : human())
}

export function reportError(err: unknown, json: boolean, style: Style) {
  const message = err instanceof Error ? err.message : String(err)
  const exitCode = exitCodeFor(err)
  if (json) console.error(JSON.stringify({ error: { code: exitCode, name: (err as Error)?.name ?? 'Error', message } }))
  else console.error(`${style.red('error:')} ${message}`)
  return exitCode
}

export function table(rows: string[][], header?: string[]) {
  const all = header ? [header, ...rows] : rows
  const widths = all[0]?.map((_, i) => Math.max(...all.map(r => (r[i] ?? '').length))) ?? []
  const line = (r: string[]) => r.map((c, i) => c.padEnd(widths[i]!)).join('  ').trimEnd()
  return all.map(line).join('\n')
}
