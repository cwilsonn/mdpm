import { strict as assert } from 'node:assert'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { mockApi, readContent, resetContent, runCli, scratchDir } from './helpers'

// Writes go straight to the files (no server), so these assert on the scratch copy of the fixtures.
const scratch = scratchDir()
after(scratch.cleanup)

let content: string
beforeEach(() => { content = resetContent(scratch.dir) })

// Unroutable server URL (the isolatedEnv default): a write that still needed the server would fail.
const cli = (args: string[], input?: string) => runCli(args, { scratch: scratch.dir, input })
const task = (slug: string, project = 'alpha') => readContent(scratch.dir, `projects/${project}/tasks/${slug}.md`)
const project = (slug: string) => readContent(scratch.dir, `projects/${slug}/index.md`)
const tasksIn = (p: string) => readdirSync(join(content, 'projects', p, 'tasks')).sort()

describe('task writes go to the files', () => {
  it('add writes the fields', async () => {
    const r = await cli(['task', 'add', 'New thing', '--project', 'alpha', '--priority', 'high', '--tags', 'a,b', '--due', '2026-12-01', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json, { project: 'alpha', slug: 'new-thing' })
    const t = task('new-thing')!
    assert.equal(t.data.title, 'New thing')
    assert.equal(t.data.priority, 'high')
    assert.deepEqual(t.data.tags, ['a', 'b'])
    assert.equal(t.data.due, '2026-12-01')
  })

  it('add reads the description from stdin with -', async () => {
    await cli(['task', 'add', 'From stdin', '--project', 'alpha', '--description', '-'], 'piped body\n')
    assert.equal(task('from-stdin')!.body, 'piped body')
  })

  it('add never overwrites: a taken slug gets a suffix', async () => {
    await cli(['task', 'add', 'Write parser', '--project', 'alpha'])
    assert.ok(task('write-parser-2'))
    assert.match(task('write-parser')!.body, /^Implement the parser/)
  })

  it('set changes only the given fields and maps --due none to null', async () => {
    const before = task('write-parser')!
    const r = await cli(['task', 'set', 'parser', '--project', 'alpha', '--status', 'blocked', '--due', 'none', '--json'])
    assert.equal(r.code, 0, r.stderr)
    const t = task('write-parser')!
    assert.equal(t.data.status, 'blocked')
    assert.equal(t.data.due, undefined)
    assert.equal(t.data.title, before.data.title)
    assert.equal(t.body, before.body)
    assert.match(t.data.updatedAt, /^\d{4}-\d\d-\d\dT/)
  })

  it('set with no fields is a usage error and writes nothing', async () => {
    const before = task('write-parser')
    const r = await cli(['task', 'set', 'parser', '--project', 'alpha'])
    assert.equal(r.code, 2)
    assert.deepEqual(task('write-parser'), before)
  })

  it('done sets status and completedAt', async () => {
    await cli(['task', 'done', 'login', '--project', 'alpha'])
    const t = task('fix-login-bug')!
    assert.equal(t.data.status, 'done')
    assert.match(t.data.completedAt, /^\d{4}-/)
  })

  it('note appends a timestamped note to the existing body', async () => {
    await cli(['task', 'note', 'write-parser', 'hello note', '--project', 'alpha', '--author', 'Sam'])
    assert.match(task('write-parser')!.body, /^Implement the parser[\s\S]*\n\n---\n\*\*Note\*\* _\(\d{4}-\d\d-\d\d \d\d:\d\d\)_ by Sam\n\nhello note$/)
  })

  it('archive and unarchive toggle archivedAt', async () => {
    await cli(['task', 'archive', 'parser', '--project', 'alpha'])
    assert.match(task('write-parser')!.data.archivedAt, /^\d{4}-/)
    await cli(['task', 'unarchive', 'old-idea', '--project', 'alpha'])
    assert.equal(task('old-idea')!.data.archivedAt, undefined)
  })

  it('delete needs --yes when stdin is not a terminal', async () => {
    const refused = await cli(['task', 'delete', 'parser', '--project', 'alpha'])
    assert.equal(refused.code, 2)
    assert.ok(task('write-parser'))
    const ok = await cli(['task', 'delete', 'parser', '--project', 'alpha', '--yes'])
    assert.equal(ok.code, 0)
    assert.equal(task('write-parser'), undefined)
  })

  it('resolves refs before writing, so an ambiguous ref writes nothing', async () => {
    const before = tasksIn('alpha').map(f => task(f.replace(/\.md$/, '')))
    const r = await cli(['task', 'done', 'write', '--project', 'alpha'])
    assert.equal(r.code, 2)
    assert.deepEqual(tasksIn('alpha').map(f => task(f.replace(/\.md$/, ''))), before)
  })

  it('leaves no temp or lock files behind', async () => {
    await cli(['task', 'note', 'write-parser', 'one', '--project', 'alpha'])
    await cli(['task', 'add', 'Another', '--project', 'alpha'])
    assert.deepEqual(tasksIn('alpha').filter(f => f.startsWith('.')), [])
  })
})

describe('project writes go to the files', () => {
  it('create writes the fields', async () => {
    const r = await cli(['project', 'create', 'New Project', '--tags', 'x', '--repo', 'https://github.com/me/new', '--json'])
    assert.equal(r.code, 0, r.stderr)
    const p = project('new-project')!
    assert.equal(p.data.title, 'New Project')
    assert.deepEqual(p.data.tags, ['x'])
    assert.equal(p.data.repo, 'https://github.com/me/new')
  })

  it('archive sets archivedAt on the resolved project', async () => {
    await cli(['project', 'archive', 'bet'])
    assert.match(project('beta')!.data.archivedAt, /^\d{4}-/)
  })
})

describe('project set and delete', () => {
  it('set changes only the given fields, with "none" clearing optional ones', async () => {
    const r = await cli(['project', 'set', 'alp', '--title', 'Alpha 2', '--tags', 'a,b', '--repo', 'none', '--default-priority', 'high', '--json'])
    assert.equal(r.code, 0, r.stderr)
    const p = project('alpha')!
    assert.equal(p.data.title, 'Alpha 2')
    assert.deepEqual(p.data.tags, ['a', 'b'])
    assert.equal(p.data.repo, undefined)
    assert.equal(p.data.defaultPriority, 'high')
    assert.deepEqual(r.json.updated.sort(), ['defaultPriority', 'repo', 'tags', 'title'])
  })

  it('set with no fields is a usage error and writes nothing', async () => {
    const before = project('alpha')
    const r = await cli(['project', 'set', 'alpha'])
    assert.equal(r.code, 2)
    assert.deepEqual(project('alpha'), before)
  })

  it('set rejects an invalid default priority', async () => {
    assert.equal((await cli(['project', 'set', 'alpha', '--default-priority', 'nope'])).code, 2)
  })

  it('delete needs --yes without a terminal, then deletes', async () => {
    const refused = await cli(['project', 'delete', 'beta'])
    assert.equal(refused.code, 2)
    assert.ok(project('beta'))
    assert.equal((await cli(['project', 'delete', 'beta', '--yes'])).code, 0)
    assert.equal(existsSync(join(content, 'projects/beta')), false)
  })
})

describe('failures', () => {
  it('writes need no server', async () => {
    const r = await cli(['task', 'done', 'parser', '--project', 'alpha'])
    assert.equal(r.code, 0, r.stderr)
  })

  it('surfaces the write error message with exit 1', async () => {
    const r = await cli(['task', 'add', '!!!', '--project', 'alpha'])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /Title produces an empty slug/)
  })
})

describe('ping', () => {
  let api: Awaited<ReturnType<typeof mockApi>>
  before(async () => {
    api = await mockApi(req => req.path === '/api/health' ? { body: { ok: true, contentRoot: '/somewhere/else' } } : {})
  })
  after(() => api.close())

  it('reports a server that uses a different content directory', async () => {
    const r = await runCli(['ping', '--json'], { scratch: scratch.dir, env: { MDPM_BASE_URL: api.url } })
    assert.equal(r.code, 0)
    assert.deepEqual([r.json.serverContentPath, r.json.contentMismatch], ['/somewhere/else', true])
  })
})
