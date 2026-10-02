import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { applyMigration, createCore, MigrationError, planMigration, readSchemaMarker, schemaStatus, SCHEMA_VERSION } from '../lib/core'
import { applyToText, FrontmatterError, migrateLegacy } from '../lib/core/migrate/legacy-links'
import { FIXTURE_CONTENT, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

const FM = (lines: string[], body = 'Body.\n') => `---\n${lines.join('\n')}\n---\n${body}`

// A content dir in the pre-links shape, covering the YAML forms real files take.
function legacyContent(root: string) {
  const put = (rel: string, text: string) => {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), text)
  }
  put('projects/acme/index.md', FM(['title: Acme', 'status: active', 'githubRepo: acme/widgets', "createdAt: '2026-01-01'"], ''))
  put('projects/acme/tasks/pr-task.md', FM(['title: PR task', 'status: todo', 'githubIssues: []', 'githubPRs:', '  - 42', "createdAt: '2026-01-02'"], 'Has a rule inside.\n\n---\n\nand more.\n'))
  put('projects/acme/tasks/both.md', FM(['title: Both', '# keep this comment byte for byte', 'due: 2026-07-01', 'githubIssues: [7, 12]', 'githubPRs: [42]', 'tags:', '  - a', 'order: 3']))
  put('projects/acme/tasks/plain.md', FM(['title: Plain', 'githubIssues: []', 'githubPRs: []']))
  put('projects/acme/tasks/none.md', FM(['title: None']))
  put('projects/acme/tasks/has-links.md', FM([
    'title: Has links', 'githubPRs:', '  - 42', 'links:',
    "  - url: 'https://github.com/acme/widgets/pull/42'", "    provider: 'github'", "    kind: 'change'", "    ref: 'acme/widgets#42'",
    "  - url: 'https://example.com/spec'", "    title: 'Spec'",
  ]))
  put('projects/norepo/index.md', FM(['title: No repo'], ''))
  put('projects/norepo/tasks/loose.md', FM(['title: Loose', 'githubIssues:', '  - 3']))
}

const snapshot = (dir: string): Record<string, string> => Object.fromEntries(
  readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => [join(e.parentPath, e.name).slice(dir.length), readFileSync(join(e.parentPath, e.name), 'utf8')]),
)

let n = 0
function fresh() {
  const root = join(scratch.dir, `content-${n++}`)
  legacyContent(root)
  return root
}

describe('migrateLegacy (pure)', () => {
  it('turns a project repo into a repo link', () => {
    const m = migrateLegacy('project', { githubRepo: 'acme/widgets' }, 'acme/widgets')
    assert.deepEqual(m.remove, ['githubRepo'])
    assert.deepEqual(m.added, [{ url: 'https://github.com/acme/widgets', provider: 'github', kind: 'repo', ref: 'acme/widgets' }])
  })

  it('turns issue and PR numbers into resolved links using the project repo', () => {
    const m = migrateLegacy('task', { githubIssues: [7], githubPRs: [42] }, 'acme/widgets')
    assert.deepEqual(m.added.map(l => [l.kind, l.ref, l.url]), [
      ['issue', 'acme/widgets#7', 'https://github.com/acme/widgets/issues/7'],
      ['change', 'acme/widgets#42', 'https://github.com/acme/widgets/pull/42'],
    ])
    assert.deepEqual(m.unresolved, [])
  })

  it('without a repo, numbers become unresolved links and are reported, never guessed', () => {
    const m = migrateLegacy('task', { githubIssues: [7] }, null)
    assert.deepEqual(m.added, [{ provider: 'github', kind: 'issue', ref: '#7' }])
    assert.match(m.unresolved[0]!, /no GitHub repo/)
  })

  it('empty legacy fields alone are not a migration', () => {
    const m = migrateLegacy('task', { githubIssues: [], githubPRs: [] }, 'acme/widgets')
    assert.deepEqual([m.remove, m.added, m.changes, m.unresolved], [[], [], [], []])
  })

  it('empty fields are dropped along with non-empty ones', () => {
    assert.deepEqual(migrateLegacy('task', { githubIssues: [], githubPRs: [4] }, 'a/b').remove.sort(), ['githubIssues', 'githubPRs'])
  })

  it('leaves values it cannot convert in place and says so', () => {
    const task = migrateLegacy('task', { githubIssues: [7, 'x'] }, 'a/b')
    assert.deepEqual([task.remove, task.added], [[], []])
    assert.match(task.unresolved[0]!, /not positive integers/)
    const project = migrateLegacy('project', { githubRepo: 'not a repo' }, null)
    assert.deepEqual(project.remove, [])
    assert.match(project.unresolved[0]!, /not "owner\/name"/)
  })

  it('does not duplicate a link that already exists', () => {
    const existing = { url: 'https://github.com/a/b/pull/4', provider: 'github', kind: 'change', ref: 'a/b#4' }
    const m = migrateLegacy('task', { githubPRs: [4], links: [existing] }, 'a/b')
    assert.deepEqual([m.added, m.remove], [[], ['githubPRs']])
  })

  it('docs have nothing to migrate', () => {
    assert.deepEqual(migrateLegacy('doc', { githubRepo: 'a/b', githubPRs: [1] }, 'a/b').remove, [])
  })
})

describe('applyToText', () => {
  const apply = (text: string, kind: 'task' | 'project' = 'task', repo: string | null = 'acme/widgets') => applyToText(text, migrateLegacy(kind, matter(text).data, repo))

  it('changes only the legacy keys and the links block, byte for byte elsewhere', () => {
    const before = FM(['title: Both', '# keep this comment byte for byte', 'due: 2026-07-01', 'githubIssues: [7, 12]', 'githubPRs: [42]', 'tags:', '  - a', 'order: 3'], 'Body\n\n---\n\nrule\n')
    const after = apply(before)
    assert.equal(after.slice(0, after.indexOf('links:')), '---\ntitle: Both\n# keep this comment byte for byte\ndue: 2026-07-01\ntags:\n  - a\norder: 3\n')
    assert.ok(after.endsWith('---\nBody\n\n---\n\nrule\n'))
    assert.deepEqual(matter(after).data.links.map((l: any) => l.ref), ['acme/widgets#7', 'acme/widgets#12', 'acme/widgets#42'])
  })

  it('handles block lists, inline lists, and a legacy key last in the frontmatter', () => {
    for (const legacy of [['githubPRs:', '  - 42'], ['githubPRs: [42]'], ['githubPRs:', '- 42']]) {
      const after = apply(FM(['title: T', ...legacy]))
      const data = matter(after).data
      assert.equal(data.githubPRs, undefined, legacy.join('|'))
      assert.equal(data.links[0].ref, 'acme/widgets#42')
    }
  })

  it('does not mistake a longer key for a legacy one', () => {
    const after = apply(FM(['title: T', 'githubPRsExtra: keep', 'githubPRs: [1]']))
    assert.equal(matter(after).data.githubPRsExtra, 'keep')
  })

  it('merges into an existing links block without duplicating', () => {
    const before = FM(['title: T', 'githubPRs: [42, 43]', 'links:', "  - url: 'https://example.com/x'", "    title: 'X'"])
    const links = matter(apply(before)).data.links
    assert.deepEqual(links.map((l: any) => l.ref ?? l.url), ['https://example.com/x', 'acme/widgets#42', 'acme/widgets#43'])
  })

  it('is idempotent: a migrated file needs nothing more', () => {
    const once = apply(FM(['title: T', 'githubIssues: [7]', 'githubPRs: [42]']))
    const again = migrateLegacy('task', matter(once).data, 'acme/widgets')
    assert.deepEqual([again.remove, again.added], [[], []])
  })

  it('refuses shapes it cannot edit safely instead of writing them wrong', () => {
    assert.throws(() => apply(FM(['title: T', '"githubIssues": [7]'])), FrontmatterError)
    assert.throws(() => apply('---\r\ntitle: T\r\ngithubIssues: [7]\r\n---\r\n'), /CRLF/)
    assert.throws(() => applyToText('no frontmatter', migrateLegacy('task', { githubIssues: [7] }, 'a/b')), /no frontmatter/)
  })
})

describe('planning and applying', () => {
  let root: string
  const env = { MDPM_STATE_DIR: '' }
  beforeEach(() => {
    root = fresh()
    env.MDPM_STATE_DIR = join(scratch.dir, `state-${n}`)
    process.env.MDPM_STATE_DIR = env.MDPM_STATE_DIR
  })
  after(() => { delete process.env.MDPM_STATE_DIR })

  it('a dry run reports changes and writes nothing', () => {
    const before = snapshot(root)
    const plan = planMigration(root)
    assert.deepEqual(plan.entries.map(e => e.file).sort(), [
      'projects/acme/index.md', 'projects/acme/tasks/both.md', 'projects/acme/tasks/has-links.md', 'projects/acme/tasks/pr-task.md', 'projects/norepo/tasks/loose.md',
    ])
    assert.deepEqual(snapshot(root), before)
    assert.ok(!existsSync(join(root, '.mdpm-schema.json')))
    assert.equal(plan.entries.find(e => e.file.endsWith('loose.md'))!.unresolved.length, 1)
  })

  it('reports pending files until migrated', () => {
    assert.deepEqual([schemaStatus(root).pendingFiles, schemaStatus(root).version], [5, 1])
  })

  it('applies with a backup, stamps the marker, and keeps bodies identical', () => {
    const before = snapshot(root)
    const result = applyMigration(planMigration(root))
    assert.equal(result.applied.length, 5)
    assert.ok(result.stamped)
    assert.deepEqual(snapshot(join(result.backupDir!)), before, 'backup is the original content')
    for (const [rel, text] of Object.entries(before)) {
      assert.equal(matter(readFileSync(join(root, rel), 'utf8')).content, matter(text).content, `${rel} body`)
    }
    assert.equal(readSchemaMarker(root)?.schemaVersion, SCHEMA_VERSION)
    assert.equal(schemaStatus(root).pendingFiles, 0)
    const project = matter(readFileSync(join(root, 'projects/acme/index.md'), 'utf8')).data
    assert.equal(project.githubRepo, undefined)
    assert.equal(project.links[0].ref, 'acme/widgets')
  })

  it('is idempotent: a second run changes nothing, including the marker', () => {
    applyMigration(planMigration(root))
    const migrated = snapshot(root)
    const second = planMigration(root)
    assert.deepEqual(second.entries, [])
    const result = applyMigration(second)
    assert.deepEqual([result.applied, result.stamped, result.backupDir], [[], false, undefined])
    assert.deepEqual(snapshot(root), migrated)
  })

  it('--file touches only that file and does not stamp while others remain', () => {
    const before = snapshot(root)
    const result = applyMigration(planMigration(root, { file: 'projects/acme/tasks/both.md' }))
    assert.deepEqual(result.applied, ['projects/acme/tasks/both.md'])
    assert.equal(result.stamped, false)
    const after = snapshot(root)
    const changed = Object.keys(after).filter(k => after[k] !== before[k])
    assert.deepEqual(changed, ['/projects/acme/tasks/both.md'])
  })

  it('--project limits the scope, and a bad --file is an error', () => {
    assert.deepEqual(planMigration(root, { project: 'norepo' }).entries.map(e => e.file), ['projects/norepo/tasks/loose.md'])
    assert.throws(() => planMigration(root, { file: 'projects/nope.md' }), MigrationError)
    assert.throws(() => planMigration(root, { file: '/etc/hosts' }), /outside the content directory/)
    assert.deepEqual(planMigration(root, { file: 'projects/acme/tasks/none.md' }).entries, [], 'a file with nothing legacy is a no-op, not an error')
    assert.throws(() => planMigration(root, { file: 'projects/acme/tasks' }), MigrationError)
  })

  it('a file that cannot be edited safely blocks the run before anything is written', () => {
    writeFileSync(join(root, 'projects/acme/tasks/weird.md'), FM(['title: Weird', '"githubIssues": [7]']))
    const before = snapshot(root)
    const plan = planMigration(root)
    assert.match(plan.entries.find(e => e.file.endsWith('weird.md'))!.error!, /parse to the expected data/)
    assert.throws(() => applyMigration(plan), /cannot be migrated safely, nothing was written/)
    assert.deepEqual(snapshot(root), before)
    assert.ok(!existsSync(join(scratch.dir, `state-${n}`, 'backups')), 'no backup when nothing is written')
  })

  it('leaves no temp files behind', () => {
    applyMigration(planMigration(root))
    assert.ok(!Object.keys(snapshot(root)).some(k => k.endsWith('.mdpm-tmp')))
  })

  it('a marker from a newer mdpm is flagged', () => {
    writeFileSync(join(root, '.mdpm-schema.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, migratedAt: 'x', migratedBy: 'y' }))
    assert.equal(schemaStatus(root).newerThanCode, true)
  })

  it('a migrated project reads exactly like the legacy one', () => {
    const read = () => {
      const core = createCore({ contentPath: root, baseUrl: 'http://127.0.0.1:1' })
      return core.listTasks({ project: 'acme' }).map(t => [t.slug, t.githubIssues, t.githubPRs, t.githubRepo]).sort()
    }
    const legacy = read()
    applyMigration(planMigration(root))
    assert.deepEqual(read(), legacy)
    assert.deepEqual(legacy.find(r => r[0] === 'both'), ['both', [7, 12], [42], 'acme/widgets'])
  })
})

describe('fixtures and CLI', () => {
  it('the shared fixture content plans cleanly (its one legacy project, no errors) without being modified', () => {
    const before = snapshot(FIXTURE_CONTENT)
    const plan = planMigration(FIXTURE_CONTENT)
    assert.deepEqual(plan.entries.map(e => [e.file, e.error]), [['projects/alpha/index.md', undefined]])
    assert.match(plan.entries[0]!.newText!, /createdAt: 2026-06-01\n/, 'unquoted date left exactly as written')
    assert.deepEqual(snapshot(FIXTURE_CONTENT), before)
  })

  it('mdpm migrate: dry run, --check, --apply, and usage errors', async () => {
    const root = fresh()
    const env = { MDPM_CONTENT_PATH: root }
    const dry = await runCli(['migrate', '--json'], { scratch: scratch.dir, env })
    assert.equal(dry.code, 0)
    assert.deepEqual([dry.json.dryRun, dry.json.files.length, dry.json.applied], [true, 5, undefined])
    assert.ok(!existsSync(join(root, '.mdpm-schema.json')))

    const check = await runCli(['migrate', '--check', '--json'], { scratch: scratch.dir, env })
    assert.deepEqual([check.code, check.json.pending, check.json.pendingFiles], [1, true, 5])

    const status = await runCli(['status', '--json'], { scratch: scratch.dir, env })
    assert.equal(status.json.content.pendingMigration, 5)

    const bad = await runCli(['migrate', '--file', 'projects/nope.md'], { scratch: scratch.dir, env })
    assert.equal(bad.code, 2)

    const applied = await runCli(['migrate', '--apply', '--json'], { scratch: scratch.dir, env })
    assert.deepEqual([applied.code, applied.json.applied.length, applied.json.stamped], [0, 5, true])
    assert.ok(statSync(applied.json.backupDir).isDirectory())

    const after = await runCli(['migrate', '--check', '--json'], { scratch: scratch.dir, env })
    assert.deepEqual([after.code, after.json.pending], [0, false])
    const again = await runCli(['migrate'], { scratch: scratch.dir, env })
    assert.match(again.stdout, /nothing to migrate/)
  })
})
