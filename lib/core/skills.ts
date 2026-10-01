import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { REPO_ROOT } from './config'
import { samePath } from './paths'

// Claude Code skills live in `skills/` in this repo and are installed as symlinks into the
// Claude commands directory, so a `git pull` updates them. Only symlinks that point at this
// checkout are ever treated as ours; anything else is reported and left alone unless forced.

export type SkillState =
  | 'linked' // symlink to this checkout's skill
  | 'missing' // nothing there yet
  | 'conflict' // a regular file with the same name
  | 'foreign' // a symlink that points somewhere else
  | 'stale' // symlink into this checkout's skills/ whose source no longer exists

export interface SkillStatus {
  name: string
  state: SkillState
  target: string
  detail?: string
}

export type SkillAction = 'created' | 'unchanged' | 'replaced' | 'backed-up' | 'removed' | 'skipped'

export interface SkillResult extends SkillStatus {
  action: SkillAction
}

export const skillsSourceDir = () => join(REPO_ROOT, 'skills')

// `$CLAUDE_CONFIG_DIR/commands`, else `~/.claude/commands`.
export function defaultSkillsTarget(env: NodeJS.ProcessEnv = process.env) {
  return join(env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'commands')
}

const sourceNames = () => readdirSync(skillsSourceDir()).filter(f => f.endsWith('.md')).sort()

function linkTarget(path: string) {
  return resolve(dirname(path), readlinkSync(path))
}

function inspect(name: string, target: string): SkillStatus {
  const dest = join(target, name)
  const source = join(skillsSourceDir(), name)
  let stat
  try {
    stat = lstatSync(dest)
  }
  catch {
    return { name, state: 'missing', target: dest }
  }
  if (!stat.isSymbolicLink()) return { name, state: 'conflict', target: dest, detail: 'a regular file is in the way' }
  const points = linkTarget(dest)
  if (samePath(points, source)) return { name, state: 'linked', target: dest }
  return { name, state: 'foreign', target: dest, detail: `points to ${points}` }
}

// Symlinks in the target that point into our skills/ dir but whose source was removed or renamed.
function staleLinks(target: string, known: string[]): SkillStatus[] {
  if (!existsSync(target)) return []
  const prefix = `${skillsSourceDir()}/`
  return readdirSync(target)
    .filter(name => !known.includes(name))
    .flatMap((name) => {
      const dest = join(target, name)
      try {
        if (!lstatSync(dest).isSymbolicLink()) return []
        const points = linkTarget(dest)
        return points.startsWith(prefix) && !existsSync(points) ? [{ name, state: 'stale' as const, target: dest, detail: 'source skill no longer exists' }] : []
      }
      catch {
        return []
      }
    })
}

export function skillsStatus(target = defaultSkillsTarget()): SkillStatus[] {
  const names = sourceNames()
  return [...names.map(name => inspect(name, target)), ...staleLinks(target, names)]
}

function backupPath(dest: string) {
  let candidate = `${dest}.bak`
  for (let i = 1; existsSync(candidate); i++) candidate = `${dest}.bak${i}`
  return candidate
}

export function installSkills(target = defaultSkillsTarget(), opts: { force?: boolean } = {}): SkillResult[] {
  mkdirSync(target, { recursive: true })
  return skillsStatus(target).map((skill): SkillResult => {
    const dest = skill.target
    const source = join(skillsSourceDir(), skill.name)
    switch (skill.state) {
      case 'linked':
        return { ...skill, action: 'unchanged' }
      case 'stale':
        rmSync(dest)
        return { ...skill, action: 'removed' }
      case 'missing':
        symlinkSync(source, dest)
        return { ...skill, action: 'created' }
      case 'foreign':
      case 'conflict': {
        if (!opts.force) return { ...skill, action: 'skipped' }
        if (skill.state === 'foreign') {
          rmSync(dest)
          symlinkSync(source, dest)
          return { ...skill, action: 'replaced' }
        }
        // A real file may hold the user's own edits: move it aside rather than delete it.
        const backup = backupPath(dest)
        renameSync(dest, backup)
        symlinkSync(source, dest)
        return { ...skill, action: 'backed-up', detail: `original moved to ${backup}` }
      }
    }
  })
}

// Removes only our own links (and stale ones); regular files and foreign symlinks are never touched.
export function uninstallSkills(target = defaultSkillsTarget()): SkillResult[] {
  return skillsStatus(target).map((skill): SkillResult => {
    if (skill.state === 'linked' || skill.state === 'stale') {
      rmSync(skill.target)
      return { ...skill, action: 'removed' }
    }
    return { ...skill, action: skill.state === 'missing' ? 'unchanged' : 'skipped' }
  })
}
