import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { mockApi, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

const root = join(scratch.dir, 'content')
const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
let api: Awaited<ReturnType<typeof mockApi>>

before(async () => {
  put('projects/p/index.md', '---\ntitle: P\n---\n')
  put('projects/p/tasks/one.md', "---\ntitle: One\nstatus: todo\npriority: medium\ncreatedAt: '2026-10-01'\norder: 0\n---\nBody\n")
  api = await mockApi(req => req.path === '/api/health' ? { body: { ok: true } } : req.path === '/api/tasks/batch' ? { body: { ok: 1, failed: 0, results: [{ index: 0, ok: true, id: 'p/one', status: 'todo' }] } } : req.method === 'POST' && req.path === '/api/tasks' ? { body: { slug: req.body.slug ?? 'x', id: 'p/x', status: req.body.status } } : {})
})
after(() => api.close())

const cli = (args: string[], env: Record<string, string> = {}, input?: string) =>
  runCli(args, { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: root, MDPM_BASE_URL: api.url, ...env }, input })

async function waitFor(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (check()) return true
    await new Promise(r => setTimeout(r, 50))
  }
  return false
}
const patches = () => api.requests.filter(r => r.method === 'PATCH')

describe('--async', () => {
  it('prints the resolved id at once and the write lands in the background', async () => {
    const r = await cli(['task', 'done', 'one', '--project', 'p', '--note', 'fin', '--async', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json, { queued: 'p/one' })
    assert.ok(await waitFor(() => patches().length === 1), 'the detached copy performs the write')
    assert.deepEqual(patches()[0]!.body.status, 'done')
    assert.equal(patches()[0]!.body.note, 'fin')
  })

  it('predicts the slug of a create and passes stdin through to a batch', async () => {
    const created = await cli(['task', 'add', 'Brand new work', '--project', 'p', '--async'])
    assert.match(created.stdout, /queued task add: p\/brand-new-work/)
    const before = api.requests.length
    const batch = await cli(['task', 'batch', '--project', 'p', '--async', '--json'], {}, JSON.stringify([{ op: 'note', ref: 'one', note: 'hi' }]))
    assert.deepEqual(batch.json, { queued: '1 ops' })
    assert.ok(await waitFor(() => api.requests.slice(before).some(r => r.path === '/api/tasks/batch')))
  })

  it('fails at once on what the files can already tell: unknown ref, unsupported command, bad batch JSON', async () => {
    assert.equal((await cli(['task', 'done', 'nope', '--project', 'p', '--async'])).code, 4)
    assert.equal((await cli(['project', 'create', 'x', '--async'])).code, 2)
    assert.equal((await cli(['task', 'batch', '--project', 'p', '--async'], {}, 'not json')).code, 2)
  })

  it('records a failed background write and mdpm status reports it until acknowledged', async () => {
    const state = join(scratch.dir, 'state', 'async-failures.jsonl')
    const r = await cli(['task', 'done', 'one', '--project', 'p', '--async'], { MDPM_BASE_URL: 'http://127.0.0.1:1' })
    assert.equal(r.code, 0)
    assert.ok(await waitFor(() => existsSync(state)), 'the failure is written to the state dir')
    const status = await cli(['status', '--json'], { MDPM_BASE_URL: 'http://127.0.0.1:1' })
    assert.equal(status.json.asyncFailures.length >= 1, true)
    assert.equal(status.json.asyncFailures[0].what, 'task done')
    assert.match(readFileSync(state, 'utf8'), /unreachable/)
    await cli(['status', '--ack-async'], { MDPM_BASE_URL: 'http://127.0.0.1:1' })
    assert.equal(existsSync(state), false)
  })
})
