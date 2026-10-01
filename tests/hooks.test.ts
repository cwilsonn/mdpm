import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createCore, hookCommand, hooksStatus, installHooks, stopCheck, uninstallHooks } from '../lib/core'
import { FIXTURE_CONTENT, mockApi, REPO, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

let n = 0
// A repo whose github remote maps to the fixture project `alpha`.
function makeRepo(remote = 'git@github.com:test/alpha.git') {
  const dir = join(scratch.dir, `repo-${n++}`, 'checkout')
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
  return dir
}
const hook = (sub: 'session-start' | 'stop', cwd: string, session = 's1', raw?: string) =>
  runCli(['hooks', sub], { scratch: scratch.dir, cwd, input: raw ?? JSON.stringify({ cwd, session_id: session }) })
const settingsOf = (repo: string) => JSON.parse(readFileSync(join(repo, '.claude/settings.local.json'), 'utf8'))
const cli = (args: string[], cwd: string, env: Record<string, string> = {}) => runCli(args, { scratch: scratch.dir, cwd, env })

describe('SessionStart hook', () => {
  it('injects the reminder and open tasks for a registered repo', async () => {
    const r = await hook('session-start', makeRepo())
    assert.equal(r.code, 0, r.stderr)
    const out = JSON.parse(r.stdout).hookSpecificOutput
    assert.equal(out.hookEventName, 'SessionStart')
    assert.match(out.additionalContext, /project "alpha"/)
    assert.match(out.additionalContext, /In progress:\n- write-parser: Write the parser \[high\]/)
    assert.match(out.additionalContext, /Blocked:\n- fix-login-bug/)
    assert.match(out.additionalContext, /mdpm task note/)
    assert.ok(!out.additionalContext.includes('ship-v1'), 'done tasks are not listed')
    assert.ok(!out.additionalContext.includes('old-idea'), 'archived tasks are not listed')
  })

  it('says nothing and exits 0 outside registered repos', async () => {
    const dir = join(scratch.dir, 'not-a-project')
    mkdirSync(dir)
    const r = await hook('session-start', dir)
    assert.deepEqual([r.code, r.stdout], [0, ''])
  })

  it('survives garbage on stdin by using the working directory', async () => {
    const r = await hook('session-start', makeRepo(), 's2', 'this is not json')
    assert.equal(r.code, 0)
    assert.match(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, /alpha/)
  })

  it('records when the session started', async () => {
    await hook('session-start', makeRepo(), 'recorded')
    const saved = JSON.parse(readFileSync(join(scratch.dir, 'state/hooks/recorded.json'), 'utf8'))
    assert.equal(saved.project, 'alpha')
    assert.ok(Math.abs(Date.now() - Date.parse(saved.startedAt)) < 60_000)
  })

  it('never fails the session, even when the content directory is unusable', async () => {
    const repo = makeRepo()
    const r = await runCli(['hooks', 'session-start'], { scratch: scratch.dir, cwd: repo, input: '{}', env: { MDPM_CONTENT_PATH: '/definitely/not/here' } })
    assert.deepEqual([r.code, r.stdout], [0, ''])
  })
})

describe('Stop hook (warn only)', () => {
  it('stays quiet when nothing changed', async () => {
    const repo = makeRepo()
    await hook('session-start', repo, 'quiet')
    const r = await hook('stop', repo, 'quiet')
    assert.deepEqual([r.code, r.stdout], [0, ''])
  })

  it('warns the user once when files changed and no task was touched', async () => {
    const repo = makeRepo()
    await hook('session-start', repo, 'warn')
    writeFileSync(join(repo, 'feature.ts'), 'export {}\n')
    writeFileSync(join(repo, 'more.ts'), 'export {}\n')
    const first = await hook('stop', repo, 'warn')
    assert.equal(first.code, 0)
    const message = JSON.parse(first.stdout).systemMessage
    assert.match(message, /2 changed files in project "alpha"/)
    assert.match(message, /mdpm task note/)
    assert.ok(!('decision' in JSON.parse(first.stdout)), 'warn-only: it must never block')
    const again = await hook('stop', repo, 'warn')
    assert.equal(again.stdout, '', 'throttled: not repeated every turn')
  })

  it('ignores mdpm\'s own artifacts when deciding whether work happened', async () => {
    const repo = makeRepo()
    await hook('session-start', repo, 'artifacts')
    writeFileSync(join(repo, '.mdpm'), 'project: alpha\n')
    writeFileSync(join(repo, 'CLAUDE.local.md'), 'x\n')
    mkdirSync(join(repo, '.claude'))
    writeFileSync(join(repo, '.claude/settings.local.json'), '{}\n')
    assert.equal((await hook('stop', repo, 'artifacts')).stdout, '')
  })

  it('stays quiet when a task file was written during the session', () => {
    // A private copy of the fixture so task mtimes are under the test's control.
    const content = join(scratch.dir, 'content-copy')
    cpSync(FIXTURE_CONTENT, content, { recursive: true })
    const tasksDir = join(content, 'projects/alpha/tasks')
    const old = new Date('2026-06-10T12:00:00.000Z')
    for (const f of readdirSync(tasksDir)) utimesSync(join(tasksDir, f), old, old)
    const core = createCore({ contentPath: content, baseUrl: 'http://127.0.0.1:1' })
    const repo = makeRepo()
    writeFileSync(join(repo, 'work.ts'), 'x\n')
    const previous = process.env.MDPM_STATE_DIR
    // The hook state dir comes from the environment; point it at the scratch dir for these in-process calls.
    process.env.MDPM_STATE_DIR = join(scratch.dir, 'unit-state')
    try {
      const stateDir = join(scratch.dir, 'unit-state/hooks')
      mkdirSync(stateDir, { recursive: true })
      const begin = (startedAt: string) => writeFileSync(join(stateDir, 'unit.json'), JSON.stringify({ startedAt, project: 'alpha' }))
      const check = () => stopCheck(core, { sessionId: 'unit', cwd: repo, project: 'alpha', now: new Date('2026-10-01T01:00:00.000Z') })

      begin('2026-10-01T00:00:00.000Z') // started after every task was last written: nothing logged
      assert.match(check()!, /1 changed file/)

      begin('2026-06-01T00:00:00.000Z') // started before the task files were written: they count as logged
      assert.equal(check(), undefined)

      begin('2026-10-01T00:00:00.000Z') // a task written now (new, edited, or noted) counts
      writeFileSync(join(tasksDir, 'brand-new.md'), '---\ntitle: New\n---\n')
      assert.equal(check(), undefined)
    }
    finally {
      if (previous === undefined) delete process.env.MDPM_STATE_DIR
      else process.env.MDPM_STATE_DIR = previous
    }
  })

  it('counts commits made during the session', async () => {
    const repo = makeRepo()
    await hook('session-start', repo, 'commits')
    writeFileSync(join(repo, 'a.txt'), 'a\n')
    execFileSync('git', ['add', '.'], { cwd: repo })
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-qm', 'feat: a'], { cwd: repo })
    const r = await hook('stop', repo, 'commits')
    assert.match(JSON.parse(r.stdout).systemMessage, /1 commit in project "alpha"/)
  })

  it('exits 0 silently outside registered repos', async () => {
    const dir = join(scratch.dir, 'elsewhere')
    mkdirSync(dir)
    const r = await hook('stop', dir)
    assert.deepEqual([r.code, r.stdout], [0, ''])
  })
})

describe('installing the hooks', () => {
  it('builds commands from absolute paths', () => {
    assert.equal(hookCommand('stop', '/usr/bin/node', '/opt/mdpm/bin/mdpm.mjs'), '"/usr/bin/node" "/opt/mdpm/bin/mdpm.mjs" hooks stop')
  })

  it('writes both hooks, keeps the file out of git, and is idempotent', () => {
    const repo = makeRepo()
    assert.equal(installHooks(repo).action, 'installed')
    const settings = settingsOf(repo)
    assert.match(settings.hooks.SessionStart[0].hooks[0].command, new RegExp(`${REPO}/bin/mdpm.mjs" hooks session-start$`))
    assert.match(settings.hooks.Stop[0].hooks[0].command, /hooks stop$/)
    assert.equal(settings.hooks.SessionStart[0].hooks[0].type, 'command')
    assert.ok(readFileSync(join(repo, '.git/info/exclude'), 'utf8').split('\n').includes('.claude/settings.local.json'))
    assert.equal(installHooks(repo).action, 'unchanged')
  })

  it('preserves other settings and other hooks, and refreshes only its own entries', () => {
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude'))
    const foreign = { type: 'command', command: 'echo hi' }
    writeFileSync(join(repo, '.claude/settings.local.json'), JSON.stringify({
      permissions: { allow: ['Bash(ls:*)'] },
      hooks: { SessionStart: [{ hooks: [foreign] }], PreToolUse: [{ matcher: 'Bash', hooks: [foreign] }] },
    }))
    installHooks(repo, { node: '/old/node', bin: '/old/bin/mdpm.mjs' })
    assert.equal(installHooks(repo).action, 'updated', 'a moved checkout rewrites the commands')
    const settings = settingsOf(repo)
    assert.deepEqual(settings.permissions, { allow: ['Bash(ls:*)'] })
    assert.deepEqual(settings.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [foreign] }])
    const startCommands = settings.hooks.SessionStart.flatMap((g: any) => g.hooks.map((h: any) => h.command))
    assert.equal(startCommands.filter((c: string) => c.includes('hooks session-start')).length, 1, 'no duplicates')
    assert.ok(startCommands.includes('echo hi'))
  })

  it('uninstall removes only its own hooks', () => {
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude'))
    writeFileSync(join(repo, '.claude/settings.local.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } }))
    installHooks(repo)
    assert.equal(uninstallHooks(repo).action, 'removed')
    assert.deepEqual(settingsOf(repo), { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo keep' }] }] } })
    assert.equal(uninstallHooks(repo).action, 'absent')
    assert.deepEqual(Object.values(hooksStatus(repo).events), [false, false])
  })

  it('refuses to overwrite a settings file that is not valid JSON', () => {
    const repo = makeRepo()
    mkdirSync(join(repo, '.claude'))
    writeFileSync(join(repo, '.claude/settings.local.json'), '{ nope')
    assert.throws(() => installHooks(repo), /not valid JSON/)
    assert.equal(readFileSync(join(repo, '.claude/settings.local.json'), 'utf8'), '{ nope')
  })

  it('CLI: install, status, uninstall', async () => {
    const repo = makeRepo()
    assert.equal((await cli(['hooks', 'status'], repo)).code, 1)
    const installed = await cli(['hooks', 'install', '--json'], repo)
    assert.equal(installed.code, 0, installed.stderr)
    assert.deepEqual([installed.json.project, installed.json.action], ['alpha', 'installed'])
    assert.equal((await cli(['hooks', 'status', '--json'], repo)).code, 0)
    assert.equal((await cli(['hooks', 'uninstall'], repo)).code, 0)
    assert.equal((await cli(['hooks', 'status'], repo)).code, 1)
  })

  it('CLI: refuses to install in a repo that is not registered', async () => {
    const r = await cli(['hooks', 'install'], makeRepo('git@github.com:nobody/unknown.git'))
    assert.equal(r.code, 2)
    assert.match(r.stderr, /mdpm init/)
  })
})

describe('mdpm init --hooks', () => {
  it('installs the hooks alongside the rest, and --dry-run installs nothing', async () => {
    const api = await mockApi()
    try {
      const run = (repo: string, args: string[]) => runCli(['init', '--json', '--project', 'alpha', ...args], { scratch: scratch.dir, cwd: repo, env: { MDPM_BASE_URL: api.url } })
      const dry = makeRepo()
      const planned = await run(dry, ['--hooks', '--dry-run'])
      assert.ok(planned.json.steps.some((s: any) => s.step === 'hooks' && s.action === 'would-install'))
      assert.ok(!existsSync(join(dry, '.claude')))

      const repo = makeRepo()
      const r = await run(repo, ['--hooks'])
      assert.equal(r.code, 0, r.stderr)
      assert.ok(r.json.steps.some((s: any) => s.step === 'hooks' && s.action === 'installed'))
      assert.deepEqual(Object.values(hooksStatus(repo).events), [true, true])

      const without = makeRepo()
      await run(without, [])
      assert.ok(!existsSync(join(without, '.claude')), 'hooks are opt-in')
    }
    finally {
      await api.close()
    }
  })
})
