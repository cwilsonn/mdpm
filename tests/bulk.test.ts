import { strict as assert } from 'node:assert'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { matches, parseWhere, WhereError, type Clause } from '../lib/core'
import { changedContent, readContent, resetContent, runCli, scratchContent, scratchDir, snapshotContent } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

const task = (over: Partial<Parameters<typeof matches>[0]> = {}) => ({
  project: 'p', slug: 'some-task', title: 'Some Task', status: 'todo', priority: 'medium', tags: ['core', 'Backend'], assignees: ['sam'], ...over,
})
const where = (expr: string, t = task()) => matches(t, parseWhere(expr))

describe('--where selectors', () => {
  it('equals, not-equals, and contains', () => {
    assert.ok(where('status=todo'))
    assert.ok(!where('status=done'))
    assert.ok(where('status!=done'))
    assert.ok(!where('status!=todo'))
    assert.ok(where('title~some'))
    assert.ok(!where('title~other'))
  })

  it('is case-insensitive and supports | alternatives', () => {
    assert.ok(where('status=TODO'))
    assert.ok(where('status=done|todo'))
    assert.ok(!where('status!=done|todo'))
  })

  it('treats tags and assignees as sets, with plural aliases', () => {
    assert.ok(where('tag=core'))
    assert.ok(where('tags=backend'))
    assert.ok(where('tag=qa|core'))
    assert.ok(!where('tag=qa'))
    assert.ok(where('tag!=qa'))
    assert.ok(where('tag~back'))
    assert.ok(where('assignee=sam'))
    assert.ok(!where('assignee=ada'))
    assert.ok(where('assignee!=ada'))
  })

  it('requires every clause to hold', () => {
    assert.ok(where('status=todo,tag=core,priority!=low'))
    assert.ok(!where('status=todo,tag=core,priority=low'))
  })

  it('rejects unreadable selectors with a helpful message', () => {
    for (const bad of ['', '   ', 'status', 'status=', 'colour=red', 'status<todo']) {
      assert.throws(() => parseWhere(bad), WhereError, bad)
    }
    assert.throws(() => parseWhere('colour=red'), /unknown field 'colour' \(use status, priority, tag/)
  })

  it('exposes the parsed clauses', () => {
    const [clause] = parseWhere('Status = todo | blocked') as [Clause]
    assert.deepEqual(clause, { field: 'status', op: '=', values: ['todo', 'blocked'] })
  })
})

describe('bulk task commands', () => {
  let before: Map<string, string>
  const mark = () => { before = snapshotContent(scratch.dir) }
  beforeEach(() => { resetContent(scratch.dir); mark() })

  const cli = (args: string[]) => runCli(['task', ...args], { scratch: scratch.dir })
  // Task files the command changed, as project/slug.
  const written = () => changedContent(scratch.dir, before).map(p => p.replace(/^projects\/([^/]+)\/tasks\/(.+)\.md$/, '$1/$2'))
  const paths = () => written().map(p => p.split('/').pop()).sort()
  const task = (slug: string) => readContent(scratch.dir, `projects/alpha/tasks/${slug}.md`)
  const A = ['--project', 'alpha']

  it('list --where narrows the usual filters', async () => {
    const r = await cli(['list', ...A, '--where', 'status=todo,tag=backend', '--json'])
    assert.deepEqual(r.json.map((t: any) => t.slug), ['write-tests'])
  })

  it('--dry-run lists the matches and sends nothing', async () => {
    const r = await cli(['set', ...A, '--where', 'status=todo', '--priority', 'low', '--dry-run', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual([r.json.dryRun, r.json.matched, r.json.tasks.sort()], [true, 3, ['alpha/shared-task', 'alpha/write-docs', 'alpha/write-tests']])
    assert.deepEqual(written(), [])
    const text = await cli(['set', ...A, '--where', 'status=todo', '--priority', 'low', '--dry-run'])
    assert.match(text.stdout, /would be updated \(dry run: nothing changed\)/)
  })

  it('set --where --yes patches every match with the same fields', async () => {
    const r = await cli(['set', ...A, '--where', 'status=todo|blocked', '--priority', 'high', '--yes', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(paths(), ['fix-login-bug', 'shared-task', 'write-docs', 'write-tests'])
    assert.ok(paths().every(s => task(s!)!.data.priority === 'high'))
    assert.deepEqual([r.json.matched, r.json.succeeded, r.json.failed], [4, 4, 0])
  })

  it('refuses to run without --yes when there is no terminal, and writes nothing', async () => {
    const r = await cli(['set', ...A, '--where', 'status=todo', '--priority', 'low'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /--yes/)
    assert.deepEqual(written(), [])
  })

  it('done, archive, unarchive, and delete accept --where', async () => {
    await cli(['done', ...A, '--where', 'tag=docs', '--yes'])
    assert.deepEqual(written(), ['alpha/write-docs'])
    assert.equal(task('write-docs')!.data.status, 'done')
    mark()

    await cli(['archive', ...A, '--where', 'priority=low', '--yes'])
    assert.deepEqual(paths(), ['write-docs'], 'archived tasks are not matched by default')
    mark()

    await cli(['unarchive', ...A, '--where', 'slug~old', '--include-archived', '--yes'])
    assert.deepEqual(written(), ['alpha/old-idea'])
    assert.equal(task('old-idea')!.data.archivedAt, undefined)
    mark()

    await cli(['delete', ...A, '--where', 'status=done', '--yes'])
    assert.deepEqual(written(), ['alpha/ship-v1'])
    assert.equal(task('ship-v1'), undefined)
  })

  it('--all spans projects', async () => {
    await cli(['set', '--all', '--where', 'slug=shared-task', '--priority', 'low', '--yes'])
    assert.deepEqual(written(), ['alpha/shared-task', 'beta/shared-task'])
  })

  it('reports no matches without error and writes nothing', async () => {
    const r = await cli(['archive', ...A, '--where', 'status=on-hold', '--yes'])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /no tasks match/)
    assert.deepEqual(written(), [])
  })

  it('keeps going after a failure, reports it, and exits 1', async () => {
    // Another writer holds write-docs (a fresh lockfile), so that one write gives up as busy.
    const lock = join(scratchContent(scratch.dir), 'projects/alpha/tasks/.write-docs.md.lock')
    writeFileSync(lock, '0')
    mark()
    try {
      const r = await cli(['set', ...A, '--where', 'status=todo', '--priority', 'low', '--yes', '--json'])
      assert.equal(r.code, 1)
      assert.deepEqual([r.json.matched, r.json.succeeded, r.json.failed], [3, 2, 1])
      assert.deepEqual(r.json.results.filter((x: any) => !x.ok).map((x: any) => x.task), ['alpha/write-docs'])
      assert.match(r.json.results.find((x: any) => !x.ok).error, /being written by another process/)
      assert.deepEqual(written(), ['alpha/shared-task', 'alpha/write-tests'], 'every other match was written')
      const text = await cli(['set', ...A, '--where', 'status=todo', '--priority', 'low', '--yes'])
      assert.match(text.stdout, /updated 2 of 3 tasks/)
      assert.match(text.stdout, /✗ alpha\/write-docs: /)
    }
    finally {
      rmSync(lock, { force: true })
    }
  })

  it('validates the selection before doing anything', async () => {
    const cases: string[][] = [
      ['set', ...A, '--where', 'colour=red', '--priority', 'low', '--yes'],
      ['set', ...A, '--where', '', '--priority', 'low', '--yes'],
      ['set', ...A, 'write-docs', '--where', 'status=todo', '--priority', 'low', '--yes'],
      ['set', ...A, '--priority', 'low'],
      ['set', ...A, '--where', 'status=todo', '--title', 'Same title', '--yes'],
      ['set', ...A, '--where', 'status=todo', '--description', 'same body', '--yes'],
      ['set', ...A, '--where', 'status=todo', '--yes'],
    ]
    for (const args of cases) assert.equal((await cli(args)).code, 2, args.join(' '))
    assert.deepEqual(written(), [])
  })

  it('single-task usage is unchanged', async () => {
    assert.equal((await cli(['done', 'write-docs', ...A])).code, 0)
    assert.deepEqual(written(), ['alpha/write-docs'])
  })
})
