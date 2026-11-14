import { strict as assert } from 'node:assert'
import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { LimitError, NotFoundError, ValidationError, WriteBusyError } from '../lib/core/errors'
import { atomicWrite, createWriter, renderMarkdown, withFileLock } from '../lib/core/write'
import { scratchDir } from './helpers'

// The write module on its own: file primitives, then the writer's contract (shapes, errors, caps).
const scratch = scratchDir()
after(scratch.cleanup)

let root: string
let n = 0
const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
const read = (rel: string) => matter(readFileSync(join(root, rel), 'utf8'))
beforeEach(() => {
  root = join(scratch.dir, `w${n++}`)
  put('projects/p/index.md', '---\ntitle: P\n---\n')
  put('projects/p/tasks/one.md', "---\ntitle: One\nstatus: todo\npriority: medium\ncreatedAt: '2026-10-01'\norder: 0\n---\nBody.\n")
})

describe('file primitives', () => {
  it('renders exactly what gray-matter wrote before (trimmed body)', () => {
    assert.equal(renderMarkdown({ title: 'T', tags: [] }, '\n body \n'), matter.stringify('body', { title: 'T', tags: [] }))
  })

  it('atomicWrite replaces a file and leaves no temp file', () => {
    const file = join(root, 'projects/p/tasks/one.md')
    atomicWrite(file, 'new')
    assert.equal(readFileSync(file, 'utf8'), 'new')
    assert.deepEqual(readdirSync(join(root, 'projects/p/tasks')), ['one.md'])
  })

  it('a held lock makes another writer wait, then give up as busy', () => {
    const file = join(root, 'projects/p/tasks/one.md')
    writeFileSync(join(root, 'projects/p/tasks/.one.md.lock'), '0')
    const start = Date.now()
    assert.throws(() => withFileLock(file, () => 1), WriteBusyError)
    assert.ok(Date.now() - start >= 2500, 'it waited before giving up')
  })

  it('a stale lock (crashed writer) is broken', () => {
    const file = join(root, 'projects/p/tasks/one.md')
    const lock = join(root, 'projects/p/tasks/.one.md.lock')
    writeFileSync(lock, '0')
    const old = new Date(Date.now() - 60_000)
    utimesSync(lock, old, old)
    assert.equal(withFileLock(file, () => 'ran'), 'ran')
    assert.deepEqual(readdirSync(join(root, 'projects/p/tasks')), ['one.md'], 'the lock is released')
  })

  it('the lock is released when the work throws', () => {
    const file = join(root, 'projects/p/tasks/one.md')
    assert.throws(() => withFileLock(file, () => { throw new Error('boom') }), /boom/)
    assert.equal(withFileLock(file, () => 2), 2)
  })
})

describe('writer', () => {
  it('creates, updates and notes a task, answering with ids and statuses only', () => {
    const w = createWriter(root)
    assert.deepEqual(w.createTask({ project: 'p', title: 'Two' }), { slug: 'two', id: 'p/two', status: 'todo' })
    assert.deepEqual(w.updateTask('p', 'two', { status: 'done', note: 'shipped', noteAuthor: 'Sam' }), { ok: true, id: 'p/two', status: 'done' })
    const f = read('projects/p/tasks/two.md')
    assert.equal(f.data.order, 1)
    assert.ok(f.data.completedAt)
    assert.match(f.content.trim(), /^\*\*Note\*\* _\([^)]+\)_ by Sam\n\nshipped$/)
  })

  it('refuses bad input with typed errors', () => {
    const w = createWriter(root)
    assert.throws(() => w.createTask({ project: 'p', title: 'x', bogus: 1 }), ValidationError)
    assert.throws(() => w.createTask({ project: 'nope', title: 'x' }), NotFoundError)
    assert.throws(() => w.updateTask('p', 'nope', { status: 'done' }), NotFoundError)
    assert.throws(() => w.updateTask('p', '../x', { status: 'done' }), ValidationError)
    assert.throws(() => w.updateTask('p', 'one', { status: 'nope' }), ValidationError)
  })

  it('applies creation caps only when given', () => {
    assert.throws(() => createWriter(root, { limits: { tasksPerProject: 1 } }).createTask({ project: 'p', title: 'x' }), LimitError)
    assert.doesNotThrow(() => createWriter(root).createTask({ project: 'p', title: 'x' }))
  })

  it('upsertDoc updates an existing slug and creates otherwise', () => {
    const w = createWriter(root)
    assert.deepEqual(w.upsertDoc('p', { slug: 'notes', title: 'Notes', body: 'v1' }), { slug: 'notes' })
    assert.deepEqual(w.upsertDoc('p', { slug: 'notes', title: 'Notes', body: 'v2' }), { ok: true, slug: 'notes' })
    assert.equal(read('projects/p/docs/notes.md').content.trim(), 'v2')
  })
})
