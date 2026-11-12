import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { stateDir } from './lifecycle'

// Fire-and-forget writes return before the write happens, so a failure has nobody to tell. It is recorded here
// instead, and `mdpm status` / MCP `ping` report the count until someone acknowledges them.

export interface AsyncFailure {
  at: string
  source: 'cli' | 'mcp'
  /** What was attempted: `task done`, `update_task`, ... */
  what: string
  error: string
}

export const asyncFailuresPath = () => join(stateDir(), 'async-failures.jsonl')

export function recordAsyncFailure(f: Omit<AsyncFailure, 'at'>, now = new Date()) {
  try {
    const file = asyncFailuresPath()
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, `${JSON.stringify({ at: now.toISOString(), ...f, error: f.error.trim().slice(0, 500) })}\n`)
  }
  catch {}
}

export function readAsyncFailures(): AsyncFailure[] {
  const file = asyncFailuresPath()
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').flatMap((line) => {
    try { return line.trim() ? [JSON.parse(line) as AsyncFailure] : [] }
    catch { return [] }
  })
}

export function clearAsyncFailures() {
  rmSync(asyncFailuresPath(), { force: true })
}
