import { strict as assert } from 'node:assert'
import { lstatSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { defaultSkillsTarget, installSkills, skillsSourceDir, skillsStatus, uninstallSkills } from '../lib/core'
import { REPO, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)
let target: string
let n = 0
beforeEach(() => { target = join(scratch.dir, `commands-${n++}`) })

const states = (t: string) => Object.fromEntries(skillsStatus(t).map(s => [s.name, s.state]))
const cli = (args: string[], env: Record<string, string> = {}) => runCli(args, { scratch: scratch.dir, env })

describe('skills core', () => {
  it('reports every skill missing for an empty target', () => {
    const all = states(target)
    assert.ok(Object.keys(all).length >= 5)
    assert.ok(Object.values(all).every(s => s === 'missing'))
  })

  it('installs symlinks into this checkout, creating the directory', () => {
    const results = installSkills(target)
    assert.ok(results.every(r => r.action === 'created'))
    const link = join(target, 'pickup.md')
    assert.ok(lstatSync(link).isSymbolicLink())
    assert.equal(readlinkSync(link), join(skillsSourceDir(), 'pickup.md'))
    assert.ok(Object.values(states(target)).every(s => s === 'linked'))
  })

  it('is idempotent', () => {
    installSkills(target)
    assert.ok(installSkills(target).every(r => r.action === 'unchanged'))
  })

  it('does not clobber a regular file or a foreign symlink without force', () => {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'pickup.md'), 'my edits')
    symlinkSync('/etc/hosts', join(target, 'sync.md'))
    const results = installSkills(target)
    assert.deepEqual(results.filter(r => r.action === 'skipped').map(r => r.name).sort(), ['pickup.md', 'sync.md'])
    assert.equal(readFileSync(join(target, 'pickup.md'), 'utf8'), 'my edits')
    assert.equal(readlinkSync(join(target, 'sync.md')), '/etc/hosts')
    assert.deepEqual([states(target)['pickup.md'], states(target)['sync.md']], ['conflict', 'foreign'])
  })

  it('--force moves a real file aside and replaces a foreign symlink', () => {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'pickup.md'), 'my edits')
    writeFileSync(join(target, 'pickup.md.bak'), 'older backup')
    symlinkSync('/etc/hosts', join(target, 'sync.md'))
    installSkills(target, { force: true })
    assert.equal(readFileSync(join(target, 'pickup.md.bak1'), 'utf8'), 'my edits', 'never overwrites an existing backup')
    assert.equal(readFileSync(join(target, 'pickup.md.bak'), 'utf8'), 'older backup')
    assert.ok(Object.values(states(target)).every(s => s === 'linked'))
  })

  it('uninstall removes only our links', () => {
    installSkills(target)
    rmSync(join(target, 'sync.md'))
    writeFileSync(join(target, 'sync.md'), 'not ours')
    writeFileSync(join(target, 'unrelated.md'), 'keep')
    const removed = uninstallSkills(target).filter(r => r.action === 'removed').map(r => r.name)
    assert.ok(removed.includes('pickup.md'))
    assert.ok(!removed.includes('sync.md'))
    assert.equal(readFileSync(join(target, 'sync.md'), 'utf8'), 'not ours')
    assert.ok(existsSync(join(target, 'unrelated.md')))
    assert.ok(!existsSync(join(target, 'pickup.md')))
  })

  it('treats a link to a removed skill as stale and prunes it on install', () => {
    mkdirSync(target, { recursive: true })
    symlinkSync(join(skillsSourceDir(), 'retired-skill.md'), join(target, 'retired-skill.md'))
    assert.equal(states(target)['retired-skill.md'], 'stale')
    installSkills(target)
    assert.ok(!existsSync(join(target, 'retired-skill.md')) && !lstatSyncSafe(join(target, 'retired-skill.md')))
  })

  it('resolves the default target from CLAUDE_CONFIG_DIR', () => {
    assert.equal(defaultSkillsTarget({ CLAUDE_CONFIG_DIR: '/x/claude' }), '/x/claude/commands')
    assert.match(defaultSkillsTarget({}), /\.claude\/commands$/)
  })
})

function lstatSyncSafe(p: string) {
  try { return lstatSync(p) }
  catch { return undefined }
}

describe('skills CLI', () => {
  it('status exits 1 until everything is linked, then 0', async () => {
    assert.equal((await cli(['skills', 'status', '--target', target])).code, 1)
    assert.equal((await cli(['skills', 'install', '--target', target])).code, 0)
    const r = await cli(['skills', 'status', '--target', target, '--json'])
    assert.equal(r.code, 0)
    assert.ok(r.json.skills.every((s: any) => s.state === 'linked'))
  })

  it('install exits 1 and explains when something is in the way, 0 with --force', async () => {
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'pickup.md'), 'mine')
    const blocked = await cli(['skills', 'install', '--target', target])
    assert.equal(blocked.code, 1)
    assert.match(blocked.stderr, /pickup\.md/)
    assert.match(blocked.stderr, /--force/)
    assert.equal(readFileSync(join(target, 'pickup.md'), 'utf8'), 'mine')
    assert.equal((await cli(['skills', 'install', '--target', target, '--force'])).code, 0)
  })

  it('defaults to $CLAUDE_CONFIG_DIR/commands', async () => {
    const config = join(scratch.dir, 'claude-config')
    const r = await cli(['skills', 'install', '--json'], { CLAUDE_CONFIG_DIR: config })
    assert.equal(r.code, 0)
    assert.equal(r.json.target, join(config, 'commands'))
    assert.ok(lstatSync(join(config, 'commands', 'handoff.md')).isSymbolicLink())
  })

  it('uninstall removes what install created', async () => {
    await cli(['skills', 'install', '--target', target])
    const r = await cli(['skills', 'uninstall', '--target', target, '--json'])
    assert.equal(r.code, 0)
    assert.ok(Object.values(states(target)).every(s => s === 'missing'))
  })

  it('ships the documented skills from this checkout', () => {
    const names = skillsStatus(target).map(s => s.name)
    for (const name of ['handoff.md', 'pickup.md', 'start-mdpm.md', 'stop-mdpm.md', 'sync.md']) assert.ok(names.includes(name), name)
    assert.equal(skillsSourceDir(), join(REPO, 'skills'))
  })
})
