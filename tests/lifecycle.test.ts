import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, afterEach, describe, it } from 'node:test'
import { FAKE_SERVER, freePort, runCli, scratchContent, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

// Every call runs the real CLI, but `MDPM_SERVER_COMMAND` swaps `pnpm dev` for a tiny fake server.
async function setup() {
  const port = await freePort()
  const env = { MDPM_SERVER_COMMAND: FAKE_SERVER, MDPM_BASE_URL: `http://127.0.0.1:${port}` }
  const cli = (args: string[], extra: Record<string, string> = {}) => runCli(args, { scratch: scratch.dir, env: { ...env, ...extra } })
  return { port, cli }
}

let cleanupStop: (() => Promise<unknown>) | undefined
afterEach(async () => { await cleanupStop?.(); cleanupStop = undefined })

describe('lifecycle', () => {
  it('status reports down with exit 1', async () => {
    const { cli } = await setup()
    const r = await cli(['status', '--json'])
    assert.equal(r.code, 1)
    assert.deepEqual([r.json.state, r.json.running], ['stopped', false])
  })

  it('stop when down is a no-op', async () => {
    const { cli } = await setup()
    const r = await cli(['stop', '--json'])
    assert.equal(r.code, 0)
    assert.equal(r.json.action, 'not-running')
  })

  it('start, start again, status, stop', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop'])

    const first = await cli(['start', '--json'])
    assert.equal(first.code, 0, first.stderr)
    assert.equal(first.json.action, 'started')
    assert.ok(first.json.pid > 0)

    const again = await cli(['start', '--json'])
    assert.equal(again.json.action, 'already-running')
    assert.equal(again.json.pid, first.json.pid)

    const status = await cli(['status', '--json'])
    assert.equal(status.code, 0)
    assert.deepEqual([status.json.state, status.json.managed, status.json.pid], ['running', true, first.json.pid])

    const stopped = await cli(['stop', '--json'])
    assert.equal(stopped.json.action, 'stopped')
    assert.equal((await cli(['status'])).code, 1)
  })

  it('restart brings up a new process', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop'])
    const first = (await cli(['start', '--json'])).json
    const restarted = await cli(['restart', '--json'])
    assert.equal(restarted.code, 0, restarted.stderr)
    assert.equal(restarted.json.action, 'started')
    assert.notEqual(restarted.json.pid, first.pid)
  })

  it('clears a stale pid file', async () => {
    const { port, cli } = await setup()
    const state = join(scratch.dir, 'state')
    mkdirSync(state, { recursive: true })
    const record = join(state, `server-${port}.json`)
    writeFileSync(record, JSON.stringify({ pid: 999999, port, startedAt: new Date().toISOString() }))
    const r = await cli(['status', '--json'])
    assert.equal(r.json.state, 'stopped')
    assert.equal(r.json.pid, undefined)
    const { existsSync } = await import('node:fs')
    assert.equal(existsSync(record), false)
  })

  it('reports a failed launch instead of hanging', async () => {
    const { cli } = await setup()
    const r = await cli(['start', '--timeout', '10'], { MDPM_SERVER_COMMAND: 'node -e process.exit(1) --' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /exited during startup/)
  })

  it('rejects an invalid --port', async () => {
    const { cli } = await setup()
    assert.equal((await cli(['start', '--port', 'abc'])).code, 2)
  })
})

describe('content root handoff', () => {
  it('start passes the CLI\'s resolved content path to the server', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop'])
    await cli(['start'])
    const r = await cli(['ping', '--json'])
    assert.equal(r.json.serverUp, true)
    assert.equal(r.json.serverContentPath, scratchContent(scratch.dir))
    assert.equal(r.json.contentMismatch, false)
  })

  it('--content-path flows through to the server', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop', '--content-path', join(scratch.dir, 'other')])
    const other = join(scratch.dir, 'other')
    mkdirSync(other, { recursive: true })
    await cli(['start', '--content-path', other])
    const r = await cli(['ping', '--content-path', other, '--json'])
    assert.equal(r.json.serverContentPath, other)
    assert.equal(r.json.contentMismatch, false)
  })

  it('a server on a different root is flagged by ping; writes go to the CLI\'s own files regardless', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop'])
    const other = join(scratch.dir, 'elsewhere')
    mkdirSync(other, { recursive: true })
    await cli(['start', '--content-path', other])
    const ping = await cli(['ping', '--json'])
    assert.equal(ping.json.contentMismatch, true)
    const write = await cli(['task', 'done', 'parser', '--project', 'alpha'])
    assert.equal(write.code, 0, write.stderr)
  })
})

describe('host handoff', () => {
  const healthOf = async (port: number) => (await fetch(`http://127.0.0.1:${port}/api/health`)).json() as Promise<{ host?: string }>

  it('start binds the hostname from the base URL (localhost needs no hosts entry)', async () => {
    const { port, cli } = await setup()
    cleanupStop = () => cli(['stop'], { MDPM_BASE_URL: `http://localhost:${port}` })
    const r = await cli(['start', '--json'], { MDPM_BASE_URL: `http://localhost:${port}` })
    assert.equal(r.code, 0, r.stderr)
    assert.equal((await healthOf(port)).host, 'localhost')
  })

  it('passes whatever hostname the base URL names, including the mdpm.local default', async () => {
    const { port, cli } = await setup()
    cleanupStop = () => cli(['stop'])
    await cli(['start'])
    assert.equal((await healthOf(port)).host, '127.0.0.1')
  })

  it('fails fast with a fix when the hostname does not resolve, without starting anything', async () => {
    const { port, cli } = await setup()
    const env = { MDPM_BASE_URL: `http://no-such-host.invalid:${port}` }
    const r = await cli(['start'], env)
    assert.equal(r.code, 1)
    assert.match(r.stderr, /cannot resolve "no-such-host\.invalid"/)
    assert.match(r.stderr, /hosts file/)
    assert.match(r.stderr, /http:\/\/localhost:3333/)
    assert.equal((await cli(['status'], env)).code, 1, 'nothing was started')
  })
})

describe('writes without a server', () => {
  const writeArgs = ['task', 'done', 'parser', '--project', 'alpha']

  // The removed lifecycle flags still appear in CLAUDE.md blocks of other repos; they must stay harmless.
  it('a write with the server down succeeds and starts nothing, even with the removed lifecycle flags', async () => {
    const { cli } = await setup()
    assert.equal((await cli(writeArgs)).code, 0)
    for (const flag of ['--auto-start', '--no-auto-start', '--keep-running', '--async']) {
      const r = await cli([...writeArgs, flag])
      assert.equal(r.code, 0, `${flag}: ${r.stderr}`)
      assert.doesNotMatch(r.stdout + r.stderr, /starting it|queued/)
    }
    assert.equal((await cli(['status'])).code, 1)
  })
})
