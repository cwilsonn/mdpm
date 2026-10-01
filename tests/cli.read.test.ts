import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)
const cli = (args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) => runCli(args, { scratch: scratch.dir, ...opts })

describe('exit codes and output modes', () => {
  it('prints the version and exits 0', async () => {
    const r = await cli(['--version'])
    assert.equal(r.code, 0)
    assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/)
  })

  it('exits 2 and shows usage for an unknown command', async () => {
    const r = await cli(['nope'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /USAGE/)
  })

  it('exits 2 for a missing required argument', async () => {
    assert.equal((await cli(['task', 'show'])).code, 2)
  })

  it('exits 4 with a JSON error body when --json is set', async () => {
    const r = await cli(['task', 'show', 'zzz', '--project', 'alpha', '--json'])
    assert.equal(r.code, 4)
    assert.equal(JSON.parse(r.stderr).error.code, 4)
    assert.equal(r.stdout, '')
  })

  it('exits 2 for an ambiguous ref without dumping usage', async () => {
    const r = await cli(['task', 'show', 'write', '--project', 'alpha'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /matches 3 tasks/)
    assert.doesNotMatch(r.stderr, /USAGE/)
  })

  it('exits 2 for an invalid enum flag', async () => {
    const r = await cli(['task', 'list', '--project', 'alpha', '--status', 'nope'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /not one of/)
  })

  it('never colors output when NO_COLOR is set', async () => {
    assert.doesNotMatch((await cli(['project', 'list'])).stdout, /\x1b\[/)
  })
})

describe('read commands (--json)', () => {
  it('ping reports content and an unreachable server without failing', async () => {
    const r = await cli(['ping', '--json'])
    assert.equal(r.code, 0)
    assert.equal(r.json.serverUp, false)
    assert.deepEqual(r.json.projects.sort(), ['alpha', 'beta', 'gamma'])
  })

  it('project list hides archived unless asked', async () => {
    assert.deepEqual((await cli(['project', 'list', '--json'])).json.map((p: any) => p.slug).sort(), ['alpha', 'beta'])
    assert.equal((await cli(['project', 'list', '--include-archived', '--json'])).json.length, 3)
  })

  it('project show counts tasks by status', async () => {
    const { json } = await cli(['project', 'show', 'alp', '--json'])
    assert.equal(json.slug, 'alpha')
    assert.equal(json.tasksByStatus['in-progress'], 1)
  })

  it('task list filters and omits bodies', async () => {
    const { json } = await cli(['task', 'list', '--project', 'alpha', '--status', 'todo,blocked', '--priority', 'urgent,medium', '--json'])
    assert.deepEqual(json.map((t: any) => t.slug).sort(), ['fix-login-bug', 'shared-task', 'write-tests'])
    assert.ok(json.every((t: any) => !('body' in t)))
  })

  it('task list --all spans projects', async () => {
    const { json } = await cli(['task', 'list', '--all', '--json'])
    assert.ok(new Set(json.map((t: any) => t.project)).size >= 2)
  })

  it('task show resolves a fragment and returns the body', async () => {
    const { json } = await cli(['task', 'show', 'parser', '--project', 'alpha', '--json'])
    assert.equal(json.slug, 'write-parser')
    assert.match(json.body, /Implement the parser/)
  })

  it('task search finds by body text', async () => {
    const { json } = await cli(['task', 'search', 'upstream', '--project', 'alpha', '--json'])
    assert.deepEqual(json.map((t: any) => t.slug), ['fix-login-bug'])
  })

  it('doc list honours --tag, --standalone and archiving', async () => {
    assert.deepEqual((await cli(['doc', 'list', '--project', 'alpha', '--tag', 'architecture', '--json'])).json.map((d: any) => d.slug), ['architecture'])
    assert.deepEqual((await cli(['doc', 'list', '--standalone', '--json'])).json.map((d: any) => d.slug), ['standalone-guide'])
    assert.ok(!(await cli(['doc', 'list', '--project', 'alpha', '--json'])).json.some((d: any) => d.slug === 'old-child'))
  })

  it('doc show prints only the body in human mode', async () => {
    const r = await cli(['doc', 'show', 'architecture', '--project', 'alpha'])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /^## Stack/)
    assert.doesNotMatch(r.stdout, /Architecture\n/)
  })

  it('doc search returns excerpts', async () => {
    const { json } = await cli(['doc', 'search', 'onboarding', '--all', '--json'])
    assert.deepEqual(json.map((d: any) => d.slug), ['standalone-guide'])
  })

  it('pickup picks the newest session notes regardless of slug shape', async () => {
    const { json } = await cli(['pickup', 'alpha', '--json'])
    assert.equal(json.lastSessionNotes.slug, '2026-07-08-2214-session-notes')
    assert.equal(json.openTaskCount, 6)
  })

  it('pickup renders the briefing structure in human mode', async () => {
    const out = (await cli(['pickup', 'alpha'])).stdout
    for (const heading of ['## Session Briefing: alpha', '### Open Tasks (6)', '### Docs', '### Last Session Notes', '### Suggested Focus']) {
      assert.ok(out.includes(heading), `missing ${heading}`)
    }
    assert.match(out, /⭐ Architecture/)
  })
})

describe('config and project inference', () => {
  it('config show reports each value with its source', async () => {
    const { json } = await cli(['config', 'show', '--json'])
    assert.equal(json.contentPath.source, 'env')
    assert.equal(json.baseUrl.source, 'env')
    assert.equal(json.autoStart.value, false)
  })

  it('flags beat env', async () => {
    const { json } = await cli(['config', 'show', '--url', 'http://flag.test:9', '--json'])
    assert.deepEqual([json.baseUrl.value, json.baseUrl.source, json.port.value], ['http://flag.test:9', 'flag', 9])
  })

  describe('inside a git repo', () => {
    let repo: string
    before(() => {
      repo = join(scratch.dir, 'some-checkout')
      mkdirSync(repo)
      execFileSync('git', ['init', '-q'], { cwd: repo })
      execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:test/alpha.git'], { cwd: repo })
    })

    it('infers the project from the git remote', async () => {
      const { json } = await cli(['config', 'show', '--json'], { cwd: repo })
      assert.deepEqual([json.project.slug, json.project.via], ['alpha', 'git-remote'])
    })

    it('infers the project from a non-GitHub remote too', async () => {
      const other = join(scratch.dir, 'gitlab-checkout')
      mkdirSync(other)
      execFileSync('git', ['init', '-q'], { cwd: other })
      execFileSync('git', ['remote', 'add', 'origin', 'git@gitlab.corp.example:test/alpha.git'], { cwd: other })
      const { json } = await cli(['config', 'show', '--json'], { cwd: other })
      assert.deepEqual([json.project.slug, json.project.via, json.project.detail], ['alpha', 'git-remote', 'test/alpha'])
    })

    it('scopes task list to the inferred project', async () => {
      const { json } = await cli(['task', 'list', '--json'], { cwd: repo })
      assert.ok(json.every((t: any) => t.project === 'alpha'))
    })
  })

  it('asks for a project when none can be inferred', async () => {
    const r = await cli(['task', 'add', 'Something'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /no project/)
  })
})
