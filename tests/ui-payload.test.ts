import { strict as assert } from 'node:assert'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import matter from 'gray-matter'
import { route } from './route-harness'
import { FIXTURE_CONTENT } from './helpers'

// The web UI used to download every task and doc on every page (the layout's command palette) and on the
// projects page (to count them). These pin the server-side replacements.

before(() => { process.env.MDPM_CONTENT_PATH = FIXTURE_CONTENT })
after(() => { delete process.env.MDPM_CONTENT_PATH })

const statusesOf = (project: string) => readdirSync(join(FIXTURE_CONTENT, 'projects', project, 'tasks'))
  .filter(f => f.endsWith('.md'))
  .map(f => (matter.read(join(FIXTURE_CONTENT, 'projects', project, 'tasks', f)).data.status as string | undefined) ?? 'todo')

describe('GET /api/tasks?status=', () => {
  it('returns only the listed statuses', async () => {
    const list = await route('tasks/index.get')
    const all = await list({ query: {} }) as { status: string }[]
    const open = await list({ query: { status: 'todo,in-progress' } }) as { status: string }[]
    assert.ok(open.length > 0 && open.length < all.length)
    assert.ok(open.every(t => t.status === 'todo' || t.status === 'in-progress'))
    assert.equal(open.length, all.filter(t => t.status === 'todo' || t.status === 'in-progress').length)
  })
})

describe('GET /api/projects?withStats=1', () => {
  it('adds counts only when asked', async () => {
    const list = await route('projects/index.get')
    const plain = await list({ query: {} }) as Record<string, unknown>[]
    assert.ok(plain.every(p => !('stats' in p)))

    const withStats = await list({ query: { withStats: '1' } }) as { slug: string; stats: { total: number; done: number; byStatus: Record<string, number>; overdue: number; docs: number } }[]
    const alpha = withStats.find(p => p.slug === 'alpha')!
    const statuses = statusesOf('alpha')
    assert.equal(alpha.stats.total, statuses.length)
    assert.equal(alpha.stats.done, statuses.filter(s => s === 'done').length)
    assert.equal(Object.values(alpha.stats.byStatus).reduce((a, b) => a + b, 0), statuses.length)
    assert.equal(alpha.stats.docs, readdirSync(join(FIXTURE_CONTENT, 'projects/alpha/docs')).filter(f => f.endsWith('.md')).length)
    assert.ok(alpha.stats.overdue >= 0)
  })
})
