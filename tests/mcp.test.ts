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
  return { isError: !!res.result.isError, text, json: res.result.isError ? undefined : JSON.parse(text) }
}

before(async () => {
  api = await mockApi()
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
    const { json } = await tool('list_tasks', { project: 'alpha', status: ['blocked'] })
    assert.deepEqual(json.map((t: any) => t.slug), ['fix-login-bug'])
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
    await tool('update_project', { slug: 'alpha', title: 'Alpha 2', githubRepo: null, tags: ['x'] })
    const w = api.requests.at(-1)!
    assert.deepEqual([w.method, w.path, w.body], ['PATCH', '/api/projects/alpha', { title: 'Alpha 2', githubRepo: null, tags: ['x'] }])
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

  it('advertises link tools and a links field on create/update', async () => {
    const tools = (await rpc('tools/list')).result.tools
    const byName = Object.fromEntries(tools.map((t: any) => [t.name, t]))
    for (const name of ['add_link', 'remove_link', 'resolve_link']) assert.ok(byName[name], name)
    for (const name of ['create_task', 'update_task', 'create_project', 'update_project']) assert.ok(byName[name].inputSchema.properties.links, `${name} has links`)
    assert.match(byName.create_task.inputSchema.properties.githubPRs.description, /Deprecated: use add_link/)
    assert.ok(byName.list_tasks.inputSchema.properties.linked)
  })

  it('resolve_link understands a URL, expands a short ref from the project repo, and writes nothing', async () => {
    api.requests.length = 0
    const url = await tool('resolve_link', { input: 'https://gitlab.com/g/p/-/merge_requests/9' })
    assert.deepEqual([url.json.link.ref, url.json.view.noun], ['g/p!9', 'Merge request'])
    // alpha's repo (test/alpha) is still a legacy githubRepo field: it reads as a repo link
    const short = await tool('resolve_link', { input: '#7', project: 'alpha', kind: 'issue' })
    assert.equal(short.json.link.url, 'https://github.com/test/alpha/issues/7')
    const amb = await tool('resolve_link', { input: '#7', project: 'alpha' })
    assert.ok(amb.isError)
    assert.match(amb.text, /github\.change or github\.issue/)
    assert.equal(api.requests.filter(r => r.method !== 'GET' && r.path !== '/api/health').length, 0)
  })

  it('add_link PATCHes the item with its existing links plus the new one; a duplicate sends nothing', async () => {
    api.requests.length = 0
    const added = await tool('add_link', { type: 'task', project: 'alpha', slug: 'write-parser', input: 'https://github.com/test/alpha/pull/3' })
    assert.equal(added.json.added, true)
    const w = api.requests.find(r => r.method === 'PATCH')!
    assert.equal(w.path, '/api/tasks/alpha/write-parser')
    assert.deepEqual(w.body.links, [{ url: 'https://github.com/test/alpha/pull/3', provider: 'github', kind: 'change', ref: 'test/alpha#3' }])
    api.requests.length = 0
    const project = await tool('add_link', { type: 'project', slug: 'beta', input: 'https://example.com/board', title: 'Board' })
    assert.deepEqual([project.json.added, api.requests.find(r => r.method === 'PATCH')!.path], [true, '/api/projects/beta'])
    const doc = await tool('add_link', { type: 'doc', slug: 'standalone-guide', input: 'https://example.com/g' })
    assert.equal(api.requests.find(r => r.path === '/api/standalone-docs/standalone-guide')!.method, 'PATCH')
    assert.equal(doc.json.target, 'standalone-guide')
  })

  it('add_link and remove_link report problems as tool errors, writing nothing', async () => {
    api.requests.length = 0
    for (const args of [
      { type: 'task', project: 'alpha', slug: 'write-parser', input: '#3' },
      { type: 'task', project: 'alpha', slug: 'write-parser', input: 'javascript:alert(1)' },
      { type: 'task', slug: 'write-parser', input: 'https://example.com/x' },
    ]) assert.ok((await tool('add_link', args)).isError, JSON.stringify(args))
    const missing = await tool('remove_link', { type: 'task', project: 'alpha', slug: 'write-parser', link: 'nope' })
    assert.ok(missing.isError)
    assert.match(missing.text, /No link on alpha\/write-parser matches 'nope'/)
    assert.equal(api.requests.filter(r => r.method === 'PATCH').length, 0)
  })

  it('list_tasks accepts linked, and rejects a bad one', async () => {
    assert.deepEqual((await tool('list_tasks', { project: 'alpha', linked: 'github' })).json, [])
    const bad = await tool('list_tasks', { project: 'alpha', linked: 'github:nope' })
    assert.ok(bad.isError)
    assert.match(bad.text, /kind must be one of/)
  })

  it('create_task passes links through and returns the server notices', async () => {
    api.requests.length = 0
    await tool('create_task', { project: 'alpha', title: 'L', links: [{ url: 'https://example.com/x' }], githubPRs: [4] })
    const w = api.requests.find(r => r.method === 'POST')!
    assert.deepEqual([w.body.links, w.body.githubPRs], [[{ url: 'https://example.com/x' }], [4]])
  })
})
