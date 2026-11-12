import { strict as assert } from 'node:assert'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { createCore } from '../lib/core'
import { rejects, route } from './route-harness'
import { mockApi, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

let root: string
let n = 0
const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
const read = (rel: string) => matter(readFileSync(join(root, rel), 'utf8'))
const task = (title: string, status = 'todo', body = 'Body.') => `---\ntitle: ${title}\nstatus: ${status}\npriority: medium\ncreatedAt: '2026-10-01'\norder: 0\n---\n${body}\n`

beforeEach(() => {
  root = join(scratch.dir, `c${n++}`)
  process.env.MDPM_CONTENT_PATH = root
  put('projects/p/index.md', '---\ntitle: P\n---\n')
  put('projects/p/tasks/one.md', task('One'))
  put('projects/p/tasks/two.md', task('Two', 'in-progress', 'Spec.'))
})
after(() => { delete process.env.MDPM_CONTENT_PATH })

describe('write responses', () => {
  it('create answers with id and status, not the task', async () => {
    const post = await route('tasks/index.post')
    const r = await post({ body: { project: 'p', title: 'Fresh work', status: 'in-progress' } })
    assert.deepEqual(r, { slug: 'fresh-work', id: 'p/fresh-work', status: 'in-progress' })
    assert.equal(read('projects/p/tasks/fresh-work.md').data.status, 'in-progress')
  })

  it('update answers with id and status', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    assert.deepEqual(await patch({ params: { project: 'p', slug: 'one' }, body: { status: 'done' } }), { ok: true, id: 'p/one', status: 'done' })
  })

  it('a note on update is appended server-side with the author, without touching the spec', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    await patch({ params: { project: 'p', slug: 'two' }, body: { status: 'done', note: 'All verified.', noteAuthor: 'Sam' } })
    const f = read('projects/p/tasks/two.md')
    assert.equal(f.data.status, 'done')
    assert.ok(f.data.completedAt)
    assert.equal('note' in f.data, false)
    assert.equal('noteAuthor' in f.data, false)
    assert.match(f.content.trim(), /^Spec\.\n\n---\n\*\*Note\*\* _\(\d{4}-\d\d-\d\d \d\d:\d\d\)_ by Sam\n\nAll verified\.$/)
  })

  it('create can carry a first note', async () => {
    const post = await route('tasks/index.post')
    await post({ body: { project: 'p', title: 'Noted', description: 'Scope.', note: 'Kickoff.', noteAuthor: 'claude' } })
    assert.match(read('projects/p/tasks/noted.md').content.trim(), /^Scope\.\n\n---\n\*\*Note\*\* .* by claude\n\nKickoff\.$/)
  })
})

describe('POST /api/tasks/batch', () => {
  it('applies creates, updates and notes in order and returns only ids and statuses', async () => {
    const batch = await route('tasks/batch.post')
    const r = await batch({ body: { ops: [
      { op: 'create', project: 'p', title: 'Third', status: 'in-progress' },
      { op: 'update', project: 'p', slug: 'one', status: 'done', note: 'shipped' },
      { op: 'note', project: 'p', slug: 'two', note: 'halfway', noteAuthor: 'claude' },
    ] } })
    assert.deepEqual(r, { ok: 3, failed: 0, results: [
      { index: 0, ok: true, id: 'p/third', status: 'in-progress' },
      { index: 1, ok: true, id: 'p/one', status: 'done' },
      { index: 2, ok: true, id: 'p/two', status: 'in-progress' },
    ] })
    assert.match(read('projects/p/tasks/one.md').content.trim(), /shipped$/)
    assert.match(read('projects/p/tasks/two.md').content.trim(), /halfway$/)
  })

  it('a failing item is reported and does not stop the rest', async () => {
    const batch = await route('tasks/batch.post')
    const r = await batch({ body: { ops: [
      { op: 'update', project: 'p', slug: 'nope', status: 'done' },
      { op: 'update', project: 'p', slug: 'one', status: 'done' },
      { op: 'bogus' },
      { op: 'note', project: 'p', slug: 'one', note: '  ' },
    ] } })
    assert.equal(r.ok, 1)
    assert.equal(r.failed, 3)
    assert.match(r.results[0].error, /Task not found/)
    assert.equal(r.results[1].ok, true)
    assert.match(r.results[2].error, /Unknown op/)
    assert.match(r.results[3].error, /note is empty/)
    assert.equal(read('projects/p/tasks/one.md').data.status, 'done')
  })

  it('rejects an empty or oversized batch', async () => {
    const batch = await route('tasks/batch.post')
    assert.equal((await rejects(batch({ body: { ops: [] } }))).statusCode, 400)
    assert.equal((await rejects(batch({ body: { ops: Array.from({ length: 101 }, () => ({ op: 'note', project: 'p', slug: 'one', note: 'x' })) } }))).statusCode, 400)
  })
})

describe('batchTasks and startTask (core)', () => {
  // Reads come from the real files; writes go to a mock API that records them.
  async function withCore<T>(fn: (core: ReturnType<typeof createCore>, api: Awaited<ReturnType<typeof mockApi>>) => Promise<T>) {
    const api = await mockApi((req) => {
      if (req.path === '/api/health') return { body: { ok: true } }
      if (req.path === '/api/tasks/batch') return { body: { ok: req.body.ops.length, failed: 0, results: req.body.ops.map((_: unknown, i: number) => ({ index: i, ok: true, id: 'x', status: 'done' })) } }
      return req.method === 'POST' ? { body: { slug: 'brand-new', id: 'p/brand-new', status: 'in-progress' } } : { body: { ok: true } }
    })
    try {
      return await fn(createCore({ contentPath: root, baseUrl: api.url }), api)
    }
    finally {
      await api.close()
    }
  }

  it('resolves refs from the files and sends one request of ids', async () => {
    await withCore(async (core, api) => {
      const r = await core.batchTasks('p', [
        { op: 'update', ref: 'one', status: 'done', note: 'ok', author: 'Sam' },
        { op: 'note', ref: 'two', note: 'n' },
        { op: 'create', title: 'New' },
      ])
      assert.equal(r.ok, 3)
      const sent = api.requests.filter(q => q.path === '/api/tasks/batch')
      assert.equal(sent.length, 1)
      assert.deepEqual(sent[0]!.body.ops[0], { op: 'update', project: 'p', slug: 'one', status: 'done', note: 'ok', noteAuthor: 'Sam' })
      assert.deepEqual(sent[0]!.body.ops[2], { op: 'create', project: 'p', title: 'New' })
    })
  })

  it('reports an unresolvable ref per item without sending it, keeping the rest', async () => {
    await withCore(async (core, api) => {
      const r = await core.batchTasks('p', [{ op: 'update', ref: 'zzz', status: 'done' }, { op: 'update', ref: 'one', status: 'done' }])
      assert.deepEqual([r.ok, r.failed], [1, 1])
      assert.match(r.results[0]!.error!, /No task matches 'zzz'/)
      assert.equal(api.requests.find(q => q.path === '/api/tasks/batch')!.body.ops.length, 1)
    })
  })

  it('startTask resumes an exact match and creates otherwise', async () => {
    await withCore(async (core, api) => {
      const resumed = await core.startTask('p', 'One')
      assert.deepEqual(resumed, { id: 'p/one', slug: 'one', status: 'in-progress', created: false, was: 'todo' })
      assert.deepEqual(api.requests.at(-1)!.body, { status: 'in-progress' })
      const already = await core.startTask('p', 'two')
      assert.equal(already.was, 'in-progress')
      assert.equal(api.requests.filter(q => q.method === 'PATCH').length, 1, 'no write when already in progress')
      const created = await core.startTask('p', 'On', { priority: 'high' })
      assert.equal(created.created, true, 'a fragment is not a match')
      assert.deepEqual(api.requests.at(-1)!.body, { title: 'On', priority: 'high', status: 'in-progress', project: 'p' })
    })
  })

  it('startTask does not resume a done task', async () => {
    put('projects/p/tasks/shipped.md', task('Shipped', 'done'))
    await withCore(async (core) => {
      assert.equal((await core.startTask('p', 'Shipped')).created, true)
    })
  })
})

describe('CLI', () => {
  it('task batch reads JSON from stdin and posts one batch', async () => {
    const api = await mockApi((req) => req.path === '/api/health' ? { body: { ok: true } } : { body: { ok: 2, failed: 0, results: [{ index: 0, ok: true, id: 'p/one', status: 'done' }, { index: 1, ok: true, id: 'p/two', status: 'in-progress' }] } })
    try {
      const r = await runCli(['task', 'batch', '--project', 'p', '--json'], {
        scratch: scratch.dir,
        env: { MDPM_CONTENT_PATH: root, MDPM_BASE_URL: api.url, MDPM_AUTHOR: 'Sam' },
        input: JSON.stringify([{ op: 'update', ref: 'one', status: 'done', note: 'fin' }, { op: 'note', ref: 'two', note: 'mid' }]),
      })
      assert.equal(r.code, 0, r.stderr)
      assert.equal(r.json.ok, 2)
      const sent = api.requests.filter(q => q.path === '/api/tasks/batch')
      assert.equal(sent.length, 1)
      assert.equal(sent[0]!.body.ops[0].noteAuthor, 'Sam')
    }
    finally {
      await api.close()
    }
  })

  it('task batch rejects bad JSON and bad statuses before sending anything', async () => {
    const env = { MDPM_CONTENT_PATH: root }
    assert.equal((await runCli(['task', 'batch', '--project', 'p'], { scratch: scratch.dir, env, input: 'nope' })).code, 2)
    assert.equal((await runCli(['task', 'batch', '--project', 'p'], { scratch: scratch.dir, env, input: '[{"op":"update","ref":"one","status":"bogus"}]' })).code, 2)
  })

  it('task done --note sends status and note in one write', async () => {
    const api = await mockApi((req) => req.path === '/api/health' ? { body: { ok: true } } : {})
    try {
      const r = await runCli(['task', 'done', 'one', '--project', 'p', '--note', 'verified', '--author', 'Sam', '--json'], { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: root, MDPM_BASE_URL: api.url } })
      assert.equal(r.code, 0, r.stderr)
      assert.deepEqual(r.json, { id: 'p/one', status: 'done', noted: true })
      assert.deepEqual(api.requests.filter(q => q.method === 'PATCH').map(q => q.body), [{ status: 'done', note: 'verified', noteAuthor: 'Sam' }])
    }
    finally {
      await api.close()
    }
  })

  it('task start creates and starts in one write', async () => {
    const api = await mockApi((req) => req.path === '/api/health' ? { body: { ok: true } } : { body: { slug: 'new-thing', id: 'p/new-thing', status: 'in-progress' } })
    try {
      const r = await runCli(['task', 'start', 'New thing', '--project', 'p', '--priority', 'high', '--json'], { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: root, MDPM_BASE_URL: api.url } })
      assert.equal(r.code, 0, r.stderr)
      assert.deepEqual(r.json, { id: 'p/new-thing', slug: 'new-thing', status: 'in-progress', created: true })
      assert.equal(api.requests.filter(q => q.method === 'POST').length, 1)
    }
    finally {
      await api.close()
    }
  })
})
