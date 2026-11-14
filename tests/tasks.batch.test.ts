import { strict as assert } from 'node:assert'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { createCore } from '../lib/core'
import { rejects, route } from './route-harness'
import { runCli, scratchDir } from './helpers'

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
  // Reads and writes both go to the files; the base URL is unroutable, so nothing may need a server.
  const core = () => createCore({ contentPath: root, baseUrl: 'http://127.0.0.1:1' })

  it('resolves refs from the files and writes each item', async () => {
    const r = await core().batchTasks('p', [
      { op: 'update', ref: 'one', status: 'done', note: 'ok', author: 'Sam' },
      { op: 'note', ref: 'two', note: 'n' },
      { op: 'create', title: 'New' },
    ])
    assert.deepEqual(r.results.map(x => [x.ok, x.id, x.status]), [[true, 'p/one', 'done'], [true, 'p/two', 'in-progress'], [true, 'p/new', 'todo']])
    assert.equal(read('projects/p/tasks/one.md').data.status, 'done')
    assert.match(read('projects/p/tasks/one.md').content.trim(), /by Sam\n\nok$/)
    assert.match(read('projects/p/tasks/two.md').content.trim(), /\n\nn$/)
    assert.equal(read('projects/p/tasks/new.md').data.title, 'New')
  })

  it('reports an unresolvable ref per item without writing it, keeping the rest', async () => {
    const r = await core().batchTasks('p', [{ op: 'update', ref: 'zzz', status: 'done' }, { op: 'update', ref: 'one', status: 'done' }])
    assert.deepEqual([r.ok, r.failed], [1, 1])
    assert.match(r.results[0]!.error!, /No task matches 'zzz'/)
    assert.equal(read('projects/p/tasks/one.md').data.status, 'done')
  })

  it('startTask resumes an exact match and creates otherwise', async () => {
    const resumed = await core().startTask('p', 'One')
    assert.deepEqual(resumed, { id: 'p/one', slug: 'one', status: 'in-progress', created: false, was: 'todo' })
    assert.equal(read('projects/p/tasks/one.md').data.status, 'in-progress')
    const before = readFileSync(join(root, 'projects/p/tasks/two.md'), 'utf8')
    const already = await core().startTask('p', 'two')
    assert.equal(already.was, 'in-progress')
    assert.equal(readFileSync(join(root, 'projects/p/tasks/two.md'), 'utf8'), before, 'no write when already in progress')
    const created = await core().startTask('p', 'On', { priority: 'high' })
    assert.equal(created.created, true, 'a fragment is not a match')
    assert.deepEqual([read('projects/p/tasks/on.md').data.status, read('projects/p/tasks/on.md').data.priority], ['in-progress', 'high'])
  })

  it('startTask does not resume a done task', async () => {
    put('projects/p/tasks/shipped.md', task('Shipped', 'done'))
    assert.equal((await core().startTask('p', 'Shipped')).created, true)
  })
})

describe('CLI', () => {
  it('task batch reads JSON from stdin and writes every op', async () => {
    const r = await runCli(['task', 'batch', '--project', 'p', '--json'], {
      scratch: scratch.dir,
      env: { MDPM_CONTENT_PATH: root, MDPM_AUTHOR: 'Sam' },
      input: JSON.stringify([{ op: 'update', ref: 'one', status: 'done', note: 'fin' }, { op: 'note', ref: 'two', note: 'mid' }]),
    })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.json.ok, 2)
    assert.match(read('projects/p/tasks/one.md').content.trim(), /by Sam\n\nfin$/)
    assert.match(read('projects/p/tasks/two.md').content.trim(), /by Sam\n\nmid$/)
  })

  it('task batch rejects bad JSON and bad statuses before sending anything', async () => {
    const env = { MDPM_CONTENT_PATH: root }
    assert.equal((await runCli(['task', 'batch', '--project', 'p'], { scratch: scratch.dir, env, input: 'nope' })).code, 2)
    assert.equal((await runCli(['task', 'batch', '--project', 'p'], { scratch: scratch.dir, env, input: '[{"op":"update","ref":"one","status":"bogus"}]' })).code, 2)
  })

  it('task done --note writes status and note together', async () => {
    const r = await runCli(['task', 'done', 'one', '--project', 'p', '--note', 'verified', '--author', 'Sam', '--json'], { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: root } })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json, { id: 'p/one', status: 'done', noted: true })
    const f = read('projects/p/tasks/one.md')
    assert.equal(f.data.status, 'done')
    assert.match(f.content.trim(), /by Sam\n\nverified$/)
  })

  it('task start creates and starts in one write', async () => {
    const r = await runCli(['task', 'start', 'New thing', '--project', 'p', '--priority', 'high', '--json'], { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: root } })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json, { id: 'p/new-thing', slug: 'new-thing', status: 'in-progress', created: true })
    assert.equal(read('projects/p/tasks/new-thing.md').data.status, 'in-progress')
  })
})

describe('concurrent writers', () => {
  it('notes appended by several processes at once are all kept', async () => {
    const env = { MDPM_CONTENT_PATH: root }
    const runs = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      runCli(['task', 'note', 'one', `note ${i}`, '--project', 'p'], { scratch: scratch.dir, env })))
    assert.deepEqual(runs.map(r => r.code), [0, 0, 0, 0, 0, 0], runs.map(r => r.stderr).join('\n'))
    const body = read('projects/p/tasks/one.md').content
    for (let i = 0; i < 6; i++) assert.match(body, new RegExp(`\\n\\nnote ${i}(\\n|$)`))
  })

  it('creates racing for one title get distinct slugs', async () => {
    const env = { MDPM_CONTENT_PATH: root }
    const runs = await Promise.all(Array.from({ length: 4 }, () =>
      runCli(['task', 'add', 'Same title', '--project', 'p', '--json'], { scratch: scratch.dir, env })))
    assert.deepEqual(runs.map(r => r.code), [0, 0, 0, 0], runs.map(r => r.stderr).join('\n'))
    assert.deepEqual(runs.map(r => r.json.slug).sort(), ['same-title', 'same-title-2', 'same-title-3', 'same-title-4'])
  })
})
