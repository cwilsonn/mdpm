import { strict as assert } from 'node:assert'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, after } from 'node:test'
import { AmbiguousError, buildPickup, createCore, inferProject, loadConfig, NotFoundError, normalizeRepoRef, samePath } from '../lib/core'
import { sessionNotesOrder, summarize } from '../lib/core/pickup'
import { FIXTURE_CONTENT, scratchDir } from './helpers'

const core = createCore({ contentPath: FIXTURE_CONTENT, baseUrl: 'http://127.0.0.1:1' })
const slugs = (items: { slug: string }[]) => items.map(i => i.slug)

describe('readers', () => {
  it('lists projects and hides archived ones by default', () => {
    assert.deepEqual(slugs(core.listProjects()).sort(), ['alpha', 'beta'])
    assert.deepEqual(slugs(core.listProjects({ includeArchived: true })).sort(), ['alpha', 'beta', 'gamma'])
  })

  it('counts tasks and docs per project', () => {
    const alpha = core.getProject('alpha')
    assert.equal(alpha.taskCount, 8)
    assert.equal(alpha.githubRepo, 'test/alpha')
  })

  it('throws NotFoundError for an unknown project', () => {
    assert.throws(() => core.getProject('nope'), NotFoundError)
  })

  it('filters tasks by status, priority, tags, assignee and archived', () => {
    const titles = (opts: Parameters<typeof core.listTasks>[0]) => slugs(core.listTasks(opts)).sort()
    assert.deepEqual(titles({ project: 'alpha', status: ['in-progress'] }), ['write-parser'])
    assert.deepEqual(titles({ project: 'alpha', priority: ['urgent'] }), ['fix-login-bug'])
    assert.deepEqual(titles({ project: 'alpha', tags: ['qa', 'docs'] }), ['write-docs', 'write-tests'])
    assert.deepEqual(titles({ project: 'alpha', assignee: 'sam' }), ['fix-login-bug'])
    assert.ok(!titles({ project: 'alpha' }).includes('old-idea'))
    assert.ok(titles({ project: 'alpha', includeArchived: true }).includes('old-idea'))
  })

  it('orders tasks by their order field', () => {
    assert.equal(core.listTasks({ project: 'alpha' })[0]!.slug, 'write-parser')
  })

  it('hides archived docs and the children of archived docs', () => {
    const visible = slugs(core.listDocs({ project: 'alpha' }))
    assert.ok(visible.includes('architecture'))
    assert.ok(!visible.includes('old-folder'))
    assert.ok(!visible.includes('old-child'))
    assert.ok(slugs(core.listDocs({ project: 'alpha', includeArchived: true })).includes('old-child'))
  })

  it('separates standalone docs from project docs', () => {
    assert.deepEqual(slugs(core.listDocs({ standalone: true })), ['standalone-guide'])
    assert.ok(slugs(core.listDocs({})).includes('standalone-guide'))
  })

  it('searches tasks and docs case-insensitively', () => {
    assert.deepEqual(slugs(core.searchTasks('PARSER', 'alpha')).sort(), ['write-parser', 'write-tests'])
    assert.deepEqual(slugs(core.searchDocs('nuxt')), ['architecture'])
  })
})

describe('ref resolution', () => {
  it('prefers an exact slug', () => {
    assert.equal(core.resolveTask('write-tests', 'alpha').slug, 'write-tests')
  })

  it('resolves a unique prefix, substring, and title fragment', () => {
    assert.equal(core.resolveTask('write-p', 'alpha').slug, 'write-parser')
    assert.equal(core.resolveTask('login', 'alpha').slug, 'fix-login-bug')
    assert.equal(core.resolveTask('the release', 'alpha').slug, 'review-release')
  })

  it('accepts project/slug without a scope', () => {
    assert.equal(core.resolveTask('beta/shared-task').project, 'beta')
  })

  it('raises AmbiguousError listing candidates', () => {
    assert.throws(() => core.resolveTask('write', 'alpha'), (err: Error) => err instanceof AmbiguousError && /write-parser/.test(err.message))
    assert.throws(() => core.resolveTask('shared-task'), AmbiguousError)
  })

  it('raises NotFoundError when nothing matches', () => {
    assert.throws(() => core.resolveTask('zzz', 'alpha'), NotFoundError)
    assert.throws(() => core.resolveProject('zzz'), NotFoundError)
  })

  it('includes archived tasks so they can be restored', () => {
    assert.equal(core.resolveTask('old-idea', 'alpha').archivedAt, '2026-07-01')
  })

  it('resolves docs by scope', () => {
    assert.equal(core.resolveDoc('arch', { project: 'alpha' }).slug, 'architecture')
    assert.equal(core.resolveDoc('standalone', { standalone: true }).slug, 'standalone-guide')
  })
})

describe('pickup', () => {
  it('orders session notes by the date and time in the slug, not raw slug order', () => {
    const doc = (slug: string) => ({ slug, createdAt: '2026-07-09', updatedAt: null }) as any
    const sorted = [doc('session-notes-2026-07-08-2206'), doc('2026-07-08-2214-session-notes'), doc('2026-06-24-session-notes')].sort(sessionNotesOrder)
    assert.deepEqual(slugs(sorted), ['2026-07-08-2214-session-notes', 'session-notes-2026-07-08-2206', '2026-06-24-session-notes'])
  })

  it('builds the briefing', () => {
    const p = buildPickup(core, 'alpha')
    assert.equal(p.openTaskCount, 6)
    assert.deepEqual(slugs(p.tasks['in-progress']), ['write-parser'])
    assert.deepEqual(slugs(p.tasks.blocked), ['fix-login-bug'])
    assert.equal(p.lastSessionNotes?.slug, '2026-07-08-2214-session-notes')
    assert.equal(p.sessionNotesCount, 3)
    assert.ok(p.docs.find(d => d.slug === 'architecture')!.highPriority)
    assert.ok(!p.docs.some(d => d.slug.includes('session-notes')))
  })

  it('suggests in-progress first, never blocked', () => {
    const focus = slugs(buildPickup(core, 'alpha').suggestedFocus)
    assert.equal(focus[0], 'write-parser')
    assert.ok(!focus.includes('fix-login-bug'))
  })

  it('summarizes the first prose line, skipping headings and keeping underscores', () => {
    assert.equal(summarize('# Title\n\nUses `MY_ENV_VAR` **now**.'), 'Uses MY_ENV_VAR now.')
    assert.equal(summarize('x'.repeat(200), 20).length, 20)
  })

  it('handles a project without session notes', () => {
    assert.equal(buildPickup(core, 'beta').lastSessionNotes, null)
  })
})

describe('config', () => {
  const scratch = scratchDir()
  after(scratch.cleanup)
  const file = join(scratch.dir, 'config.json')
  const env = (extra: Record<string, string> = {}) => ({ MDPM_CONFIG: file, ...extra })

  it('defaults to the repo checkout with no setup', () => {
    const loaded = loadConfig({ env: { MDPM_CONFIG: join(scratch.dir, 'missing.json') } })
    assert.equal(loaded.sources.contentPath, 'default')
    assert.equal(loaded.sources.baseUrl, 'default')
    assert.equal(loaded.autoStart.value, false)
  })

  it('applies flag > env > file > default', () => {
    mkdirSync(scratch.dir, { recursive: true })
    writeFileSync(file, JSON.stringify({ baseUrl: 'http://file.test:1/', contentPath: 'data', autoStart: true }))
    const fromFile = loadConfig({ env: env() })
    assert.deepEqual([fromFile.config.baseUrl, fromFile.sources.baseUrl], ['http://file.test:1', 'file'])
    assert.equal(fromFile.config.contentPath, join(scratch.dir, 'data'))
    assert.deepEqual(fromFile.autoStart, { value: true, source: 'file' })

    const fromEnv = loadConfig({ env: env({ MDPM_BASE_URL: 'http://env.test:2', MDPM_AUTO_START: '0' }) })
    assert.deepEqual([fromEnv.config.baseUrl, fromEnv.sources.baseUrl], ['http://env.test:2', 'env'])
    assert.deepEqual(fromEnv.autoStart, { value: false, source: 'env' })

    const fromFlag = loadConfig({ env: env({ MDPM_BASE_URL: 'http://env.test:2' }), flags: { baseUrl: 'http://flag.test:3', autoStart: true } })
    assert.deepEqual([fromFlag.config.baseUrl, fromFlag.sources.baseUrl], ['http://flag.test:3', 'flag'])
    assert.deepEqual(fromFlag.autoStart, { value: true, source: 'flag' })
  })

  it('rejects a broken config file loudly', () => {
    writeFileSync(file, '{oops')
    assert.throws(() => loadConfig({ env: env() }), /invalid JSON/)
    writeFileSync(file, JSON.stringify({ autoStart: 'yes' }))
    assert.throws(() => loadConfig({ env: env() }), /autoStart/)
    writeFileSync(file, JSON.stringify({ baseUrl: 5 }))
    assert.throws(() => loadConfig({ env: env() }), /baseUrl/)
  })
})

describe('project inference', () => {
  const projects = [{ slug: 'alpha', githubRepo: 'Test/Alpha' }, { slug: 'beta', githubRepo: null }]

  it('normalizes ssh, https and plain repo references', () => {
    for (const ref of ['git@github.com:test/alpha.git', 'https://github.com/test/alpha', 'https://github.com/test/alpha.git/', 'test/alpha', '  Test/Alpha  ']) {
      assert.equal(normalizeRepoRef(ref), 'test/alpha', ref)
    }
  })

  it('normalizes remotes on other hosts to the same key', () => {
    const cases: Record<string, string> = {
      'git@gitlab.corp.com:test/alpha.git': 'test/alpha',
      'git@github.acme.com:test/alpha.git': 'test/alpha',
      'https://gitlab.com/test/alpha.git': 'test/alpha',
      'https://user:token@git.corp.com:8443/test/alpha': 'test/alpha',
      'ssh://git@git.corp.com:2222/test/alpha.git': 'test/alpha',
      'https://bitbucket.org/test/alpha': 'test/alpha',
      'https://gitlab.com/group/sub/alpha.git': 'sub/alpha',
      'https://dev.azure.com/org/proj/_git/alpha': 'proj/alpha',
      'https://org@dev.azure.com/org/proj/_git/alpha': 'proj/alpha',
      'git@ssh.dev.azure.com:v3/org/proj/alpha': 'proj/alpha',
    }
    for (const [remote, expected] of Object.entries(cases)) assert.equal(normalizeRepoRef(remote), expected, remote)
  })

  it('keeps a bare name and ignores query strings', () => {
    assert.equal(normalizeRepoRef('alpha'), 'alpha')
    assert.equal(normalizeRepoRef('https://git.corp.com/test/alpha?ref=main'), 'test/alpha')
  })

  it('matches by directory name when there is no remote', () => {
    const scratch = scratchDir()
    after(scratch.cleanup)
    const dir = join(scratch.dir, 'beta')
    mkdirSync(dir)
    assert.deepEqual(inferProject(dir, projects), { slug: 'beta', via: 'directory-name', detail: 'beta' })
    assert.equal(inferProject(scratch.dir, projects), undefined)
  })
})

describe('samePath', () => {
  it('sees through symlinks and ignores missing paths', () => {
    const scratch = scratchDir()
    after(scratch.cleanup)
    const real = join(scratch.dir, 'real')
    mkdirSync(real)
    symlinkSync(real, join(scratch.dir, 'link'))
    assert.ok(samePath(real, join(scratch.dir, 'link')))
    assert.ok(!samePath(real, join(scratch.dir, 'other')))
    assert.ok(samePath('/no/such/dir', '/no/such/dir'))
  })
})
