import { strict as assert } from 'node:assert'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import matter from 'gray-matter'
import { applyCompaction, buildPickup, createCore, digest, planCompaction } from '../lib/core'
import { runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)
const root = join(scratch.dir, 'content')
const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
const notes = (day: string, extra = '') => `---\ntitle: Session Notes 2026-09-${day}\ntags: [session-notes]\ncreatedAt: 2026-09-${day}\n---\n## What was done\n\n- Shipped feature ${day}\n- Fixed bug ${day}\n\n## Decisions made\n\n- Chose option ${day}\n${extra}`

before(() => {
  put('projects/p/index.md', '---\ntitle: P\n---\n')
  for (const day of ['01', '02', '03', '04', '05', '06', '07']) put(`projects/p/docs/2026-09-${day}-1200-session-notes.md`, notes(day))
  put('projects/p/docs/architecture.md', '---\ntitle: Architecture\ntags: [architecture]\n---\nStack.')
})

describe('digest', () => {
  it('keeps the first substantive lines, drops headings, shortens long ones', () => {
    assert.equal(digest('## H\n\nOne.\n\n- Two\n\n---\n\nThree\nFour\nFive'), '- One.\n- Two\n- Three\n- Four')
    assert.ok(digest(`- ${'x'.repeat(400)}`).length <= 165)
  })
})

describe('planCompaction', () => {
  const core = createCore({ contentPath: root, baseUrl: 'http://127.0.0.1:1' })

  it('keeps the newest N and digests the rest, newest first', () => {
    const plan = planCompaction(core, 'p', { keep: 5 })
    assert.deepEqual(plan.kept.map(k => k.slug.slice(0, 10)), ['2026-09-07', '2026-09-06', '2026-09-05', '2026-09-04', '2026-09-03'])
    assert.deepEqual(plan.compacted.map(c => c.slug.slice(0, 10)), ['2026-09-02', '2026-09-01'])
    assert.match(plan.rollup.body, /### 2026-09-02-1200-session-notes — Session Notes 2026-09-02\n- Shipped feature 02/)
    assert.ok(plan.rollup.body.indexOf('09-02') < plan.rollup.body.indexOf('09-01'))
    assert.equal(plan.rollup.existing, false)
  })

  it('has nothing to do when there are no more than N', () => {
    assert.equal(planCompaction(core, 'p', { keep: 7 }).compacted.length, 0)
  })

  it('merges into an existing rollup without duplicating entries', () => {
    put('projects/p/docs/notes-rollup.md', '---\ntitle: Session notes — rollup\ntags: [archive]\n---\nOlder.\n\n### 2026-08-30-1200-session-notes — Old\n- Ancient work\n\n### 2026-09-01-1200-session-notes — Session Notes 2026-09-01\n- stale digest\n')
    const plan = planCompaction(core, 'p', { keep: 5 })
    assert.equal(plan.rollup.existing, true)
    assert.equal((plan.rollup.body.match(/2026-09-01-1200-session-notes/g) ?? []).length, 1)
    assert.match(plan.rollup.body, /Shipped feature 01/)
    assert.match(plan.rollup.body, /Ancient work/)
    assert.ok(plan.rollup.body.indexOf('09-02') < plan.rollup.body.indexOf('08-30'))
  })

  it('the rollup is a regular doc to pickup, not session notes, and leaves the session count alone', () => {
    const p = buildPickup(core, 'p', { docs: 10 })
    assert.equal(p.sessionNotesCount, 7)
    assert.ok(p.docs.some(d => d.slug === 'notes-rollup'))
    assert.equal(p.compactionHint, undefined)
  })
})

describe('mdpm notes compact', () => {
  const run = (args: string[]) => runCli(['notes', 'compact', '--project', 'p', '--json', ...args], { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: root } })
  const docs = () => readdirSync(join(root, 'projects/p/docs')).sort()
  const doc = (slug: string) => matter(readFileSync(join(root, 'projects/p/docs', `${slug}.md`), 'utf8'))

  it('is a dry run by default and writes nothing', async () => {
    const before = docs().map(f => readFileSync(join(root, 'projects/p/docs', f), 'utf8'))
    const r = await run([])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.json.dryRun, true)
    assert.equal(r.json.compacted.length, 2)
    assert.deepEqual(docs().map(f => readFileSync(join(root, 'projects/p/docs', f), 'utf8')), before)
  })

  it('--apply writes the rollup, then archives each original (never deletes)', async () => {
    const before = docs()
    const r = await run(['--apply'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json.archived.map((s: string) => s.slice(0, 10)), ['2026-09-02', '2026-09-01'])
    assert.match(doc('notes-rollup').content, /Shipped feature 01/)
    for (const slug of r.json.archived) assert.equal(typeof doc(slug).data.archivedAt, 'string')
    assert.ok(before.every(f => docs().includes(f)), 'nothing was deleted')
  })

  it('rejects a bad --keep', async () => {
    assert.equal((await run(['--keep', '0'])).code, 2)
  })
})

describe('applyCompaction', () => {
  it('does nothing when there is nothing to compact', async () => {
    const core = createCore({ contentPath: root, baseUrl: 'http://127.0.0.1:1' })
    assert.deepEqual(await applyCompaction(core, planCompaction(core, 'p', { keep: 99 })), { archived: [] })
  })
})
