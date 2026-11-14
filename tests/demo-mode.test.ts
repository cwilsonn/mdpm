import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, afterEach, beforeEach, describe, it } from 'node:test'
import * as seed from '../server/utils/seed'
import { isDemo } from '../server/utils/demo'
import { rejects, route } from './route-harness'
import { REPO, scratchDir } from './helpers'

// Demo mode (the public sandbox's hourly wipe and creation caps) must be opt-in through MDPM_DEMO=1.
// It used to key off NODE_ENV, which the production build inlines: a local build wiped content at boot.

const g = globalThis as Record<string, unknown>
g.defineNitroPlugin = (fn: unknown) => fn
g.defineTask = (def: unknown) => def
Object.assign(g, seed)

const scratch = scratchDir()
after(scratch.cleanup)

let root: string
let n = 0
const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
const savedDemo = process.env.MDPM_DEMO

beforeEach(() => {
  root = join(scratch.dir, `c${n++}`)
  process.env.MDPM_CONTENT_PATH = root
  delete process.env.MDPM_DEMO
  put('projects/mine/index.md', '---\ntitle: Mine\ncreatedAt: \'2026-01-01\'\n---\n')
  put('projects/mine/tasks/keep.md', '---\ntitle: Keep\nstatus: todo\n---\nPrecious.\n')
})
afterEach(() => {
  if (savedDemo === undefined) delete process.env.MDPM_DEMO
  else process.env.MDPM_DEMO = savedDemo
})
after(() => { delete process.env.MDPM_CONTENT_PATH })

describe('demo mode', () => {
  it('is on only for MDPM_DEMO=1', () => {
    for (const v of [undefined, '', '0', 'true', 'production']) {
      if (v === undefined) delete process.env.MDPM_DEMO
      else process.env.MDPM_DEMO = v
      assert.equal(isDemo(), false, `MDPM_DEMO=${v}`)
    }
    process.env.MDPM_DEMO = '1'
    assert.equal(isDemo(), true)
  })

  it('the boot plugin leaves content alone outside demo mode, whatever NODE_ENV says', async () => {
    const savedEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const plugin = (await import(join(REPO, 'server/plugins/seed.ts'))).default as () => void
      plugin()
    }
    finally {
      process.env.NODE_ENV = savedEnv
    }
    assert.equal(readFileSync(join(root, 'projects/mine/tasks/keep.md'), 'utf8').includes('Precious.'), true)
    assert.deepEqual(readdirSync(join(root, 'projects')), ['mine'])
  })

  it('the boot plugin wipes and re-seeds in demo mode', async () => {
    process.env.MDPM_DEMO = '1'
    const plugin = (await import(join(REPO, 'server/plugins/seed.ts'))).default as () => void
    plugin()
    assert.equal(existsSync(join(root, 'projects/mine')), false)
    assert.ok(readdirSync(join(root, 'projects')).length > 0, 'demo projects seeded')
  })

  it('the hourly reset task is a no-op outside demo mode', async () => {
    const task = (await import(join(REPO, 'server/tasks/reset.ts'))).default as { run: () => { result: string } }
    assert.match(task.run().result, /^skipped/)
    assert.equal(existsSync(join(root, 'projects/mine/tasks/keep.md')), true)
  })

  it('creation caps apply only in demo mode', async () => {
    const post = await route('tasks/index.post')
    for (let i = 0; i < 21; i++) await post({ body: { project: 'mine', title: `Task ${i}` } })
    assert.equal(readdirSync(join(root, 'projects/mine/tasks')).length, 22)

    process.env.MDPM_DEMO = '1'
    const err = await rejects(post({ body: { project: 'mine', title: 'One too many' } }))
    assert.equal(err.statusCode, 429)
  })

  it('health reports the content root except in demo mode', async () => {
    const health = await route('health.get')
    assert.equal((await health({})).contentRoot, root)
    process.env.MDPM_DEMO = '1'
    assert.equal((await health({})).contentRoot, undefined)
  })

  // NODE_ENV is replaced at build time, so a runtime decision keyed on it silently becomes a constant.
  it('server code and nuxt.config never branch on NODE_ENV', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.(ts|mjs|js)$/.test(e.name) && /process\.env\.NODE_ENV/.test(readFileSync(p, 'utf8'))) offenders.push(p)
      }
    }
    walk(join(REPO, 'server'))
    if (/process\.env\.NODE_ENV/.test(readFileSync(join(REPO, 'nuxt.config.ts'), 'utf8'))) offenders.push('nuxt.config.ts')
    assert.deepEqual(offenders, [])
  })
})
