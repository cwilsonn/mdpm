import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { blockedTasks, blockersOf, buildGraph, readyTasks, tree, wouldCreateCycle, type DepTask } from '../lib/core'
import { mockApi, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

let order = 0
const t = (slug: string, status: string, deps: string[] = [], extra: Partial<DepTask> = {}): DepTask => ({
  project: 'p', slug, title: slug, status, priority: 'medium', order: order++, dependencies: deps, archivedAt: null, ...extra,
})

describe('dependency graph', () => {
  it('treats done and archived dependencies as resolved, anything else as a blocker', () => {
    const g = buildGraph([t('a', 'done'), t('b', 'todo'), t('c', 'todo', [], { archivedAt: '2026-01-01' }), t('d', 'todo', ['a', 'b', 'c'])])
    assert.deepEqual(blockersOf(g, 'p/d'), [{ id: 'p/b', reason: 'open', status: 'todo' }])
  })

  it('reports a dependency on a task that does not exist, and keeps the dependent blocked', () => {
    const g = buildGraph([t('a', 'todo', ['ghost'])])
    assert.deepEqual(g.missing, [{ task: 'p/a', dependency: 'p/ghost' }])
    assert.deepEqual(blockersOf(g, 'p/a'), [{ id: 'p/ghost', reason: 'missing' }])
    assert.equal(readyTasks(g).length, 0)
  })

  it('resolves project/slug across projects', () => {
    const g = buildGraph([t('a', 'todo', ['q/b']), { ...t('b', 'done'), project: 'q' }])
    assert.deepEqual(blockersOf(g, 'p/a'), [])
    assert.deepEqual(readyTasks(g).map(x => x.slug), ['a'])
  })

  it('ready = todo, unarchived, all dependencies resolved, ordered by priority then board order', () => {
    const g = buildGraph([
      t('lowprio', 'todo', [], { priority: 'low' }),
      t('urgent', 'todo', [], { priority: 'urgent' }),
      t('waiting', 'todo', ['inprogress']),
      t('inprogress', 'in-progress'),
      t('finished', 'done'),
      t('shelved', 'todo', [], { archivedAt: '2026-01-01' }),
    ])
    assert.deepEqual(readyTasks(g).map(x => x.slug), ['urgent', 'lowprio'])
  })

  it('blocked lists todo and in-progress tasks that are waiting, with their blockers', () => {
    const g = buildGraph([t('a', 'todo'), t('b', 'in-progress', ['a']), t('c', 'todo', ['a', 'ghost']), t('d', 'in-review', ['a'])])
    const blocked = blockedTasks(g)
    assert.deepEqual(blocked.map(b => b.task.slug).sort(), ['b', 'c'])
    assert.equal(blocked.find(b => b.task.slug === 'c')!.blockers.length, 2)
  })

  it('finds cycles, including a self-dependency, and leaves acyclic graphs alone', () => {
    assert.deepEqual(buildGraph([t('a', 'todo', ['b']), t('b', 'todo', ['c']), t('c', 'todo', ['a']), t('x', 'todo')]).cycles, [['p/a', 'p/b', 'p/c']])
    assert.deepEqual(buildGraph([t('a', 'todo', ['a'])]).cycles, [['p/a']])
    assert.deepEqual(buildGraph([t('a', 'todo', ['b']), t('b', 'todo', ['c']), t('c', 'todo')]).cycles, [])
  })

  it('walks a diamond as a tree in both directions, and stops at cycles', () => {
    const g = buildGraph([t('top', 'todo', ['l', 'r']), t('l', 'todo', ['base']), t('r', 'todo', ['base']), t('base', 'done')])
    const up = tree(g, 'p/top', 'up')
    assert.deepEqual(up.children.map(c => c.id), ['p/l', 'p/r'])
    assert.deepEqual(up.children[0]!.children.map(c => c.id), ['p/base'])
    assert.deepEqual(tree(g, 'p/base', 'down').children.map(c => c.id), ['p/l', 'p/r'])
    const loop = buildGraph([t('a', 'todo', ['b']), t('b', 'todo', ['a'])])
    assert.ok(tree(loop, 'p/a', 'up').children[0]!.children[0]!.cycle)
  })

  it('predicts the cycle a new dependency would create, with its path', () => {
    const g = buildGraph([t('a', 'todo', ['b']), t('b', 'todo', ['c']), t('c', 'todo')])
    assert.deepEqual(wouldCreateCycle(g, 'p/c', ['p/a']), ['p/c', 'p/a', 'p/b', 'p/c'])
    assert.deepEqual(wouldCreateCycle(g, 'p/a', ['p/a']), ['p/a', 'p/a'])
    assert.equal(wouldCreateCycle(g, 'p/a', ['p/c']), undefined)
  })
})

describe('task ready / blocked / graph (CLI)', () => {
  const cli = (args: string[], env: Record<string, string> = {}) => runCli(['task', ...args], { scratch: scratch.dir, env })

  it('ready lists unblocked todo tasks across projects', async () => {
    const r = await cli(['ready', '--all', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json.map((x: any) => `${x.project}/${x.slug}`), ['beta/beta-task', 'beta/shared-task', 'alpha/write-docs'])
  })

  it('ready is scoped to a project', async () => {
    const r = await cli(['ready', '--project', 'alpha', '--json'])
    assert.deepEqual(r.json.map((x: any) => x.slug), ['write-docs'])
  })

  it('--blocked shows what each waiting task waits on', async () => {
    const r = await cli(['ready', '--all', '--blocked', '--json'])
    const byTask = Object.fromEntries(r.json.map((x: any) => [`${x.project}/${x.slug}`, x.blockers.map((b: any) => b.id)]))
    assert.deepEqual(byTask, {
      'alpha/write-parser': ['alpha/shared-task'],
      'alpha/write-tests': ['alpha/write-parser'],
      'alpha/shared-task': ['beta/shared-task'],
    })
    const text = await cli(['ready', '--project', 'alpha', '--blocked'])
    assert.match(text.stdout, /WAITING ON/)
    assert.match(text.stdout, /write-tests\s+write-parser \[in-progress\]/)
  })

  it('graph for one task shows what it waits on and what it unblocks, flagging a missing dependency', async () => {
    const r = await cli(['graph', 'write-tests', '--project', 'alpha'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /Waits on:\n└─ alpha\/write-parser \[in-progress\]\n   └─ alpha\/shared-task \[todo\]\n      └─ beta\/shared-task \[todo\]/)
    assert.match(r.stdout, /Unblocks:\n└─ alpha\/review-release \[in-review\]/)
    const review = await cli(['graph', 'review-release', '--project', 'alpha'])
    assert.match(review.stdout, /alpha\/ghost-task \(missing\)/)
  })

  it('graph JSON carries edges, missing dependencies, and cycles', async () => {
    const r = await cli(['graph', '--project', 'alpha', '--json'])
    assert.deepEqual(r.json.missing, [{ task: 'alpha/review-release', dependency: 'alpha/ghost-task' }])
    assert.deepEqual(r.json.cycles, [])
    assert.ok(r.json.edges.some((e: any) => e.dependency === 'alpha/write-parser' && e.task === 'alpha/write-tests'))
  })

  it('graph renders mermaid and dot', async () => {
    const mermaid = (await cli(['graph', '--project', 'alpha', '--format', 'mermaid'])).stdout
    assert.match(mermaid, /^flowchart LR/)
    assert.match(mermaid, /n\d+ --> n\d+/)
    const dot = (await cli(['graph', '--project', 'alpha', '--format', 'dot'])).stdout
    assert.match(dot, /^digraph tasks \{/)
    assert.match(dot, /"alpha\/write-parser" -> "alpha\/write-tests";/)
    assert.equal((await cli(['graph', '--format', 'svg'])).code, 2)
  })

  it('reports cycles found in the content', async () => {
    const content = join(scratch.dir, 'cyclic')
    const dir = join(content, 'projects/c/tasks')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(content, 'projects/c/index.md'), '---\ntitle: C\nstatus: active\n---\n')
    for (const [slug, dep] of [['x', 'y'], ['y', 'x']]) writeFileSync(join(dir, `${slug}.md`), `---\ntitle: ${slug}\nstatus: todo\npriority: medium\ndependencies: [${dep}]\norder: 0\n---\n`)
    const r = await cli(['graph', '--project', 'c', '--json'], { MDPM_CONTENT_PATH: content })
    assert.deepEqual(r.json.cycles, [['c/x', 'c/y']])
    assert.match((await cli(['graph', '--project', 'c'], { MDPM_CONTENT_PATH: content })).stdout, /cycles: c\/x ↔ c\/y/)
  })
})

describe('--dependencies on add and set', () => {
  let api: Awaited<ReturnType<typeof mockApi>>
  before(async () => { api = await mockApi() })
  after(() => api.close())
  const cli = (args: string[]) => runCli(['task', ...args], { scratch: scratch.dir, env: { MDPM_BASE_URL: api.url } })
  const last = () => api.requests.filter(r => r.method !== 'GET').at(-1)!

  it('set resolves fragments, uses project/slug across projects, and stores bare slugs within a project', async () => {
    const r = await cli(['set', 'write-docs', '--project', 'alpha', '--dependencies', 'parser,beta/beta-task'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(last().body, { dependencies: ['write-parser', 'beta/beta-task'] })
  })

  it('set --dependencies none clears them', async () => {
    await cli(['set', 'write-tests', '--project', 'alpha', '--dependencies', 'none'])
    assert.deepEqual(last().body, { dependencies: [] })
  })

  it('refuses a dependency that would create a cycle, naming the path, and sends nothing', async () => {
    const before = api.requests.length
    const r = await cli(['set', 'write-parser', '--project', 'alpha', '--dependencies', 'write-tests'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /dependency cycle: alpha\/write-parser → alpha\/write-tests → alpha\/write-parser/)
    assert.equal(api.requests.length, before)
  })

  it('refuses a self-dependency and an unknown task', async () => {
    assert.equal((await cli(['set', 'write-docs', '--project', 'alpha', '--dependencies', 'write-docs'])).code, 2)
    assert.equal((await cli(['set', 'write-docs', '--project', 'alpha', '--dependencies', 'zzz-nope'])).code, 4)
  })

  it('add accepts --dependencies too', async () => {
    const r = await cli(['add', 'Follow-up', '--project', 'alpha', '--dependencies', 'ship-v1'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(last().body.dependencies, ['ship-v1'])
  })
})
