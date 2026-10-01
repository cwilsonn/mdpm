import { homedir } from 'node:os'
import { defineCommand } from 'citty'
import { defaultSkillsTarget, installSkills, skillsStatus, uninstallSkills, type SkillResult, type SkillStatus } from '../../lib/core'
import { globalArgs, type Context, createContext } from '../context'
import { CliError, emit, table } from '../output'

const tildify = (p: string) => p.startsWith(homedir()) ? `~${p.slice(homedir().length)}` : p

const targetArg = {
  target: { type: 'string', description: 'Commands directory (default: $CLAUDE_CONFIG_DIR/commands, else ~/.claude/commands)' },
} as const

const resolveTarget = (flag?: string) => flag ?? defaultSkillsTarget()

function render(ctx: Context, rows: (SkillStatus & { action?: string })[]) {
  const colored = (state: string) =>
    state === 'linked' || state === 'created' || state === 'unchanged' || state === 'removed' ? ctx.style.green(state) : ctx.style.yellow(state)
  const header = rows.some(r => r.action) ? 'RESULT' : 'STATE'
  return table(rows.map(r => [r.name, colored(r.action ?? r.state), r.detail ?? '']), ['SKILL', header, 'DETAIL'])
}

const status = defineCommand({
  meta: { name: 'status', description: 'Show which skills are linked, missing, or in conflict (exit 1 unless all are linked)' },
  args: { ...globalArgs, ...targetArg },
  run({ args }) {
    const ctx = createContext(args)
    const target = resolveTarget(args.target)
    const rows = skillsStatus(target)
    emit(ctx.json, { target, skills: rows }, () => `${ctx.style.dim(tildify(target))}\n${render(ctx, rows)}`)
    if (rows.some(r => r.state !== 'linked')) process.exitCode = 1
  },
})

const install = defineCommand({
  meta: { name: 'install', description: 'Symlink skills/*.md into the Claude commands directory (idempotent)' },
  args: {
    ...globalArgs,
    ...targetArg,
    force: { type: 'boolean', description: 'Replace foreign symlinks and move conflicting files aside as .bak', default: false },
  },
  run({ args }) {
    const ctx = createContext(args)
    const target = resolveTarget(args.target)
    const results = installSkills(target, { force: args.force })
    emit(ctx.json, { target, skills: results }, () => `${ctx.style.dim(tildify(target))}\n${render(ctx, results)}`)
    const skipped = results.filter((r: SkillResult) => r.action === 'skipped')
    if (skipped.length) {
      throw new CliError(`${skipped.length} skill${skipped.length === 1 ? '' : 's'} not installed because something else is in the way (${skipped.map(s => s.name).join(', ')}); inspect it, or rerun with --force`)
    }
  },
})

const uninstall = defineCommand({
  meta: { name: 'uninstall', description: 'Remove the symlinks this checkout installed (never touches other files)' },
  args: { ...globalArgs, ...targetArg },
  run({ args }) {
    const ctx = createContext(args)
    const target = resolveTarget(args.target)
    const results = uninstallSkills(target)
    emit(ctx.json, { target, skills: results }, () => `${ctx.style.dim(tildify(target))}\n${render(ctx, results)}`)
  },
})

export default defineCommand({
  meta: { name: 'skills', description: 'Install the Claude Code skills from this checkout' },
  subCommands: { install, uninstall, status },
})
