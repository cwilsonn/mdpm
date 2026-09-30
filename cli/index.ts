import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand, renderUsage, runCommand, type CommandDef } from 'citty'
import { REPO_ROOT } from '../lib/core'
import { colorEnabled, createStyle, ExitCode, exitCodeFor, reportError } from './output'

// Read from package.json so release-please stays the single source of truth.
const version: string = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version

export const root = defineCommand({
  meta: { name: 'mdpm', version, description: 'Markdown-based project management: projects, tasks, and docs as files' },
  subCommands: {
    config: () => import('./commands/config').then(m => m.default),
    ping: () => import('./commands/ping').then(m => m.default),
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
    if (code === ExitCode.usage && !json) {
      console.error(`\n${await renderUsage(...await resolveUsageTarget(root, rawArgs))}`)
    }
    process.exitCode = code
  }
}

export { exitCodeFor }
