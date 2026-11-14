import { strict as assert } from 'node:assert'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { buildPickup, createCore } from '../lib/core'
import { handoffTime } from '../lib/core/pickup'
import { FIXTURE_CONTENT, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

let core: ReturnType<typeof createCore>
const content = join(scratch.dir, 'content')
const write = (rel: string, text: string) => {
  const full = join(content, rel)
  mkdirSync(join(full, '..'), { recursive: true })
  writeFileSync(full, text)
}
const note = (stamp: string, text: string) => `**Note** _(${stamp})_ by claude\n\n${text}`

before(() => {
  cpSync(FIXTURE_CONTENT, content, { recursive: true })
  // Handoff at a known ISO instant.
  write('projects/alpha/docs/2026-07-08-2214-session-notes.md', `---\ntitle: Session Notes 2026-07-08 22:14\ntags: [session-notes]\ncreatedAt: 2026-07-09\nupdatedAt: '2026-07-08T22:14:00.000Z'\n---\n${'Long paragraph of notes. '.repeat(400)}`)
  // Old activity (before the handoff) and new activity (after it).
  write('projects/alpha/tasks/old-work.md', `---\ntitle: Old work\nstatus: todo\npriority: low\ncreatedAt: 2026-06-01\nupdatedAt: '2026-07-01T10:00:00.000Z'\norder: 20\n---\nOld.`)
  write('projects/alpha/tasks/new-work.md', `---\ntitle: New work\nstatus: in-progress\npriority: high\ncreatedAt: 2026-07-10\nupdatedAt: '2026-07-10T09:00:00.000Z'\norder: 21\n---\nNew.\n\n---\n${note('2026-07-10 09:00', 'Started it.')}`)
  write('projects/alpha/tasks/waiting.md', `---\ntitle: Waiting task\nstatus: todo\npriority: medium\ncreatedAt: 2026-06-01\ndependencies: [new-work, ghost-task]\norder: 22\n---\nNeeds things.`)
  write('projects/alpha/tasks/fix-login-bug.md', `---\ntitle: Fix login bug\nstatus: blocked\npriority: urgent\ntags: []\nassignees: [sam]\ncreatedAt: 2026-06-10\norder: 3\n---\nBlocked on upstream.\n\n---\n${note('2026-07-01 08:00', 'Waiting for the vendor to ship the fix.\n\nMore detail.')}`)
  core = createCore({ contentPath: content, baseUrl: 'http://127.0.0.1:1' })
})

describe('pickup caps', () => {
  it('lists at most perStatus tasks per status and says how many are hidden', () => {
    const p = buildPickup(core, 'alpha', { perStatus: 1 })
    assert.equal(p.tasks.todo.length, 1)
    assert.ok((p.hiddenTasks?.todo ?? 0) >= 2)
    assert.equal(p.openTaskCount, buildPickup(core, 'alpha', { full: true }).openTaskCount)
  })

  it('shows the highest priority first when it has to cut', () => {
    const p = buildPickup(core, 'alpha', { perStatus: 1 })
    const all = buildPickup(core, 'alpha', { full: true }).tasks.todo.map(t => t.priority)
    assert.equal(p.tasks.todo[0]!.priority, all[0])
  })

  it('cuts the last session notes and reports the full length; full keeps them whole', () => {
    const p = buildPickup(core, 'alpha')
    assert.equal(p.lastSessionNotes!.body.length, 1500)
    assert.equal(p.lastSessionNotes!.truncated, true)
    assert.ok(p.lastSessionNotes!.totalChars! > 1500)
    assert.equal(buildPickup(core, 'alpha', { full: true }).lastSessionNotes!.truncated, undefined)
  })

  it('caps docs but always lists the high-priority ones', () => {
    const p = buildPickup(core, 'alpha', { docs: 0 })
    assert.ok(p.docs.every(d => d.highPriority))
    assert.ok(p.docs.some(d => d.slug === 'architecture'))
  })
})

describe('pickup blockers', () => {
  it('reports blocked tasks with the reason from their newest note, and tasks waiting on dependencies', () => {
    const { blockers } = buildPickup(core, 'alpha')
    assert.equal(blockers.find(b => b.slug === 'fix-login-bug')!.reason, 'Waiting for the vendor to ship the fix.')
    const waiting = blockers.find(b => b.slug === 'waiting')!.reason
    assert.match(waiting, /alpha\/new-work \(in-progress\)/)
    assert.match(waiting, /alpha\/ghost-task \(missing\)/)
  })
})

describe('pickup delta', () => {
  it('lists only what changed after the last handoff', () => {
    const d = buildPickup(core, 'alpha').sinceLastSession!
    assert.equal(d.basedOn, '2026-07-08-2214-session-notes')
    assert.equal(d.since, '2026-07-08T22:14:00.000Z')
    const tasks = d.changes.map(c => c.task)
    assert.ok(tasks.includes('new-work'))
    assert.ok(!tasks.includes('old-work'))
    assert.ok(d.changes.some(c => c.type === 'note' && c.task === 'new-work' && c.detail === 'Started it.'))
    assert.match(d.note, /not recorded/)
  })

  it('anchors on the slug date and time when the doc has no ISO timestamp', () => {
    assert.equal(handoffTime({ slug: '2026-07-08-2214-session-notes', createdAt: '2026-07-09', updatedAt: null } as any)!.getHours(), 22)
  })

  it('is null for a project with no session notes', () => {
    assert.equal(buildPickup(core, 'beta').sinceLastSession, null)
  })

  it('caps the entries and counts the rest', () => {
    const d = buildPickup(core, 'alpha', { deltaEntries: 1 }).sinceLastSession!
    assert.equal(d.changes.length, 1)
    assert.ok(d.moreChanges >= 1)
  })
})
