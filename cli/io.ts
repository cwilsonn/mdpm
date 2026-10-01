import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { CliError, ExitCode } from './output'

export async function readStdin() {
  if (process.stdin.isTTY) throw new CliError('expected input on stdin (pipe or redirect it in)', ExitCode.usage)
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

// Text flags accept `-` to mean "read it from stdin".
export async function textOrStdin(value: string) {
  return value === '-' ? (await readStdin()).trimEnd() : value
}

export function csv(value: unknown) {
  return typeof value === 'string' ? value.split(',').map(s => s.trim()).filter(Boolean) : undefined
}

export function csvNumbers(value: unknown, flag: string) {
  return csv(value)?.map((s) => {
    const n = Number(s)
    if (!Number.isInteger(n) || n < 1) throw new CliError(`${flag}: '${s}' is not a positive integer`, ExitCode.usage)
    return n
  })
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], flag: string): T | undefined {
  if (value === undefined) return undefined
  if (!allowed.includes(value as T)) throw new CliError(`${flag}: '${value}' is not one of ${allowed.join(', ')}`, ExitCode.usage)
  return value as T
}

export async function confirm(question: string) {
  if (!process.stdin.isTTY) throw new CliError('refusing without confirmation on a non-interactive stdin; pass --yes', ExitCode.usage)
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim())
  }
  finally {
    rl.close()
  }
}

// Open `initial` in $VISUAL / $EDITOR (default vi, only on a terminal) and return what was saved.
// The editor runs through the shell so `EDITOR="code --wait"` works; a non-zero exit saves nothing.
export function editText(initial: string, name = 'mdpm-edit'): string {
  const editor = process.env.VISUAL || process.env.EDITOR || (process.stdin.isTTY ? 'vi' : '')
  if (!editor) throw new CliError('no editor: set $EDITOR (or $VISUAL), or pass the text with --body', ExitCode.usage)
  const dir = mkdtempSync(join(tmpdir(), 'mdpm-'))
  const file = join(dir, `${name}.md`)
  try {
    writeFileSync(file, initial)
    const result = spawnSync(`${editor} "${file}"`, { shell: true, stdio: 'inherit' })
    if (result.status !== 0) throw new CliError(`editor exited with ${result.status ?? result.signal}; nothing was saved`)
    return readFileSync(file, 'utf8')
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
