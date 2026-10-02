import { strict as assert } from 'node:assert'
import { spawn, type ChildProcess } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { createCore, diffSnapshots, readProjectSnapshot, scopeOfPath, type Snapshot, type WatchEvent } from '../lib/core'
import { FIXTURE_CONTENT, isolatedEnv, REPO, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

const AT = '2026-10-01T12:00:00.000Z'
const task = (over: Record<string, unknown> = {}) => ({
  title: 'T', status: 'todo', priority: 'medium', tags: [] as string[], assignees: [] as string[], due: null as string | null,
  dependencies: [] as string[], links: [] as string[], archivedAt: null as string | null, body: '', ...over,
})
const doc = (over: Record<string, unknown> = {}) => ({ title: 'D', tags: [] as string[], parent: null as string | null, archivedAt: null as string | null, body: 'x', ...over })
const snap = (tasks: Record<string, ReturnType<typeof task>> = {}, docs: Record<string, ReturnType<typeof doc>> = {}, project = true): Snapshot => ({
  project: project ? { title: 'P', status: 'active', tags: [], description: null, links: [] as string[], icon: null, archivedAt: null } : undefined,
  tasks: new Map(Object.entries(tasks)),
  docs: new Map(Object.entries(docs)),
})
const diff = (before: Snapshot, after: Snapshot) => diffSnapshots(before, after, 'p', AT)
const shape = (events: WatchEvent[]) => events.map(e => `${e.kind}.${e.action}:${e.slug}`)

describe('diffSnapshots', () => {
  it('reports created and deleted tasks and docs', () => {
    const events = diff(snap({ a: task() }, { d1: doc() }), snap({ b: task({ title: 'New' }) }, { d2: doc() }))
    assert.deepEqual(shape(events).sort(), ['doc.created:d2', 'doc.deleted:d1', 'task.created:b', 'task.deleted:a'])
  })

  it('reports field changes with their before and after values', () => {
    const events = diff(snap({ a: task() }), snap({ a: task({ status: 'done', priority: 'high', tags: ['x'], due: '2026-12-01' }) }))
    assert.equal(events.length, 1)
    assert.deepEqual(events[0]!.changes, [
      { field: 'status', from: 'todo', to: 'done' },
      { field: 'priority', from: 'medium', to: 'high' },
      { field: 'tags', from: [], to: ['x'] },
      { field: 'due', from: null, to: '2026-12-01' },
    ])
  })

  it('says nothing when nothing meaningful changed', () => {
    assert.deepEqual(diff(snap({ a: task() }), snap({ a: task() })), [])
  })

  it('turns an appended note into a note event with its author, not a description edit', () => {
    const before = task({ body: 'Body.' })
    const after = task({ body: 'Body.\n\n---\n**Note** _(2026-10-01 11:59)_ by Sam\n\nFirst line.\nSecond line.' })
    const events = diff(snap({ a: before }), snap({ a: after }))
    assert.deepEqual(shape(events), ['task.note:a'])
    assert.deepEqual(events[0]!.note, { author: 'Sam', text: 'First line.\nSecond line.' })
  })

  it('reports several new notes separately, and a rewritten body as a description edit', () => {
    const n = (m: string, who: string, text: string) => `\n\n---\n**Note** _(2026-10-01 ${m})_ by ${who}\n\n${text}`
    const two = diff(snap({ a: task({ body: 'B' }) }), snap({ a: task({ body: `B${n('10:00', 'a', 'one')}${n('10:01', 'b', 'two')}` }) }))
    assert.deepEqual(two.map(e => e.note?.text), ['one', 'two'])
    const edit = diff(snap({ a: task({ body: 'Old text' }) }), snap({ a: task({ body: 'Rewritten text' }) }))
    assert.deepEqual(edit[0]!.changes, [{ field: 'description' }])
  })

  it('separates archive and unarchive from other updates', () => {
    assert.deepEqual(shape(diff(snap({ a: task() }), snap({ a: task({ archivedAt: '2026-10-01' }) }))), ['task.archived:a'])
    assert.deepEqual(shape(diff(snap({ a: task({ archivedAt: '2026-10-01' }) }), snap({ a: task() }))), ['task.unarchived:a'])
    assert.deepEqual(shape(diff(snap({ a: task() }), snap({ a: task({ archivedAt: '2026-10-01', status: 'done' }) }))), ['task.archived:a', 'task.updated:a'])
  })

  it('reports doc edits (title, tags, parent, body) and archiving', () => {
    const events = diff(snap({}, { d: doc() }), snap({}, { d: doc({ title: 'Renamed', parent: 'root', body: 'changed' }) }))
    assert.deepEqual(events[0]!.changes?.map(c => c.field), ['title', 'parent', 'body'])
    assert.deepEqual(shape(diff(snap({}, { d: doc() }), snap({}, { d: doc({ archivedAt: '2026-10-01' }) }))), ['doc.archived:d'])
  })

  it('reports project creation, deletion, and updates', () => {
    assert.deepEqual(shape(diffSnapshots(snap({}, {}, false), snap(), 'p', AT)), ['project.created:p'])
    assert.deepEqual(shape(diffSnapshots(snap(), snap({}, {}, false), 'p', AT)), ['project.deleted:p'])
    const renamed = diffSnapshots(snap(), { ...snap(), project: { ...snap().project!, title: 'Renamed', tags: ['x'] } }, 'p', AT)
    assert.deepEqual(renamed[0]!.changes?.map(c => c.field), ['title', 'tags'])
  })

  it('deleting a project reports everything in it as deleted', () => {
    const events = diffSnapshots(snap({ a: task(), b: task() }, { d: doc() }), snap({}, {}, false), 'p', AT)
    assert.deepEqual(shape(events).sort(), ['doc.deleted:d', 'project.deleted:p', 'task.deleted:a', 'task.deleted:b'])
  })

  it('standalone docs carry a null project', () => {
    const [event] = diffSnapshots({ tasks: new Map(), docs: new Map() }, { tasks: new Map(), docs: new Map([['g', doc()]]) }, null, AT)
    assert.deepEqual([event!.project, event!.kind, event!.action], [null, 'doc', 'created'])
  })
})

describe('scopeOfPath', () => {
  it('maps files to a project, standalone docs, or nothing', () => {
    assert.deepEqual(scopeOfPath('projects/alpha/tasks/x.md'), { project: 'alpha' })
    assert.deepEqual(scopeOfPath('projects/alpha/index.md'), { project: 'alpha' })
    assert.deepEqual(scopeOfPath('projects/alpha'), { project: 'alpha' })
    assert.deepEqual(scopeOfPath('docs/guide.md'), { standalone: true })
    assert.equal(scopeOfPath('authors/me.md'), undefined)
    assert.equal(scopeOfPath('projects'), undefined)
  })
})

describe('readProjectSnapshot', () => {
  it('captures a project, its tasks, and its docs from the files', () => {
    const s = readProjectSnapshot(createCore({ contentPath: FIXTURE_CONTENT, baseUrl: 'http://127.0.0.1:1' }), 'alpha')
    assert.equal(s.project?.title, 'Alpha')
    assert.equal(s.tasks.get('write-parser')?.status, 'in-progress')
    assert.ok(s.docs.has('architecture'))
    assert.equal(readProjectSnapshot(createCore({ contentPath: FIXTURE_CONTENT, baseUrl: 'http://127.0.0.1:1' }), 'nope').project, undefined)
  })
})

// The real thing: run `mdpm watch --json` against a scratch copy of the content and change files under it.
describe('mdpm watch (process)', () => {
  const content = join(scratch.dir, 'watched')
  let child: ChildProcess
  let lines: string[] = []
  let stderr = ''
  let exited: Promise<number | null>

  const start = async (args: string[]) => {
    lines = []
    stderr = ''
    child = spawn('node', [join(REPO, 'bin/mdpm.mjs'), 'watch', '--json', ...args], {
      cwd: scratch.dir,
      env: { ...isolatedEnv(scratch.dir), MDPM_CONTENT_PATH: content } as NodeJS.ProcessEnv,
    })
    let buf = ''
    child.stdout!.on('data', (c) => { buf += c; const parts = buf.split('\n'); buf = parts.pop()!; lines.push(...parts.filter(Boolean)) })
    child.stderr!.on('data', (c) => { stderr += c })
    exited = new Promise(resolve => child.once('exit', code => resolve(code)))
    for (let i = 0; i < 100 && !/watching/.test(stderr); i++) await new Promise(r => setTimeout(r, 50))
    assert.match(stderr, /watching/, 'the watcher announces itself')
    await new Promise(r => setTimeout(r, 200))
  }
  const events = () => lines.map(l => JSON.parse(l) as WatchEvent)
  const waitFor = async (predicate: (e: WatchEvent) => boolean, ms = 6000) => {
    for (let i = 0; i < ms / 50; i++) {
      const hit = events().find(predicate)
      if (hit) return hit
      await new Promise(r => setTimeout(r, 50))
    }
    assert.fail(`no matching event within ${ms}ms; saw: ${JSON.stringify(events().map(e => `${e.kind}.${e.action}:${e.slug}`))}`)
  }
  const stop = async () => { child.kill('SIGINT'); return exited }

  before(() => cpSync(FIXTURE_CONTENT, content, { recursive: true }))

  it('streams events as files change, then shuts down cleanly on SIGINT', async () => {
    await start(['--project', 'alpha'])
    const taskFile = join(content, 'projects/alpha/tasks/write-docs.md')

    writeFileSync(taskFile, readFileSync(taskFile, 'utf8').replace('status: todo', 'status: done'))
    const updated = await waitFor(e => e.kind === 'task' && e.slug === 'write-docs' && e.action === 'updated')
    assert.deepEqual(updated.changes, [{ field: 'status', from: 'todo', to: 'done' }])

    appendFileSync(taskFile, '\n\n---\n**Note** _(2026-10-01 10:00)_ by Watcher\n\nAdded while watching.\n')
    const note = await waitFor(e => e.action === 'note' && e.slug === 'write-docs')
    assert.deepEqual(note.note, { author: 'Watcher', text: 'Added while watching.' })

    writeFileSync(join(content, 'projects/alpha/tasks/brand-new.md'), '---\ntitle: Brand new\nstatus: todo\npriority: low\n---\n')
    assert.equal((await waitFor(e => e.slug === 'brand-new')).action, 'created')

    rmSync(join(content, 'projects/alpha/tasks/brand-new.md'))
    assert.equal((await waitFor(e => e.slug === 'brand-new' && e.action === 'deleted')).title, 'Brand new')

    assert.equal(await stop(), 0, 'Ctrl-C is a normal exit')
  })

  it('--project ignores other projects, and the default view sees new projects and standalone docs', async () => {
    await start(['--project', 'alpha'])
    writeFileSync(join(content, 'projects/beta/tasks/beta-task.md'), readFileSync(join(content, 'projects/beta/tasks/beta-task.md'), 'utf8').replace('status: todo', 'status: done'))
    await new Promise(r => setTimeout(r, 800))
    assert.equal(events().length, 0, 'a change in beta is invisible when watching alpha')
    await stop()

    await start(['--all'])
    mkdirSync(join(content, 'projects/newproj'), { recursive: true })
    writeFileSync(join(content, 'projects/newproj/index.md'), '---\ntitle: New project\nstatus: active\n---\n')
    assert.equal((await waitFor(e => e.kind === 'project' && e.slug === 'newproj')).action, 'created')
    writeFileSync(join(content, 'docs/fresh.md'), '---\ntitle: Fresh\ntags: []\n---\nhello\n')
    const standalone = await waitFor(e => e.kind === 'doc' && e.slug === 'fresh')
    assert.deepEqual([standalone.project, standalone.action], [null, 'created'])
    assert.equal(await stop(), 0)
  })

  it('exits with an error when the content directory does not exist', async () => {
    const r = await new Promise<{ code: number | null; stderr: string }>((resolve) => {
      const c = spawn('node', [join(REPO, 'bin/mdpm.mjs'), 'watch'], { cwd: scratch.dir, env: { ...isolatedEnv(scratch.dir), MDPM_CONTENT_PATH: join(scratch.dir, 'nope') } as NodeJS.ProcessEnv })
      let err = ''
      c.stderr.on('data', (d) => { err += d })
      c.once('exit', code => resolve({ code, stderr: err }))
    })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /content directory not found/)
  })
})
