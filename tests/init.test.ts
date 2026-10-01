import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { inferProject, parseMarker, renderWorkLogging, upsertWorkLoggingBlock } from '../lib/core'
import { mockApi, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

let n = 0
function makeRepo(name: string, remote?: string) {
  const dir = join(scratch.dir, `${name}-${n++}`, name)
  mkdirSync(dir, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: dir })
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: dir })
  return dir
}
const read = (...p: string[]) => readFileSync(join(...p), 'utf8')
const excludes = (dir: string) => read(dir, '.git/info/exclude').split('\n')

describe('work-logging block', () => {
  const block = renderWorkLogging('demo')

  it('fills in the project slug', () => {
    assert.ok(block.includes('`demo`'))
    assert.ok(!block.includes('{{project}}'))
  })

  it('creates, appends, updates in place, and is idempotent', () => {
    assert.equal(upsertWorkLoggingBlock(undefined, block).action, 'created')

    const appended = upsertWorkLoggingBlock('# My repo\n\nSome rules.\n', block)
    assert.equal(appended.action, 'appended')
    assert.ok(appended.content.startsWith('# My repo\n\nSome rules.\n\n<!-- mdpm:work-logging:start -->'))

    assert.equal(upsertWorkLoggingBlock(appended.content, block).action, 'unchanged')

    const edited = appended.content.replace('find or create its task', 'DO SOMETHING ELSE')
    const updated = upsertWorkLoggingBlock(`${edited}\n## After\n\nkeep me\n`, block)
    assert.equal(updated.action, 'updated')
    assert.ok(!updated.content.includes('DO SOMETHING ELSE'))
    assert.ok(updated.content.includes('# My repo') && updated.content.endsWith('## After\n\nkeep me\n'), 'content outside the markers is preserved')
  })

  it('refuses unbalanced markers instead of duplicating the block', () => {
    assert.throws(() => upsertWorkLoggingBlock('<!-- mdpm:work-logging:start -->\nhalf', block), /unbalanced/)
  })
})

describe('.mdpm marker', () => {
  it('parses `project: slug`, a bare slug, comments, and ignores garbage', () => {
    assert.equal(parseMarker('project: alpha\n'), 'alpha')
    assert.equal(parseMarker('# comment\n\n  project :  beta  # trailing\n'), 'beta')
    assert.equal(parseMarker('gamma\n'), 'gamma')
    assert.equal(parseMarker('not a slug here\n'), undefined)
    assert.equal(parseMarker(''), undefined)
  })

  it('wins over the remote and the directory name, and is found from a subdirectory', () => {
    const repo = makeRepo('whatever', 'git@gitlab.corp.example:other/thing.git')
    writeFileSync(join(repo, '.mdpm'), 'project: beta\n')
    mkdirSync(join(repo, 'src/deep'), { recursive: true })
    const projects = [{ slug: 'alpha', githubRepo: 'other/thing' }, { slug: 'beta', githubRepo: null }]
    assert.deepEqual(inferProject(join(repo, 'src/deep'), projects), { slug: 'beta', via: 'marker', detail: '.mdpm' })
  })

  it('is ignored when it names an unknown project', () => {
    const repo = makeRepo('alpha')
    writeFileSync(join(repo, '.mdpm'), 'project: ghost\n')
    assert.equal(inferProject(repo, [{ slug: 'alpha', githubRepo: null }])?.via, 'directory-name')
  })
})

describe('mdpm init', () => {
  let api: Awaited<ReturnType<typeof mockApi>>
  before(async () => { api = await mockApi() })
  after(() => api.close())
  beforeEach(() => { api.requests.length = 0 })

  const init = (cwd: string, args: string[] = []) => runCli(['init', '--json', ...args], { scratch: scratch.dir, cwd, env: { MDPM_BASE_URL: api.url } })
  const writes = () => api.requests.filter(r => r.method !== 'GET')

  it('creates a project for a GitHub repo, records githubRepo, and installs the block', async () => {
    const repo = makeRepo('newthing', 'git@github.com:acme/newthing.git')
    const r = await init(repo, ['--title', 'New Thing'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual([r.json.project, r.json.created], ['created-slug', true])
    assert.deepEqual(writes().map(w => [w.method, w.path, w.body]), [['POST', '/api/projects', { title: 'New Thing', githubRepo: 'acme/newthing' }]])
    assert.ok(read(repo, 'CLAUDE.md').includes('project `created-slug`'))
    assert.ok(!existsSync(join(repo, '.mdpm')), 'the remote already finds the project, so no marker')
  })

  it('omits githubRepo for non-GitHub remotes and pins the repo with an excluded marker', async () => {
    const repo = makeRepo('widgets', 'git@gitlab.corp.example:acme/widgets.git')
    const r = await init(repo)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(writes()[0]!.body, { title: 'widgets' })
    assert.match(read(repo, '.mdpm'), /^project: created-slug$/m)
    assert.ok(excludes(repo).includes('.mdpm'))
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' })
    assert.doesNotMatch(status, /\.mdpm/, 'the marker must not show up as an untracked file')
  })

  it('finds an existing project through a non-GitHub remote and creates nothing', async () => {
    const repo = makeRepo('checkout', 'git@gitlab.corp.example:test/alpha.git')
    const r = await init(repo)
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual([r.json.project, r.json.created], ['alpha', false])
    assert.equal(writes().length, 0)
    assert.ok(!existsSync(join(repo, '.mdpm')))
  })

  it('--project links an existing project and re-running changes nothing', async () => {
    const repo = makeRepo('anything')
    const first = await init(repo, ['--project', 'alpha'])
    assert.equal(first.code, 0, first.stderr)
    assert.ok(existsSync(join(repo, '.mdpm')), 'nothing else would find it, so the marker is written')
    const before = [read(repo, 'CLAUDE.md'), read(repo, '.mdpm')]
    const second = await init(repo, ['--project', 'alpha'])
    assert.deepEqual(second.json.steps.map((s: any) => s.action), ['linked', 'skipped', 'unchanged'])
    assert.deepEqual([read(repo, 'CLAUDE.md'), read(repo, '.mdpm')], before)
    assert.equal(writes().length, 0)
  })

  it('keeps existing CLAUDE.md content and refreshes only the marked block', async () => {
    const repo = makeRepo('keeper')
    writeFileSync(join(repo, 'CLAUDE.md'), '# Rules\n\nBe nice.\n')
    await init(repo, ['--project', 'alpha'])
    const installed = read(repo, 'CLAUDE.md')
    assert.ok(installed.startsWith('# Rules\n\nBe nice.\n\n'))
    writeFileSync(join(repo, 'CLAUDE.md'), installed.replace('find or create its task', 'STALE TEXT'))
    const r = await init(repo, ['--project', 'alpha'])
    assert.equal(r.json.steps.find((s: any) => s.step === 'claude-md').action, 'updated')
    assert.equal(read(repo, 'CLAUDE.md'), installed)
  })

  it('--local writes CLAUDE.local.md, excluded from git, and leaves CLAUDE.md alone', async () => {
    const repo = makeRepo('localfile')
    writeFileSync(join(repo, 'CLAUDE.md'), 'shared\n')
    await init(repo, ['--project', 'alpha', '--local'])
    assert.equal(read(repo, 'CLAUDE.md'), 'shared\n')
    assert.ok(read(repo, 'CLAUDE.local.md').includes('mdpm:work-logging:start'))
    assert.ok(excludes(repo).includes('CLAUDE.local.md'))
  })

  it('--no-claude-md and --no-marker skip those steps', async () => {
    const repo = makeRepo('minimal')
    const r = await init(repo, ['--project', 'alpha', '--no-claude-md', '--no-marker'])
    assert.equal(r.code, 0, r.stderr)
    assert.ok(!existsSync(join(repo, 'CLAUDE.md')) && !existsSync(join(repo, '.mdpm')))
  })

  it('--dry-run reports the plan and writes and sends nothing', async () => {
    const repo = makeRepo('dryrun', 'git@gitlab.corp.example:acme/dryrun.git')
    const r = await init(repo, ['--dry-run'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json.steps.map((s: any) => s.action), ['would-create', 'would-write', 'would-create'])
    assert.equal(api.requests.length, 0)
    assert.ok(!existsSync(join(repo, 'CLAUDE.md')) && !existsSync(join(repo, '.mdpm')))
  })

  it('rejects an unknown --project with exit 4', async () => {
    const r = await init(makeRepo('nope'), ['--project', 'ghost'])
    assert.equal(r.code, 4)
  })

  it('then makes the repo resolve to its project from any subdirectory', async () => {
    const repo = makeRepo('resolves')
    await init(repo, ['--project', 'beta'])
    mkdirSync(join(repo, 'packages/x'), { recursive: true })
    const r = await runCli(['config', 'show', '--json'], { scratch: scratch.dir, cwd: join(repo, 'packages/x') })
    assert.deepEqual([r.json.project.slug, r.json.project.via], ['beta', 'marker'])
  })
})
