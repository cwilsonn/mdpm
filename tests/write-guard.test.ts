import { strict as assert } from 'node:assert'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { allowedHosts, checkRequest } from '../server/utils/request-guard'
import { rejects, route } from './route-harness'
import { scratchDir } from './helpers'

// The server has no authentication and listens on loopback. These pin the two browser attacks that
// still reach it (DNS rebinding, cross-site "simple" POSTs) and the write-path holes found in the
// 2026-11 audit: path traversal in reorder and query filters, and request keys stored as frontmatter.

describe('request guard', () => {
  const hosts = allowedHosts({ MDPM_BASE_URL: 'http://mdpm.local:3333', MDPM_ALLOWED_HOSTS: 'demo.example.com, Other.Example' })
  const check = (method: string, headers: Record<string, string | undefined>, path = '/api/tasks') =>
    checkRequest({ method, path, headers }, hosts)?.statusCode

  it('serves loopback names, the base URL host and MDPM_ALLOWED_HOSTS', () => {
    for (const host of ['localhost:3333', '127.0.0.1:3333', '[::1]:3333', 'mdpm.local:3333', 'demo.example.com', 'other.example']) {
      assert.equal(check('GET', { host }), undefined, host)
    }
  })

  it('refuses any other Host, for reads too (DNS rebinding)', () => {
    assert.equal(check('GET', { host: 'attacker.example:3333' }, '/api/export/archive'), 403)
    assert.equal(check('GET', { host: 'attacker.example' }, '/projects'), 403)
  })

  it('lets internal requests without a Host header through', () => {
    assert.equal(check('GET', {}), undefined)
  })

  it('refuses mutations from a foreign or opaque Origin', () => {
    assert.equal(check('PATCH', { 'host': 'localhost:3333', 'origin': 'https://attacker.example', 'content-type': 'application/json' }), 403)
    assert.equal(check('POST', { 'host': 'localhost:3333', 'origin': 'null', 'content-type': 'application/json' }), 403)
    assert.equal(check('POST', { 'host': 'mdpm.local:3333', 'origin': 'http://mdpm.local:3333', 'content-type': 'application/json' }), undefined)
  })

  it('requires application/json on API POSTs (no simple cross-site requests)', () => {
    for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      assert.equal(check('POST', { 'host': 'localhost:3333', 'content-type': type }), 415, String(type))
    }
    assert.equal(check('POST', { 'host': 'localhost:3333', 'content-type': 'application/json; charset=utf-8' }), undefined)
  })

  it('does not demand a body type on DELETE (browsers preflight it anyway)', () => {
    assert.equal(check('DELETE', { host: 'localhost:3333' }), undefined)
  })
})

const scratch = scratchDir()
after(scratch.cleanup)
after(() => { delete process.env.MDPM_CONTENT_PATH })

let root: string
let n = 0
const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
const raw = (rel: string) => readFileSync(join(root, rel), 'utf8')
const TASK = '---\ntitle: One\nstatus: todo\npriority: medium\ncreatedAt: \'2026-10-01\'\norder: 0\n---\nSpec.\n'

beforeEach(() => {
  root = join(scratch.dir, `c${n++}`, 'content')
  process.env.MDPM_CONTENT_PATH = root
  put('projects/p/index.md', '---\ntitle: P\ncreatedAt: \'2026-01-01\'\n---\n')
  put('projects/p/tasks/one.md', TASK)
  put('projects/p/docs/d.md', '---\ntitle: D\ncreatedAt: \'2026-01-01\'\n---\nDoc.\n')
  put('outside.md', '---\ntitle: canary\n---\nuntouched\n')
})

describe('path segments', () => {
  it('reorder refuses slugs that leave the content root, before writing anything', async () => {
    const reorder = await route('tasks/reorder.post')
    const err = await rejects(reorder({ body: { project: 'p', order: { todo: ['one', '../../../outside'] } } }))
    assert.equal(err.statusCode, 400)
    assert.equal(raw('outside.md'), '---\ntitle: canary\n---\nuntouched\n')
    assert.equal(raw('projects/p/tasks/one.md'), TASK, 'valid slugs in the same request are not written either')
  })

  it('reorder refuses a project that leaves the content root', async () => {
    const reorder = await route('tasks/reorder.post')
    assert.equal((await rejects(reorder({ body: { project: '..', order: { todo: ['outside'] } } }))).statusCode, 400)
  })

  it('task and doc list filters refuse a traversing project', async () => {
    const tasks = await route('tasks/index.get')
    const docs = await route('docs/index.get')
    // These handlers are synchronous, so they throw rather than reject.
    assert.equal((await rejects((async () => tasks({ query: { project: '../..' } }))())).statusCode, 400)
    assert.equal((await rejects((async () => docs({ query: { project: '../..' } }))())).statusCode, 400)
  })
})

describe('write bodies', () => {
  it('a task update with an unknown field is refused and names it; the file is untouched', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const err = await rejects(patch({ params: { project: 'p', slug: 'one' }, body: { status: 'done', createdBy: 'x' } }))
    assert.equal(err.statusCode, 400)
    assert.match(err.message, /unknown field: createdBy/)
    assert.equal(raw('projects/p/tasks/one.md'), TASK)
  })

  it('`body` is accepted as the task text instead of landing in frontmatter', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    await patch({ params: { project: 'p', slug: 'one' }, body: { body: 'New spec.' } })
    const file = matter(raw('projects/p/tasks/one.md'))
    assert.equal(file.content.trim(), 'New spec.')
    assert.equal('body' in file.data, false)
  })

  it('status and priority must be known values', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const post = await route('tasks/index.post')
    assert.match((await rejects(patch({ params: { project: 'p', slug: 'one' }, body: { status: 'nonsense' } }))).message, /status/)
    assert.match((await rejects(post({ body: { project: 'p', title: 'X', priority: 'whenever' } }))).message, /priority/)
  })

  it('null still clears an optional field', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    await patch({ params: { project: 'p', slug: 'one' }, body: { due: '2026-12-01' } })
    await patch({ params: { project: 'p', slug: 'one' }, body: { due: null } })
    assert.equal('due' in matter(raw('projects/p/tasks/one.md')).data, false)
  })

  it('a batch refuses a bad op and applies the rest', async () => {
    const batch = await route('tasks/batch.post')
    const r = await batch({ body: { ops: [
      { op: 'update', project: 'p', slug: 'one', status: 'done', bogus: 1 },
      { op: 'create', project: 'p', title: 'Fine' },
    ] } })
    assert.equal(r.failed, 1)
    assert.match(r.results[0].error, /unknown field: bogus/)
    assert.equal(r.results[1].ok, true)
    assert.equal(matter(raw('projects/p/tasks/one.md')).data.status, 'todo')
  })

  it('project and doc updates refuse unknown fields', async () => {
    const project = await route('projects/[slug].patch')
    const doc = await route('docs/[project]/[slug].patch')
    assert.equal((await rejects(project({ params: { slug: 'p' }, body: { owner: 'x' } }))).statusCode, 400)
    assert.equal((await rejects(doc({ params: { project: 'p', slug: 'd' }, body: { description: 'x' } }))).statusCode, 400)
  })
})
