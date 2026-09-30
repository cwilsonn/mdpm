import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, afterEach, describe, it } from 'node:test'
import { FAKE_SERVER, FIXTURE_CONTENT, freePort, runCli, scratchDir } from './helpers'

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
  it('status reports down with exit 3', async () => {
    const { cli } = await setup()
    const r = await cli(['status', '--json'])
    assert.equal(r.code, 3)
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
    assert.equal((await cli(['status'])).code, 3)
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
    assert.equal(r.json.serverContentPath, FIXTURE_CONTENT)
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

  it('a server on a different root is flagged by ping and blocks writes', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop'])
    const other = join(scratch.dir, 'elsewhere')
    mkdirSync(other, { recursive: true })
    await cli(['start', '--content-path', other])
    const ping = await cli(['ping', '--json'])
    assert.equal(ping.json.contentMismatch, true)
    const write = await cli(['task', 'done', 'parser', '--project', 'alpha'])
    assert.equal(write.code, 1)
    assert.match(write.stderr, /uses content directory/)
  })
})

describe('auto-start', () => {
  const writeArgs = ['task', 'done', 'parser', '--project', 'alpha']

  it('without the flag, a down server is exit 3 and nothing is started', async () => {
    const { cli } = await setup()
    assert.equal((await cli(writeArgs)).code, 3)
    assert.equal((await cli(['status'])).code, 3)
  })

  it('starts the server, writes, then stops it again', async () => {
    const { cli } = await setup()
    const r = await cli([...writeArgs, '--auto-start'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stderr, /starting it/)
    assert.match(r.stderr, /stopped the server this command started/)
    assert.equal((await cli(['status'])).code, 3)
  })

  it('--keep-running leaves the server up', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop'])
    assert.equal((await cli([...writeArgs, '--auto-start', '--keep-running'])).code, 0)
    assert.equal((await cli(['status'])).code, 0)
  })

  it('never stops a server that was already running', async () => {
    const { cli } = await setup()
    cleanupStop = () => cli(['stop'])
    await cli(['start'])
    const r = await cli([...writeArgs, '--auto-start'])
    assert.equal(r.code, 0)
    assert.doesNotMatch(r.stderr, /stopped the server/)
    assert.equal((await cli(['status'])).code, 0)
  })

  it('MDPM_AUTO_START turns it on, --no-auto-start turns it off', async () => {
    const { cli } = await setup()
    assert.equal((await cli(writeArgs, { MDPM_AUTO_START: '1' })).code, 0)
    assert.equal((await cli([...writeArgs, '--no-auto-start'], { MDPM_AUTO_START: '1' })).code, 3)
  })

  it('stops the server it started even when the write then fails', async () => {
    const { cli } = await setup()
    const r = await cli([...writeArgs, '--auto-start'], { FAKE_SERVER_STATUS: '400' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /forced failure/)
    assert.match(r.stderr, /stopped the server this command started/)
    assert.equal((await cli(['status'])).code, 3)
  })
})
