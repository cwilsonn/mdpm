import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { FIXTURE_CONTENT, isolatedEnv, mockApi, REPO, scratchDir } from './helpers'

// Drives the real MCP server over stdio, so the read path (files) and write path (HTTP API)
// are checked through the shared core, exactly as Claude Code would call them.
const scratch = scratchDir()
after(scratch.cleanup)

let api: Awaited<ReturnType<typeof mockApi>>
let child: ReturnType<typeof spawn>
let nextId = 1
let serverInfo: { name: string; version: string }
const pending = new Map<number, (msg: any) => void>()

function rpc(method: string, params: unknown = {}) {
  const id = nextId++
  return new Promise<any>((resolve) => {
    pending.set(id, resolve)
    child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
  })
}

async function tool(name: string, args: Record<string, unknown> = {}) {
  const res = await rpc('tools/call', { name, arguments: args })
  const text = res.result.content[0].text as string
  // List tools answer in tsv by default, which is not JSON.
  let json: any
  if (!res.result.isError && !text.startsWith('#')) json = JSON.parse(text)
  return { isError: !!res.result.isError, text, json }
}

before(async () => {
  api = await mockApi(req => req.path === '/api/tasks/batch'
    ? { body: { ok: req.body.ops.length, failed: 0, results: req.body.ops.map((_: unknown, index: number) => ({ index, ok: true, id: 'alpha/write-parser', status: 'done' })) } }
    : {})
  child = spawn('node', ['--import', 'tsx', join(REPO, 'mcp/index.ts')], {
    cwd: REPO,
    env: isolatedEnv(scratch.dir, { MDPM_CONTENT_PATH: FIXTURE_CONTENT, MDPM_BASE_URL: api.url }) as NodeJS.ProcessEnv,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  let buf = ''
  child.stdout!.on('data', (chunk) => {
    buf += chunk
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      const msg = JSON.parse(line)
      pending.get(msg.id)?.(msg)
    }
  })
  serverInfo = (await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })).result.serverInfo
  child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
})

after(async () => {
  child.kill()
  await api.close()
})

describe('MCP server through core', () => {
  it('advertises the package version, not a hardcoded one', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    assert.deepEqual(serverInfo, { name: 'mdpm', version: pkg.version })
  })

  it('lists its tools', async () => {
    const res = await rpc('tools/list')
    const names = res.result.tools.map((t: any) => t.name)
    for (const name of ['ping', 'list_tasks', 'create_task', 'update_task', 'search_docs', 'append_task_note']) assert.ok(names.includes(name), name)
  })

  it('ping reads the fixture content', async () => {
    const { json } = await tool('ping')
    assert.deepEqual(json.projects.sort(), ['alpha', 'beta', 'gamma'])
  })

  it('list_tasks filters like the CLI', async () => {
    const { json } = await tool('list_tasks', { project: 'alpha', status: ['blocked'], format: 'json' })
    assert.deepEqual(json.items.map((t: any) => t.slug), ['fix-login-bug'])
  })

  it('list_tasks is a small tsv page by default: totals line, header, no bodies', async () => {
    const { text } = await tool('list_tasks', { project: 'alpha', limit: 2 })
    const [head, header, ...rows] = text.split('\n')
    assert.match(head!, /^# total=7 returned=2 offset=0 next=2$/)
    assert.equal(header, 'project\tslug\ttitle\tstatus\tpriority\ttags\tassignees\tdue\tupdatedAt')
    assert.equal(rows.length, 2)
    assert.doesNotMatch(text, /Implement the parser/)
  })

  it('list_tasks pages with offset and picks fields; limit 0 returns everything', async () => {
    const second = await tool('list_tasks', { project: 'alpha', limit: 3, offset: 6, fields: ['slug', 'status'] })
    const lines = second.text.split('\n')
    assert.equal(lines[0], '# total=7 returned=1 offset=6 next=none')
    assert.equal(lines[1], 'slug\tstatus')
    const all = await tool('list_tasks', { project: 'alpha', limit: 0, format: 'json' })
    assert.equal(all.json.returned, 7)
    assert.equal(all.json.nextOffset, null)
    const bad = await tool('list_tasks', { project: 'alpha', fields: ['nope'] })
    assert.ok(bad.isError)
    assert.match(bad.text, /unknown field/)
  })

  it('search_tasks returns a match column instead of bodies', async () => {
    const { text } = await tool('search_tasks', { query: 'parser', project: 'alpha' })
    assert.match(text, /\bmatch\b/)
    assert.match(text, /write-parser/)
  })

  it('get_doc caps the body and says how to continue', async () => {
    const cut = (await tool('get_doc', { project: 'alpha', slug: 'architecture', maxChars: 10 })).json
    assert.equal(cut.body.length, 10)
    assert.equal(cut.truncated, true)
    assert.equal(cut.nextOffset, 10)
    const rest = (await tool('get_doc', { project: 'alpha', slug: 'architecture', maxChars: 0, offset: 10 })).json
    assert.ok(rest.body.length > 0)
    assert.equal(rest.truncated, true)
  })

  it('get_task and get_doc return bodies', async () => {
    assert.match((await tool('get_task', { project: 'alpha', slug: 'write-parser' })).json.body, /Implement the parser/)
    assert.match((await tool('get_doc', { project: 'alpha', slug: 'architecture' })).json.body, /Stack/)
  })

  it('search_docs finds standalone docs', async () => {
    const { json } = await tool('search_docs', { query: 'onboarding' })
    assert.deepEqual(json.map((d: any) => d.slug), ['standalone-guide'])
  })

  it('reports not-found as a tool error', async () => {
    const r = await tool('get_task', { project: 'alpha', slug: 'nope' })
    assert.ok(r.isError)
    assert.match(r.text, /not found/i)
  })

  it('create_task and update_task go through the HTTP API', async () => {
    api.requests.length = 0
    assert.deepEqual((await tool('create_task', { project: 'alpha', title: 'From MCP', priority: 'low' })).json, { slug: 'created-slug' })
    assert.deepEqual(api.requests.at(-1), { method: 'POST', path: '/api/tasks', body: { project: 'alpha', title: 'From MCP', priority: 'low' } })
    await tool('update_task', { project: 'alpha', slug: 'write-parser', status: 'done' })
    assert.deepEqual([api.requests.at(-1)!.method, api.requests.at(-1)!.path], ['PATCH', '/api/tasks/alpha/write-parser'])
  })

  it('append_task_note keeps the existing body and credits the author', async () => {
    await tool('append_task_note', { project: 'alpha', slug: 'write-parser', note: 'mcp note' })
    assert.match(api.requests.at(-1)!.body.description, /Implement the parser[\s\S]*_ by claude\n\nmcp note$/)
    await tool('append_task_note', { project: 'alpha', slug: 'write-parser', note: 'second', author: 'Sam' })
    assert.match(api.requests.at(-1)!.body.description, /_ by Sam\n\nsecond$/)
  })

  it('lists the archive, update, and delete tools added for CLI parity', async () => {
    const names = (await rpc('tools/list')).result.tools.map((t: any) => t.name)
    for (const name of ['update_project', 'archive_project', 'unarchive_project', 'delete_project', 'archive_task', 'unarchive_task', 'archive_doc', 'unarchive_doc']) {
      assert.ok(names.includes(name), name)
    }
  })

  it('update_project patches fields, including null to clear', async () => {
    await tool('update_project', { slug: 'alpha', title: 'Alpha 2', repo: null, tags: ['x'] })
    const w = api.requests.at(-1)!
    assert.deepEqual([w.method, w.path, w.body], ['PATCH', '/api/projects/alpha', { title: 'Alpha 2', repo: null, tags: ['x'] }])
  })

  it('archives and restores projects, tasks, and docs', async () => {
    await tool('archive_project', { slug: 'beta' })
    assert.deepEqual([api.requests.at(-1)!.path, typeof api.requests.at(-1)!.body.archivedAt], ['/api/projects/beta', 'string'])
    await tool('unarchive_project', { slug: 'beta' })
    assert.deepEqual(api.requests.at(-1)!.body, { archivedAt: null })

    await tool('archive_task', { project: 'alpha', slug: 'write-parser' })
    assert.deepEqual([api.requests.at(-1)!.path, typeof api.requests.at(-1)!.body.archivedAt], ['/api/tasks/alpha/write-parser', 'string'])
    await tool('unarchive_task', { project: 'alpha', slug: 'old-idea' })
    assert.deepEqual(api.requests.at(-1)!.body, { archivedAt: null })

    await tool('archive_doc', { project: 'alpha', slug: 'architecture' })
    assert.equal(api.requests.at(-1)!.path, '/api/docs/alpha/architecture')
    await tool('unarchive_doc', { slug: 'standalone-guide' })
    assert.deepEqual([api.requests.at(-1)!.path, api.requests.at(-1)!.body], ['/api/standalone-docs/standalone-guide', { archivedAt: null }])
  })

  it('delete_project and standalone delete_doc hit the right routes', async () => {
    await tool('delete_project', { slug: 'gamma' })
    assert.deepEqual([api.requests.at(-1)!.method, api.requests.at(-1)!.path], ['DELETE', '/api/projects/gamma'])
    await tool('delete_doc', { slug: 'standalone-guide' })
    assert.deepEqual([api.requests.at(-1)!.method, api.requests.at(-1)!.path], ['DELETE', '/api/standalone-docs/standalone-guide'])
  })

  it('has no link tools or link fields; projects take a repo URL', async () => {
    const tools = (await rpc('tools/list')).result.tools
    const byName = Object.fromEntries(tools.map((t: any) => [t.name, t]))
    for (const name of ['add_link', 'remove_link', 'resolve_link']) assert.ok(!byName[name], name)
    for (const name of ['create_task', 'update_task', 'create_project', 'update_project']) {
      const props = byName[name].inputSchema.properties
      assert.ok(!props.links && !props.githubPRs && !props.githubIssues && !props.githubRepo, `${name} has no link fields`)
    }
    assert.ok(byName.create_project.inputSchema.properties.repo && byName.update_project.inputSchema.properties.repo)
    assert.ok(!byName.list_tasks.inputSchema.properties.linked)
    api.requests.length = 0
    await tool('create_project', { title: 'R', repo: 'https://github.com/acme/r' })
    assert.equal(api.requests.find(r => r.method === 'POST')!.body.repo, 'https://github.com/acme/r')
  })

  it('batch_tasks resolves refs and sends one request; update_task credits note authors', async () => {
    api.requests.length = 0
    const batch = await tool('batch_tasks', { project: 'alpha', ops: [{ op: 'update', ref: 'write-parser', status: 'done', note: 'finished' }] })
    assert.equal(batch.isError, false)
    assert.equal(batch.json.ok, 1)
    const batches = api.requests.filter(r => r.path === '/api/tasks/batch')
    assert.equal(batches.length, 1)
    assert.deepEqual(batches[0]!.body.ops, [{ op: 'update', project: 'alpha', slug: 'write-parser', status: 'done', note: 'finished', noteAuthor: 'claude' }])
    await tool('update_task', { project: 'alpha', slug: 'write-parser', status: 'done', note: 'n' })
    assert.deepEqual(api.requests.at(-1)!.body, { status: 'done', note: 'n', noteAuthor: 'claude' })
  })

  it('start_task creates an unknown task directly in-progress', async () => {
    api.requests.length = 0
    await tool('start_task', { project: 'alpha', title: 'Brand new thing' })
    assert.deepEqual(api.requests.filter(r => r.method === 'POST').map(r => r.body), [{ project: 'alpha', title: 'Brand new thing', status: 'in-progress' }])
  })

  it('async writes return the id at once and the write follows; create pins the predicted slug', async () => {
    api.requests.length = 0
    const upd = await tool('update_task', { project: 'alpha', slug: 'write-parser', status: 'done', async: true })
    assert.deepEqual(upd.json, { queued: true, id: 'alpha/write-parser' })
    const created = await tool('create_task', { project: 'alpha', title: 'Write parser', async: true })
    assert.deepEqual(created.json, { queued: true, id: 'alpha/write-parser-2' })
    const start = await tool('start_task', { project: 'alpha', title: 'write-parser', async: true })
    assert.deepEqual(start.json, { queued: true, id: 'alpha/write-parser', status: 'in-progress' })
    await new Promise(r => setTimeout(r, 300))
    assert.deepEqual(api.requests.filter(r => r.method === 'PATCH').map(r => r.body).slice(0, 1), [{ status: 'done' }])
    assert.equal(api.requests.find(r => r.method === 'POST')!.body.slug, 'write-parser-2')
    const missing = await tool('update_task', { project: 'alpha', slug: 'nope', status: 'done', async: true })
    assert.ok(missing.isError, 'an unknown task fails at once, even when async')
  })
})
