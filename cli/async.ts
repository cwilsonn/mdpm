import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { commandName, recordAsyncFailure } from '../lib/core'
import { createContext } from './context'
import { readStdin } from './io'
import { projectArgs, resolveRef, scopeProject } from './commands/task/shared'
import { CliError, ExitCode } from './output'

// Fire-and-forget: `--async` validates and resolves what it can from the files (so a typo still fails at once),
// prints the id, and hands the real write to a detached copy of this command. The copy's failures go to
// async-failures.jsonl (see `mdpm status`). Read-after-write is not guaranteed: the write may not have landed yet.

const SUPPORTED = new Set(['task set', 'task done', 'task note', 'task start', 'task add', 'task batch', 'task archive', 'task unarchive'])
const VALUE_FLAGS = new Set(['project', 'status', 'priority', 'tags', 'assignees', 'due', 'dependencies', 'description', 'note', 'author', 'title', 'file', 'where', 'content-path', 'url'])
export const ASYNC_CHILD_ENV = 'MDPM_ASYNC_CHILD'

// Positional words and flag values from raw argv (citty parses later, in the child; this only needs enough to name the target).
function scan(rawArgs: string[]) {
  const words: string[] = []
  const flags: Record<string, string | true> = {}
  for (let i = 0; i < rawArgs.length; i++) {
    const a = rawArgs[i]!
    if (a === '-') { words.push(a); continue }
    if (!a.startsWith('--')) { words.push(a); continue }
    const [name, inline] = a.slice(2).split(/=(.*)/s)
    if (inline !== undefined) flags[name!] = inline
    else if (VALUE_FLAGS.has(name!) && rawArgs[i + 1] !== undefined) flags[name!] = rawArgs[++i]!
    else flags[name!] = true
  }
  return { words, flags }
}

// Returns the line to print when the command was queued, or undefined when `--async` was not asked for.
export async function queueIfAsync(rawArgs: string[]): Promise<string | undefined> {
  if (!rawArgs.includes('--async') || process.env[ASYNC_CHILD_ENV]) return undefined
  const name = commandName(rawArgs)
  if (!SUPPORTED.has(name)) throw new CliError(`--async is supported for: ${[...SUPPORTED].join(', ')}`, ExitCode.usage)
  const childArgs = rawArgs.filter(a => a !== '--async')
  const { words, flags } = scan(childArgs)
  const rest = words.slice(2) // after `task <verb>`
  const ctx = createContext({ 'content-path': flags['content-path'] as string | undefined, url: flags.url as string | undefined })
  const scope = { project: flags.project as string | undefined, all: !!flags.all }

  // Fail now, from the files, on anything that does not need the server.
  let id: string
  let stdin: string | undefined
  if (name === 'task batch') {
    stdin = flags.file ? undefined : await readStdin()
    let ops: unknown
    try { ops = JSON.parse(stdin ?? readFileSync(flags.file as string, 'utf8')) }
    catch (err) { throw new CliError(`batch input is not valid JSON: ${(err as Error).message}`, ExitCode.usage) }
    const n = (Array.isArray(ops) ? ops : (ops as { ops?: unknown[] })?.ops)?.length
    if (!n) throw new CliError('batch input must be a non-empty JSON array of operations', ExitCode.usage)
    id = `${n} ops`
  }
  else if (name === 'task add' || name === 'task start') {
    const project = scopeProject(ctx, scope) ?? (() => { throw new CliError('no project: pass --project or run inside a repo registered in mdpm', ExitCode.usage) })()
    const title = rest[0]
    if (!title) throw new CliError('missing title', ExitCode.usage)
    const resumed = name === 'task start' ? ctx.core.listTasks({ project }).find(t => t.status !== 'done' && (t.slug === title || t.title.toLowerCase() === title.trim().toLowerCase())) : undefined
    id = `${project}/${resumed?.slug ?? ctx.core.predictTaskSlug(project, title)}`
  }
  else {
    if (!rest[0]) throw new CliError('missing task ref (--async does not support --where)', ExitCode.usage)
    const task = resolveRef(ctx, rest[0], scope)
    id = `${task.project}/${task.slug}`
  }
  if (stdin === undefined && childArgs.includes('-')) stdin = await readStdin()

  const bin = process.argv[1]!
  const child = spawn(process.execPath, [bin, ...childArgs], {
    detached: true,
    stdio: [stdin === undefined ? 'ignore' : 'pipe', 'ignore', 'ignore'],
    env: { ...process.env, [ASYNC_CHILD_ENV]: '1' },
  })
  if (stdin !== undefined) child.stdin!.end(stdin)
  child.unref()
  return `queued ${name}: ${id}`
}

// In the detached copy: swallow output, and on failure leave a record instead of a terminal message.
export function installAsyncChild(rawArgs: string[]) {
  if (!process.env[ASYNC_CHILD_ENV]) return undefined
  let stderr = ''
  process.stdout.write = (() => true) as typeof process.stdout.write
  process.stderr.write = ((chunk: string | Uint8Array) => { stderr += chunk.toString(); return true }) as typeof process.stderr.write
  return () => {
    if (process.exitCode) recordAsyncFailure({ source: 'cli', what: commandName(rawArgs), error: stderr || `exit ${process.exitCode}` })
  }
}
