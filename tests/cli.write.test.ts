import { strict as assert } from 'node:assert'
import { after, before, beforeEach, describe, it } from 'node:test'
import { mockApi, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

let api: Awaited<ReturnType<typeof mockApi>>
let failWith: { status: number; body: unknown } | undefined
before(async () => { api = await mockApi(() => failWith ?? {}) })
after(() => api.close())
beforeEach(() => { api.requests.length = 0; failWith = undefined })

const cli = (args: string[], input?: string) =>
  runCli(args, { scratch: scratch.dir, env: { MDPM_BASE_URL: api.url }, input })
const last = () => api.requests.at(-1)!

describe('task writes hit the API', () => {
  it('add posts the fields', async () => {
    const r = await cli(['task', 'add', 'New thing', '--project', 'alpha', '--priority', 'high', '--tags', 'a,b', '--github-issues', '3,4', '--due', '2026-12-01', '--json'])
    assert.equal(r.code, 0)
    assert.deepEqual(r.json, { project: 'alpha', slug: 'created-slug' })
    assert.equal(last().method, 'POST')
    assert.equal(last().path, '/api/tasks')
    assert.deepEqual(last().body, { project: 'alpha', title: 'New thing', priority: 'high', tags: ['a', 'b'], githubIssues: [3, 4], due: '2026-12-01' })
  })

  it('add reads the description from stdin with -', async () => {
    await cli(['task', 'add', 'From stdin', '--project', 'alpha', '--description', '-'], 'piped body\n')
    assert.equal(last().body.description, 'piped body')
  })

  it('set patches only the given fields and maps --due none to null', async () => {
    const r = await cli(['task', 'set', 'parser', '--project', 'alpha', '--status', 'blocked', '--due', 'none', '--json'])
    assert.equal(r.code, 0)
    assert.equal(last().method, 'PATCH')
    assert.equal(last().path, '/api/tasks/alpha/write-parser')
    assert.deepEqual(last().body, { status: 'blocked', due: null })
  })

  it('set with no fields is a usage error and sends nothing', async () => {
    const r = await cli(['task', 'set', 'parser', '--project', 'alpha'])
    assert.equal(r.code, 2)
    assert.equal(api.requests.length, 0)
  })

  it('done sets status', async () => {
    await cli(['task', 'done', 'login', '--project', 'alpha'])
    assert.deepEqual(last().body, { status: 'done' })
  })

  it('note appends a timestamped note to the existing body', async () => {
    await cli(['task', 'note', 'write-parser', 'hello note', '--project', 'alpha'])
    assert.match(last().body.description, /^Implement the parser[\s\S]*\n\n---\n\*\*Note\*\* _\(\d{4}-\d\d-\d\d \d\d:\d\d\)_\n\nhello note$/)
  })

  it('archive and unarchive toggle archivedAt', async () => {
    await cli(['task', 'archive', 'parser', '--project', 'alpha'])
    assert.match(last().body.archivedAt, /^\d{4}-/)
    await cli(['task', 'unarchive', 'old-idea', '--project', 'alpha'])
    assert.deepEqual(last().body, { archivedAt: null })
  })

  it('delete needs --yes when stdin is not a terminal', async () => {
    const refused = await cli(['task', 'delete', 'parser', '--project', 'alpha'])
    assert.equal(refused.code, 2)
    assert.equal(api.requests.length, 0)
    const ok = await cli(['task', 'delete', 'parser', '--project', 'alpha', '--yes'])
    assert.equal(ok.code, 0)
    assert.equal(last().method, 'DELETE')
    assert.equal(last().path, '/api/tasks/alpha/write-parser')
  })

  it('resolves refs before writing, so an ambiguous ref sends nothing', async () => {
    const r = await cli(['task', 'done', 'write', '--project', 'alpha'])
    assert.equal(r.code, 2)
    assert.equal(api.requests.length, 0)
  })
})

describe('project writes hit the API', () => {
  it('create posts the fields', async () => {
    const r = await cli(['project', 'create', 'New Project', '--tags', 'x', '--github-repo', 'me/new', '--json'])
    assert.equal(r.code, 0)
    assert.equal(last().path, '/api/projects')
    assert.deepEqual(last().body, { title: 'New Project', tags: ['x'], githubRepo: 'me/new' })
  })

  it('archive patches archivedAt on the resolved project', async () => {
    await cli(['project', 'archive', 'bet'])
    assert.equal(last().path, '/api/projects/beta')
    assert.match(last().body.archivedAt, /^\d{4}-/)
  })
})

describe('failures', () => {
  it('exits 3 with a hint when the server is unreachable', async () => {
    const r = await runCli(['task', 'done', 'parser', '--project', 'alpha'], { scratch: scratch.dir })
    assert.equal(r.code, 3)
    assert.match(r.stderr, /unreachable/)
    assert.match(r.stderr, /--auto-start/)
  })

  it('surfaces the API error message with exit 1', async () => {
    failWith = { status: 400, body: { message: 'Title is required' } }
    const r = await cli(['task', 'add', 'x', '--project', 'alpha'])
    assert.equal(r.code, 1)
    assert.match(r.stderr, /Title is required/)
  })
})
