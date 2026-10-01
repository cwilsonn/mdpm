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
})
