import { strict as assert } from 'node:assert'
import { mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { ConflictError, LimitError, NotFoundError, ValidationError, WriteBusyError } from '../lib/core/errors'
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

// An editor that sends a whole body back (the task form's autosave) must not overwrite a note appended meanwhile.
describe('stale updates (expectedUpdatedAt)', () => {
  it('refuses an update against an older version and keeps the note that landed in between', () => {
    const w = createWriter(root)
    const first = w.updateTask('p', 'one', { title: 'One', expectedUpdatedAt: null })
    assert.ok(first.updatedAt, 'an editor gets the new stamp back')
    w.updateTask('p', 'one', { note: 'from an agent', noteAuthor: 'claude' })
    assert.throws(() => w.updateTask('p', 'one', { description: 'Body as the form saw it', expectedUpdatedAt: first.updatedAt }), ConflictError)
    assert.match(read('projects/p/tasks/one.md').content, /from an agent/)
  })

  it('accepts a matching base, chains on the returned stamp, and never stores the field', () => {
    const w = createWriter(root)
    const a = w.updateTask('p', 'one', { description: 'v1', expectedUpdatedAt: null })
    const b = w.updateTask('p', 'one', { description: 'v2', expectedUpdatedAt: a.updatedAt })
    assert.notEqual(b.updatedAt, undefined)
    const f = read('projects/p/tasks/one.md')
    assert.equal(f.content.trim(), 'v2')
    assert.equal(f.data.expectedUpdatedAt, undefined)
    assert.equal(f.data.updatedAt, b.updatedAt)
  })

  it('gives every write a later stamp, even within the same millisecond', () => {
    const w = createWriter(root)
    const stamps = Array.from({ length: 20 }, () => w.updateTask('p', 'one', { status: 'todo', expectedUpdatedAt: read('projects/p/tasks/one.md').data.updatedAt ?? null }).updatedAt!)
    assert.equal(new Set(stamps).size, stamps.length)
    assert.deepEqual([...stamps].sort(), stamps)
  })

  it('null matches a file that was never updated, and nothing else', () => {
    const w = createWriter(root)
    w.updateTask('p', 'one', { status: 'done' })
    assert.throws(() => w.updateTask('p', 'one', { title: 'x', expectedUpdatedAt: null }), ConflictError)
  })

  it('compares an unquoted (Date-parsed) updatedAt as its ISO string', () => {
    put('projects/p/tasks/one.md', '---\ntitle: One\nstatus: todo\nupdatedAt: 2026-11-01T10:00:00.000Z\n---\nBody.\n')
    const w = createWriter(root)
    assert.doesNotThrow(() => w.updateTask('p', 'one', { title: 'x', expectedUpdatedAt: '2026-11-01T10:00:00.000Z' }))
  })

  it('leaves answers unchanged for callers that do not ask', () => {
    assert.deepEqual(createWriter(root).updateTask('p', 'one', { status: 'done' }), { ok: true, id: 'p/one', status: 'done' })
  })

  it('applies to docs too', () => {
    put('projects/p/docs/d.md', "---\ntitle: D\nupdatedAt: '2026-11-01T10:00:00.000Z'\n---\nText.\n")
    const w = createWriter(root)
    assert.throws(() => w.updateDoc('p', 'd', { body: 'mine', expectedUpdatedAt: '2026-10-01T00:00:00.000Z' }), ConflictError)
    const r = w.updateDoc('p', 'd', { body: 'mine', expectedUpdatedAt: '2026-11-01T10:00:00.000Z' })
    assert.ok(r.updatedAt)
    assert.equal(read('projects/p/docs/d.md').data.expectedUpdatedAt, undefined)
  })
})
