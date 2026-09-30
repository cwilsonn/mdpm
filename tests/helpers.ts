import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
export const FIXTURE_CONTENT = join(REPO, 'tests/fixtures/content')
export const FAKE_SERVER = `node ${join(REPO, 'tests/fixtures/fake-server.mjs')}`

export interface CliResult {
  code: number
  stdout: string
  stderr: string
  json: any
}

export interface CliOptions {
  env?: Record<string, string | undefined>
  cwd?: string
  input?: string
}

// A scratch dir per test file: pid records, logs, and a cwd that is not a git repo.
export function scratchDir() {
  const dir = mkdtempSync(join(tmpdir(), 'mdpm-test-'))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

// Environment that can't see the developer's real setup: no MDPM_* leakage, no config file,
// fixture content, and state (pid files) in a scratch dir.
export function isolatedEnv(scratch: string, extra: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith('MDPM_')) delete env[key]
  return {
    ...env,
    MDPM_CONTENT_PATH: FIXTURE_CONTENT,
    MDPM_CONFIG: join(scratch, 'no-such-config.json'),
    MDPM_STATE_DIR: join(scratch, 'state'),
    // Unroutable on purpose: a test that forgets to point at a server fails fast with exit 3.
    MDPM_BASE_URL: 'http://127.0.0.1:1',
    NO_COLOR: '1',
    ...extra,
  }
}

// Async on purpose: the mock API server lives in this process and must keep serving while the CLI runs.
export function runCli(args: string[], opts: CliOptions & { scratch: string }): Promise<CliResult> {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [join(REPO, 'bin/mdpm.mjs'), ...args],
      { cwd: opts.cwd ?? opts.scratch, env: isolatedEnv(opts.scratch, opts.env), encoding: 'utf8', timeout: 60_000 },
      (error, stdout, stderr) => {
        let json: any
        try { json = JSON.parse(stdout) }
        catch {}
        resolve({ code: typeof error?.code === 'number' ? error.code : error ? 1 : 0, stdout, stderr, json })
      },
    )
    if (opts.input !== undefined) child.stdin?.end(opts.input)
  })
}

export interface RecordedRequest {
  method: string
  path: string
  body: any
}

// Minimal stand-in for the Nuxt API: records requests and answers with canned JSON.
export async function mockApi(respond: (req: RecordedRequest) => { status?: number; body?: unknown } = () => ({})) {
  const requests: RecordedRequest[] = []
  const server: Server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const raw = Buffer.concat(chunks).toString('utf8')
    const recorded = { method: req.method!, path: req.url!, body: raw ? JSON.parse(raw) : undefined }
    requests.push(recorded)
    const { status = 200, body = req.method === 'POST' ? { slug: 'created-slug' } : { ok: true } } = respond(recorded)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

export async function freePort() {
  const server = createNetServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise(resolve => server.close(resolve))
  return port
}
