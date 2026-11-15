import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
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
const notesFile = (slug: string) => join(root, 'projects/p/tasks/notes', `${slug}.md`)
const notesOf = (slug: string) => existsSync(notesFile(slug)) ? readFileSync(notesFile(slug), 'utf8') : ''
beforeEach(() => {
  root = join(scratch.dir, `w${n++}`)
  put('projects/p/index.md', '---\ntitle: P\n---\n')
  put('projects/p/tasks/one.md', "---\ntitle: One\nstatus: todo\npriority: medium\ncreatedAt: '2026-10-01'\norder: 0\n---\nBody.\n")
})

describe('file primitives', () => {
  it('renders what gray-matter writes (trimmed body), leaving out empty lists and dropped fields', () => {
    assert.equal(renderMarkdown({ title: 'T', tags: ['a'] }, '\n body \n'), matter.stringify('body', { title: 'T', tags: ['a'] }))
    assert.equal(renderMarkdown({ title: 'T', tags: [], assignees: ['sam'], defaultAssignee: 'sam', dependencies: [], availableStatuses: [] }), matter.stringify('', { title: 'T', availableStatuses: [] }))
  })

  it('rewrites only the tasks a reorder actually moves', () => {
    const w = createWriter(root)
    w.createTask({ project: 'p', title: 'Order A' })
    w.createTask({ project: 'p', title: 'Order B' })
    const file = join(root, 'projects/p/tasks/order-a.md')
    const before = readFileSync(file, 'utf8')
    const orderOf = (slug: string) => matter(readFileSync(join(root, `projects/p/tasks/${slug}.md`), 'utf8')).data.order
    const a = orderOf('order-a')
    w.reorderTasks('p', { todo: [...Array(a).fill('missing-slug'), 'order-a', 'order-b'] })
    assert.equal(readFileSync(file, 'utf8'), before)
    assert.equal(orderOf('order-b'), a + 1)
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
    assert.equal(f.content.trim(), '')
    assert.match(notesOf('two'), /^\*\*Note\*\* _\([^)]+\)_ by Sam\n\nshipped\n$/)
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

// Notes live in tasks/notes/<slug>.md; `description` is the spec only and can never drop a note.
describe('notes file', () => {
  const NOTE = (stamp: string, text: string) => `**Note** _(${stamp})_ by Sam\n\n${text}`

  it('replacing the description keeps every note (the old body layout lost the ones a read had hidden)', () => {
    const w = createWriter(root)
    for (const n of ['a', 'b', 'c', 'd', 'e']) w.updateTask('p', 'one', { note: n })
    w.updateTask('p', 'one', { description: 'New spec.' })
    assert.equal(read('projects/p/tasks/one.md').content.trim(), 'New spec.')
    assert.deepEqual([...notesOf('one').matchAll(/\n\n(\w)(?=\n|$)/g)].map(m => m[1]), ['a', 'b', 'c', 'd', 'e'])
  })

  it('notes still in an old-layout body move to the notes file on the next update, before the spec is replaced', () => {
    put('projects/p/tasks/old.md', `---\ntitle: Old\nstatus: todo\n---\nOld spec.\n\n---\n${NOTE('2026-10-01 10:00', 'first')}\n\n---\n${NOTE('2026-10-02 10:00', 'second')}\n`)
    put('projects/p/tasks/notes/old.md', `${NOTE('2026-10-03 10:00', 'third (written by a newer mdpm)')}\n`)
    createWriter(root).updateTask('p', 'old', { description: 'Rewritten.' })
    assert.equal(read('projects/p/tasks/old.md').content.trim(), 'Rewritten.')
    assert.equal(notesOf('old'), `${[NOTE('2026-10-01 10:00', 'first'), NOTE('2026-10-02 10:00', 'second'), NOTE('2026-10-03 10:00', 'third (written by a newer mdpm)')].join('\n\n---\n')}\n`)
  })

  it('a status-only update also moves old-layout notes out, and a second one changes nothing', () => {
    put('projects/p/tasks/old.md', `---\ntitle: Old\nstatus: todo\n---\nSpec.\n\n---\n${NOTE('2026-10-01 10:00', 'first')}\n`)
    const w = createWriter(root)
    w.updateTask('p', 'old', { status: 'done' })
    assert.equal(read('projects/p/tasks/old.md').content.trim(), 'Spec.')
    const once = notesOf('old')
    w.updateTask('p', 'old', { status: 'todo' })
    assert.equal(notesOf('old'), once)
  })

  it('notes pasted into a description go to the notes file once, not into the spec', () => {
    const w = createWriter(root)
    w.updateTask('p', 'one', { note: 'kept', noteAuthor: 'Sam' })
    const stored = notesOf('one').trim()
    w.updateTask('p', 'one', { description: `Spec.\n\n---\n${stored}\n\n---\n${NOTE('2026-10-05 10:00', 'pasted')}` })
    assert.equal(read('projects/p/tasks/one.md').content.trim(), 'Spec.')
    assert.equal((notesOf('one').match(/\*\*Note\*\*/g) ?? []).length, 2)
  })

  it('the same note written twice in a minute is kept twice', () => {
    const w = createWriter(root)
    w.updateTask('p', 'one', { note: 'wip' })
    w.updateTask('p', 'one', { note: 'wip' })
    assert.equal((notesOf('one').match(/\n\nwip(\n|$)/g) ?? []).length, 2)
  })

  it('a task without notes has no notes file or directory; delete removes both files', () => {
    const w = createWriter(root)
    w.createTask({ project: 'p', title: 'Quiet' })
    assert.equal(existsSync(join(root, 'projects/p/tasks/notes')), false)
    w.createTask({ project: 'p', title: 'Noted', note: 'hello' })
    assert.match(notesOf('noted'), /hello/)
    w.deleteTask('p', 'noted')
    assert.deepEqual([existsSync(join(root, 'projects/p/tasks/noted.md')), existsSync(notesFile('noted'))], [false, false])
  })

  it('a new task does not inherit a notes file left behind under its slug', () => {
    put('projects/p/tasks/notes/fresh.md', `${NOTE('2026-10-01 10:00', 'someone else')}\n`)
    createWriter(root).createTask({ project: 'p', title: 'Fresh' })
    assert.equal(existsSync(notesFile('fresh')), false)
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
    assert.match(notesOf('one'), /from an agent/)
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

  it('accepts the same instant in another spelling (the reader shortens a midnight date)', () => {
    put('projects/p/tasks/one.md', '---\ntitle: One\nstatus: todo\nupdatedAt: 2026-10-01\n---\nBody.\n')
    assert.doesNotThrow(() => createWriter(root).updateTask('p', 'one', { title: 'x', expectedUpdatedAt: '2026-10-01' }))
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

// The writer's batch (the CLI's `task batch` and MCP's batch_tasks go through ops.batchTasks to here).
describe('batchTasks', () => {
  it('applies creates, updates and notes in order and returns only ids and statuses', () => {
    const w = createWriter(root)
    w.createTask({ project: 'p', title: 'Two', status: 'in-progress' })
    const r = w.batchTasks([
      { op: 'create', project: 'p', title: 'Third', status: 'in-progress' },
      { op: 'update', project: 'p', slug: 'one', status: 'done', note: 'shipped' },
      { op: 'note', project: 'p', slug: 'two', note: 'halfway', noteAuthor: 'claude' },
    ])
    assert.deepEqual(r, { ok: 3, failed: 0, results: [
      { index: 0, ok: true, id: 'p/third', status: 'in-progress' },
      { index: 1, ok: true, id: 'p/one', status: 'done' },
      { index: 2, ok: true, id: 'p/two', status: 'in-progress' },
    ] })
    assert.match(notesOf('one'), /shipped\s*$/)
    assert.match(notesOf('two'), /halfway\s*$/)
  })

  it('reports a failing item without stopping the rest, unknown fields included', () => {
    const r = createWriter(root).batchTasks([
      { op: 'update', project: 'p', slug: 'nope', status: 'done' },
      { op: 'update', project: 'p', slug: 'one', status: 'done', bogus: 1 },
      { op: 'bogus' },
      { op: 'note', project: 'p', slug: 'one', note: '  ' },
      { op: 'update', project: 'p', slug: 'one', status: 'in-review' },
    ])
    assert.equal(r.ok, 1)
    assert.equal(r.failed, 4)
    assert.match(r.results[0]!.error!, /Task not found/)
    assert.match(r.results[1]!.error!, /unknown field: bogus/)
    assert.match(r.results[2]!.error!, /Unknown op/)
    assert.match(r.results[3]!.error!, /note is empty/)
    assert.equal(read('projects/p/tasks/one.md').data.status, 'in-review')
  })

  it('rejects an empty or oversized batch', () => {
    const w = createWriter(root)
    assert.throws(() => w.batchTasks([]), ValidationError)
    assert.throws(() => w.batchTasks(Array.from({ length: 101 }, () => ({ op: 'note', project: 'p', slug: 'one', note: 'x' }))), ValidationError)
  })
})
