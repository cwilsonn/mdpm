import { strict as assert } from 'node:assert'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { createContentWatcher, mapContentPath, readUpdatedAt, type ContentEvent } from '../lib/core/live'
import { createWriter } from '../lib/core/write'
import { scratchDir } from './helpers'

// Live updates: which paths are content, and what one write looks like to the watcher.
const scratch = scratchDir()
after(scratch.cleanup)

describe('mapContentPath', () => {
  it('maps each record file to its kind, project and slug', () => {
    assert.deepEqual(mapContentPath('projects/p/index.md'), { kind: 'project', project: 'p', slug: 'p', file: 'projects/p/index.md' })
    assert.deepEqual(mapContentPath('projects/p/tasks/one.md'), { kind: 'task', project: 'p', slug: 'one', file: 'projects/p/tasks/one.md' })
    assert.deepEqual(mapContentPath('projects/p/docs/arch.md'), { kind: 'doc', project: 'p', slug: 'arch', file: 'projects/p/docs/arch.md' })
    assert.deepEqual(mapContentPath('docs/notes.md'), { kind: 'standalone-doc', slug: 'notes', file: 'docs/notes.md' })
    assert.deepEqual(mapContentPath('authors/me.md'), { kind: 'author', slug: 'me', file: 'authors/me.md' })
  })

  it('maps a bare project directory to the project (a delete removes the directory)', () => {
    assert.deepEqual(mapContentPath('projects/p'), { kind: 'project', project: 'p', slug: 'p' })
    assert.deepEqual(mapContentPath('projects/p/tasks'), { kind: 'project', project: 'p', slug: 'p' })
  })

  it('ignores temp files, lock files, dot-files and anything not markdown', () => {
    for (const rel of [
      'projects/p/tasks/.one.md.123.tmp',
      'projects/p/tasks/.one.md.lock',
      '.mdpm-schema.json',
      'projects/.DS_Store',
      'projects/p/tasks/one.txt',
      'projects/p/tasks/sub/one.md',
      'docs',
      'other/x.md',
    ]) assert.equal(mapContentPath(rel), null, rel)
  })

  it('accepts Windows separators', () => {
    assert.equal(mapContentPath('projects\\p\\tasks\\one.md')?.kind, 'task')
  })
})

describe('readUpdatedAt', () => {
  it('reads quoted and unquoted values from the frontmatter only', () => {
    const f = join(scratch.dir, 'u.md')
    writeFileSync(f, "---\ntitle: T\nupdatedAt: '2026-11-14T10:00:00.000Z'\n---\nupdatedAt: not this\n")
    assert.equal(readUpdatedAt(f), '2026-11-14T10:00:00.000Z')
    writeFileSync(f, '---\nupdatedAt: 2026-10-01\n---\n')
    assert.equal(readUpdatedAt(f), '2026-10-01')
    writeFileSync(f, '---\ntitle: T\n---\nupdatedAt: body\n')
    assert.equal(readUpdatedAt(f), null)
    assert.equal(readUpdatedAt(join(scratch.dir, 'missing.md')), null)
  })
})

describe('createContentWatcher', () => {
  const settle = (ms: number) => new Promise(r => setTimeout(r, ms))

  async function watching(root: string, fn: () => void | Promise<void>) {
    const events: ContentEvent[] = []
    // macOS FSEvents can replay changes from just before the watch started (the fixture): let them age out.
    await settle(300)
    const w = createContentWatcher(root, e => events.push(e), { coalesceMs: 50 })
    await settle(100) // fs.watch is armed asynchronously on some platforms
    try {
      await fn()
      await settle(400)
    }
    finally {
      w.close()
    }
    return events
  }

  function fixture(name: string) {
    const root = join(scratch.dir, name)
    mkdirSync(join(root, 'projects/p/tasks'), { recursive: true })
    writeFileSync(join(root, 'projects/p/index.md'), '---\ntitle: P\n---\n')
    writeFileSync(join(root, 'projects/p/tasks/one.md'), "---\ntitle: One\nstatus: todo\npriority: medium\ncreatedAt: '2026-10-01'\norder: 0\n---\nBody.\n")
    return root
  }

  it('reports one event per write, with the new updatedAt, and nothing for temp or lock files', async () => {
    const root = fixture('one-write')
    const writer = createWriter(root)
    let updatedAt: string | undefined
    const events = await watching(root, () => {
      updatedAt = (writer.updateTask('p', 'one', { title: 'Renamed', expectedUpdatedAt: null }) as { updatedAt?: string }).updatedAt
    })
    assert.ok(updatedAt)
    assert.deepEqual(events, [{ kind: 'task', project: 'p', slug: 'one', op: 'change', updatedAt }])
  })

  it('reports a removed file as a delete', async () => {
    const root = fixture('delete')
    const events = await watching(root, () => rmSync(join(root, 'projects/p/tasks/one.md')))
    assert.deepEqual(events, [{ kind: 'task', project: 'p', slug: 'one', op: 'delete' }])
  })

  it('does not throw on a missing root', () => {
    let error: Error | undefined
    const w = createContentWatcher(join(scratch.dir, 'nope'), () => {}, { onError: e => { error = e } })
    w.close()
    assert.ok(error)
  })
})
