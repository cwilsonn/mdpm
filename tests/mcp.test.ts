import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { isolatedEnv, readContent, REPO, scratchDir } from './helpers'

// Drives the real MCP server over stdio, so reads and writes (both on the files, no server) are checked
// through the shared core, exactly as Claude Code would call them. Content is a scratch copy of the fixtures.
const scratch = scratchDir()
after(scratch.cleanup)

const task = (slug: string) => readContent(scratch.dir, `projects/alpha/tasks/${slug}.md`)
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
  child = spawn('node', ['--import', 'tsx', join(REPO, 'mcp/index.ts')], {
    cwd: REPO,
    env: isolatedEnv(scratch.dir) as NodeJS.ProcessEnv,
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

after(() => {
  child.kill()
})

describe('MCP server through core', () => {
  it('advertises the package version, not a hardcoded one', () => {
    const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'))
    assert.deepEqual(serverInfo, { name: 'mdpm', version: pkg.version })
  })

  it('lists exactly its twelve tools', async () => {
    const names = (await rpc('tools/list')).result.tools.map((t: any) => t.name).sort()
    assert.deepEqual(names, ['batch_tasks', 'create_task', 'get_doc', 'get_project', 'get_task', 'list_docs', 'list_projects', 'list_tasks', 'pickup', 'start_task', 'update_task', 'upsert_doc'])
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

  it('list_tasks with a query searches and adds a match column instead of bodies', async () => {
    const { text } = await tool('list_tasks', { query: 'parser', project: 'alpha' })
    assert.match(text.split('\n')[1]!, /\bmatch\b/)
    assert.match(text, /write-parser/)
    assert.doesNotMatch(text, /ship-v1/)
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

  it('list_docs with a query finds standalone docs', async () => {
    const { text } = await tool('list_docs', { query: 'onboarding' })
    assert.match(text, /^# total=1 /)
    assert.match(text, /standalone-guide/)
  })

  it('reports not-found as a tool error', async () => {
    const r = await tool('get_task', { project: 'alpha', slug: 'nope' })
    assert.ok(r.isError)
    assert.match(r.text, /not found/i)
  })

  it('create_task and update_task write the files, with no server', async () => {
    assert.deepEqual((await tool('create_task', { project: 'alpha', title: 'From MCP', priority: 'low' })).json, { slug: 'from-mcp', id: 'alpha/from-mcp', status: 'todo' })
    assert.equal(task('from-mcp')!.data.priority, 'low')
    assert.deepEqual((await tool('update_task', { project: 'alpha', slug: 'write-parser', status: 'done' })).json, { ok: true, id: 'alpha/write-parser', status: 'done' })
    assert.equal(task('write-parser')!.data.status, 'done')
  })

  it('update_task archives and restores, and appends a credited note', async () => {
    await tool('update_task', { project: 'alpha', slug: 'write-parser', archived: true })
    assert.equal(typeof task('write-parser')!.data.archivedAt, 'string')
    await tool('update_task', { project: 'alpha', slug: 'old-idea', archived: false })
    assert.equal(task('old-idea')!.data.archivedAt, undefined)
    await tool('update_task', { project: 'alpha', slug: 'write-parser', note: 'second', noteAuthor: 'Sam' })
    assert.match(task('write-parser')!.body, /\*\*Note\*\* _\([^)]+\)_ by Sam\n\nsecond$/)
  })

  it('has no project-write, delete, link or ping tools', async () => {
    const tools = (await rpc('tools/list')).result.tools
    const byName = Object.fromEntries(tools.map((t: any) => [t.name, t]))
    for (const name of ['ping', 'create_project', 'update_project', 'delete_task', 'delete_doc', 'archive_task', 'append_task_note', 'search_tasks', 'search_docs', 'add_link']) assert.ok(!byName[name], name)
    for (const name of ['create_task', 'update_task']) {
      const props = byName[name].inputSchema.properties
      assert.ok(!props.links && !props.githubPRs && !props.githubIssues, `${name} has no link fields`)
    }
  })

  it('batch_tasks resolves refs and writes them; update_task credits note authors', async () => {
    const batch = await tool('batch_tasks', { project: 'alpha', ops: [{ op: 'update', ref: 'write-tests', status: 'done', note: 'finished' }] })
    assert.equal(batch.isError, false)
    assert.deepEqual(batch.json, { ok: 1, failed: 0, results: [{ index: 0, ok: true, id: 'alpha/write-tests', status: 'done' }] })
    assert.equal(task('write-tests')!.data.status, 'done')
    assert.match(task('write-tests')!.body, /by claude\n\nfinished$/)
    await tool('update_task', { project: 'alpha', slug: 'write-tests', note: 'n' })
    assert.match(task('write-tests')!.body, /by claude\n\nn$/)
  })

  it('start_task creates an unknown task directly in-progress', async () => {
    const r = await tool('start_task', { project: 'alpha', title: 'Brand new thing' })
    assert.deepEqual(r.json, { id: 'alpha/brand-new-thing', slug: 'brand-new-thing', status: 'in-progress', created: true })
    assert.equal(task('brand-new-thing')!.data.status, 'in-progress')
  })

  it('async writes return the id at once and the write follows; create pins the predicted slug', async () => {
    const upd = await tool('update_task', { project: 'alpha', slug: 'ship-v1', status: 'blocked', async: true })
    assert.deepEqual(upd.json, { queued: true, id: 'alpha/ship-v1' })
    const created = await tool('create_task', { project: 'alpha', title: 'Write parser', async: true })
    assert.deepEqual(created.json, { queued: true, id: 'alpha/write-parser-2' })
    await new Promise(r => setTimeout(r, 300))
    assert.equal(task('ship-v1')!.data.status, 'blocked')
    assert.equal(task('write-parser-2')!.data.title, 'Write parser')
    const missing = await tool('update_task', { project: 'alpha', slug: 'nope', status: 'done', async: true })
    assert.ok(missing.isError, 'an unknown task fails at once, even when async')
  })
})
