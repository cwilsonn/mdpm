import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { mockApi, REPO, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)
let api: Awaited<ReturnType<typeof mockApi>>
before(async () => { api = await mockApi() })
after(() => api.close())
beforeEach(() => { api.requests.length = 0 })

const EDITOR = `node ${join(REPO, 'tests/fixtures/fake-editor.mjs')}`
const cli = (args: string[], env: Record<string, string> = {}, input?: string) =>
  runCli(args, { scratch: scratch.dir, env: { MDPM_BASE_URL: api.url, ...env }, input })
const writes = () => api.requests.filter(r => r.method !== 'GET' && r.path !== '/api/health')
const last = () => writes().at(-1)!

describe('doc create', () => {
  it('creates a project doc with body, tags, and a resolved parent', async () => {
    const r = await cli(['doc', 'create', 'Release notes', '--project', 'alpha', '--body', 'hello', '--tags', 'a,b', '--parent', 'arch', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json, { project: 'alpha', slug: 'created-slug' })
    assert.deepEqual([last().method, last().path], ['POST', '/api/docs/alpha'])
    assert.deepEqual(last().body, { title: 'Release notes', body: 'hello', tags: ['a', 'b'], parent: 'architecture' })
  })

  it('creates a standalone doc and reads the body from stdin', async () => {
    const r = await cli(['doc', 'create', 'Guide', '--standalone', '--body', '-'], {}, 'from stdin\n')
    assert.equal(r.code, 0, r.stderr)
    assert.equal(last().path, '/api/standalone-docs')
    assert.equal(last().body.body, 'from stdin')
  })

  it('--edit composes the body in $EDITOR', async () => {
    const r = await cli(['doc', 'create', 'Composed', '--project', 'alpha', '--edit'], { EDITOR, FAKE_EDITOR_APPEND: 'typed in the editor\n' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(last().body.body, 'typed in the editor')
  })

  it('needs a scope when it cannot infer a project', async () => {
    const r = await cli(['doc', 'create', 'Nowhere'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /--project or --standalone/)
    assert.equal(writes().length, 0)
  })

  it('rejects an unknown parent before sending anything', async () => {
    const r = await cli(['doc', 'create', 'Orphan', '--project', 'alpha', '--parent', 'zzz-nope'])
    assert.equal(r.code, 4)
    assert.equal(writes().length, 0)
  })
})

describe('doc edit', () => {
  it('opens the current body in $EDITOR and sends the change', async () => {
    const log = join(scratch.dir, 'seen-body.txt')
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--json'], { EDITOR, FAKE_EDITOR_LOG: log, FAKE_EDITOR_APPEND: '\nAdded line.\n' })
    assert.equal(r.code, 0, r.stderr)
    assert.match(readFileSync(log, 'utf8'), /^## Stack/, 'the editor starts from the existing body')
    assert.deepEqual([last().method, last().path], ['PATCH', '/api/docs/alpha/architecture'])
    assert.match(last().body.body, /## Stack[\s\S]*Added line\.$/)
    assert.deepEqual(r.json.updated, ['body'])
  })

  it('sends nothing when the editor leaves the body unchanged', async () => {
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--json'], { EDITOR })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json.updated, [])
    assert.equal(writes().length, 0)
  })

  it('saves nothing and fails when the editor exits non-zero', async () => {
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha'], { EDITOR, FAKE_EDITOR_APPEND: 'x', FAKE_EDITOR_EXIT: '3' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /editor exited with 3/)
    assert.equal(writes().length, 0)
  })

  it('--body replaces the body without an editor (stdin works too)', async () => {
    await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--body', '-'], {}, 'scripted body\n')
    assert.equal(last().body.body, 'scripted body')
  })

  it('patches metadata with flags: title, tags, parent, and parent none', async () => {
    await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--title', 'Renamed', '--tags', 'x,y', '--parent', 'none'])
    assert.deepEqual(last().body, { title: 'Renamed', tags: ['x', 'y'], parent: null })
  })

  it('edits a standalone doc through the standalone route', async () => {
    await cli(['doc', 'edit', 'standalone-guide', '--standalone', '--body', 'new'])
    assert.equal(last().path, '/api/standalone-docs/standalone-guide')
  })

  it('without an editor configured and no terminal, explains the alternatives', async () => {
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha'], { EDITOR: '', VISUAL: '' })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /set \$EDITOR/)
    assert.match(r.stderr, /--body/)
  })

  it('exit 4 for an unknown doc', async () => {
    assert.equal((await cli(['doc', 'edit', 'zzz-nope', '--project', 'alpha', '--body', 'x'])).code, 4)
  })
})

describe('doc archive / unarchive / delete', () => {
  it('archive and unarchive toggle archivedAt', async () => {
    await cli(['doc', 'archive', 'architecture', '--project', 'alpha'])
    assert.match(last().body.archivedAt, /^\d{4}-/)
    await cli(['doc', 'unarchive', 'old-folder', '--project', 'alpha'])
    assert.deepEqual([last().path, last().body], ['/api/docs/alpha/old-folder', { archivedAt: null }])
  })

  it('archives a standalone doc', async () => {
    await cli(['doc', 'archive', 'standalone-guide', '--standalone'])
    assert.equal(last().path, '/api/standalone-docs/standalone-guide')
  })

  it('delete needs --yes without a terminal, then deletes', async () => {
    const refused = await cli(['doc', 'delete', 'architecture', '--project', 'alpha'])
    assert.equal(refused.code, 2)
    assert.equal(writes().length, 0)
    assert.equal((await cli(['doc', 'delete', 'architecture', '--project', 'alpha', '--yes'])).code, 0)
    assert.deepEqual([last().method, last().path], ['DELETE', '/api/docs/alpha/architecture'])
    await cli(['doc', 'delete', 'standalone-guide', '--standalone', '--yes'])
    assert.deepEqual([last().method, last().path], ['DELETE', '/api/standalone-docs/standalone-guide'])
  })
})
