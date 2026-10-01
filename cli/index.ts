import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand, renderUsage, runCommand, type CommandDef } from 'citty'
import { REPO_ROOT } from '../lib/core'
import { runCleanups } from './context'
import { colorEnabled, createStyle, ExitCode, exitCodeFor, reportError } from './output'

// Read from package.json so release-please stays the single source of truth.
const version: string = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version

export const root = defineCommand({
  meta: { name: 'mdpm', version, description: 'Markdown-based project management: projects, tasks, and docs as files' },
  subCommands: {
    config: () => import('./commands/config').then(m => m.default),
    ping: () => import('./commands/ping').then(m => m.default),
    project: () => import('./commands/project/index').then(m => m.default),
    doc: () => import('./commands/doc/index').then(m => m.default),
    pickup: () => import('./commands/pickup').then(m => m.default),
    skills: () => import('./commands/skills').then(m => m.default),
    hooks: () => import('./commands/hooks').then(m => m.default),
    init: () => import('./commands/init').then(m => m.default),
    log: () => import('./commands/log').then(m => m.default),
    completions: () => import('./commands/completions').then(m => m.default),
    task: () => import('./commands/task/index').then(m => m.default),
    start: () => import('./commands/start').then(m => m.default),
    stop: () => import('./commands/stop').then(m => m.default),
    restart: () => import('./commands/restart').then(m => m.default),
    status: () => import('./commands/status').then(m => m.default),
  },
})

// Walk the subcommand path in argv to find which command's usage to show.
async function resolveUsageTarget(cmd: CommandDef<any>, rawArgs: string[]): Promise<[CommandDef<any>, CommandDef<any> | undefined]> {
  let current = cmd
  let parent: CommandDef<any> | undefined
  for (const token of rawArgs.filter(a => !a.startsWith('-'))) {
    const subs = await (typeof current.subCommands === 'function' ? current.subCommands() : current.subCommands)
    const next = subs?.[token]
    if (!next) break
    parent = current
    current = await (typeof next === 'function' ? (next as () => Promise<CommandDef<any>>)() : next)
  }
  return [current, parent]
}

// citty's runMain hard-codes exit code 1, so we own the top level to honour the exit-code contract.
export async function main(rawArgs = process.argv.slice(2)) {
  // Hidden hook for the shell completion scripts: it must see flags like --help as plain words, so it
  // bypasses citty's parsing, and it must never fail or print errors into the user's prompt.
  if (rawArgs[0] === '__complete') {
    try {
      const { complete, renderCandidates } = await import('./completion')
      const words = rawArgs.slice(rawArgs[1] === '--' ? 2 : 1)
      const out = renderCandidates(await complete(root, words.length ? words : ['']))
      if (out) console.log(out)
    }
    catch {}
    return
  }
  const json = rawArgs.includes('--json')
  const stderrStyle = createStyle(colorEnabled(process.stderr, !rawArgs.includes('--no-color')))
  try {
    if (rawArgs.some(a => a === '--help' || a === '-h')) {
      console.log(await renderUsage(...await resolveUsageTarget(root, rawArgs)))
      return
    }
    if (rawArgs.length === 1 && (rawArgs[0] === '--version' || rawArgs[0] === '-v')) {
      console.log(version)
      return
    }
    await runCommand(root, { rawArgs })
  }
  catch (err) {
    const code = reportError(err, json, stderrStyle)
    // Only parse errors (unknown command, missing argument) warrant the usage dump.
    if (!json && (err as Error)?.name === 'CLIError') {
      console.error(`\n${await renderUsage(...await resolveUsageTarget(root, rawArgs))}`)
    }
    process.exitCode = code
  }
  finally {
    await runCleanups().catch(err => console.error(`${stderrStyle.yellow('warning:')} cleanup failed: ${err instanceof Error ? err.message : err}`))
  }
}

export { exitCodeFor }
