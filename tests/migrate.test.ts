import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { applyMigration, createCore, MigrationError, planMigration, readSchemaMarker, schemaStatus, SCHEMA_VERSION } from '../lib/core'
import { applyToText, insertLinks, MigrationTextError, planFile } from '../lib/core/migrate/links-to-body'
import { FIXTURE_CONTENT, runCli, scratchDir } from './helpers'

// Migration 002: link fields leave the frontmatter. Task and doc links (and legacy GitHub numbers) become a
// `## Links` section at the end of the spec; a project's repository becomes `repo:`.

const scratch = scratchDir()
after(scratch.cleanup)

const FM = (lines: string[], body = 'Body.\n') => `---\n${lines.join('\n')}\n---\n${body}`
const NOTE = '**Note** _(2026-10-01 12:00)_ by sam\n\nShipped it.\n'

// A content dir with link fields in the YAML shapes real files take.
function linkedContent(root: string) {
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
    "  - url: 'https://example.com/spec'", "    title: 'Spec [v2]'",
  ]))
  put('projects/acme/tasks/with-notes.md', FM(['title: With notes', 'githubPRs: [9]'], `The spec.\n\n---\n${NOTE}\n---\n**Note** _(2026-10-02 08:30)_\n\nSecond.\n`))
  put('projects/acme/tasks/note-only.md', FM(['title: Note only', 'githubIssues: [5]'], NOTE))
  put('projects/acme/docs/design.md', FM(['title: Design', 'links:', "  - url: 'https://linear.app/acme/issue/ACM-1'", "    provider: 'linear'"], '# Design\n'))
  put('projects/linked/index.md', FM([
    'title: Linked', 'links:',
    "  - url: 'https://acme.atlassian.net/browse/ABC'", "    title: 'Jira board'",
    "  - provider: 'github'", "    kind: 'repo'", "    ref: 'acme/other'",
  ], ''))
  put('projects/linked/tasks/short-ref.md', FM(['title: Short ref', 'links:', "  - provider: 'github'", "    kind: 'change'", "    ref: '#8'"]))
  put('projects/norepo/index.md', FM(['title: No repo'], ''))
  put('projects/norepo/tasks/loose.md', FM(['title: Loose', 'githubIssues:', '  - 3']))
  put('docs/standalone.md', FM(['title: Standalone', 'links:', "  - url: 'https://example.com/guide'"]))
}

const snapshot = (dir: string): Record<string, string> => Object.fromEntries(
  readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => [join(e.parentPath, e.name).slice(dir.length), readFileSync(join(e.parentPath, e.name), 'utf8')]),
)

let n = 0
function fresh() {
  const root = join(scratch.dir, `content-${n++}`)
  linkedContent(root)
  return root
}

const REPO = 'https://github.com/acme/widgets'

describe('planFile (pure)', () => {
  it('turns a project githubRepo into a repo URL', () => {
    const m = planFile('project', { githubRepo: 'acme/widgets' }, undefined)
    assert.deepEqual([m.remove, m.repo, m.lines], [['githubRepo'], REPO, []])
  })

  it('a project repo link becomes repo; its other links go to the body', () => {
    const m = planFile('project', { links: [{ url: 'https://jira.example/b', title: 'Board' }, { provider: 'github', kind: 'repo', ref: 'acme/other' }] }, undefined)
    assert.deepEqual([m.repo, m.lines], ['https://github.com/acme/other', ['- [Board](https://jira.example/b)']])
  })

  it('numbers become labelled GitHub URLs, links keep their title, duplicates collapse', () => {
    const m = planFile('task', {
      githubIssues: [7], githubPRs: [42],
      links: [{ url: `${REPO}/pull/42`, provider: 'github', kind: 'change' }, { url: 'https://x.test/a', title: 'A [b]' }, { url: 'https://github.com/other/r/issues/1' }],
    }, REPO)
    assert.deepEqual(m.lines, [
      `- [PR #42](${REPO}/pull/42)`,
      '- [A \\[b\\]](https://x.test/a)',
      '- [Issue other/r#1](https://github.com/other/r/issues/1)',
      `- [Issue #7](${REPO}/issues/7)`,
    ])
    assert.deepEqual(m.unresolved, [])
  })

  it('a short ref expands against the project repo; without one it stays text and is reported', () => {
    assert.deepEqual(planFile('task', { links: [{ provider: 'github', kind: 'change', ref: '#8' }] }, REPO).lines, [`- [PR #8](${REPO}/pull/8)`])
    const loose = planFile('task', { githubIssues: [3], links: [{ provider: 'github', kind: 'change', ref: '#8' }] }, undefined)
    assert.deepEqual(loose.lines, ['- github change #8 (no URL)', '- GitHub Issue #3 (no repository to resolve it)'])
    assert.equal(loose.unresolved.length, 2)
  })

  it('empty legacy arrays are removed without adding a section', () => {
    assert.deepEqual(planFile('task', { githubIssues: [], githubPRs: [], links: [] }, REPO), { remove: ['githubIssues', 'githubPRs', 'links'], lines: [], changes: ['remove githubIssues, githubPRs, links'], unresolved: [] })
  })
})

describe('insertLinks', () => {
  const lines = ['- [x](https://x.test)']
  it('appends after the spec when there are no notes', () => {
    assert.equal(insertLinks('Spec.\n', lines), 'Spec.\n\n## Links\n\n- [x](https://x.test)\n')
    assert.equal(insertLinks('', lines), '## Links\n\n- [x](https://x.test)\n')
  })
  it('goes before the first note, leaving the notes exactly as they were', () => {
    const body = `Spec.\n\n---\n${NOTE}`
    assert.equal(insertLinks(body, lines), `Spec.\n\n## Links\n\n- [x](https://x.test)\n\n---\n${NOTE}`)
  })
  it('a body that opens with a note gets a separator after the new section', () => {
    assert.equal(insertLinks(NOTE, lines), `## Links\n\n- [x](https://x.test)\n\n---\n${NOTE}`)
  })
  it('a horizontal rule in the spec is not a note', () => {
    assert.equal(insertLinks('A\n\n---\n\nB\n', lines), 'A\n\n---\n\nB\n\n## Links\n\n- [x](https://x.test)\n')
  })
})

describe('applyToText', () => {
  const apply = (text: string, repo = REPO) => applyToText(text, planFile('task', matter(text).data, repo))

  it('edits only the link keys; every other frontmatter line stays byte for byte', () => {
    const out = apply(FM(['title: Both', '# keep this comment byte for byte', 'due: 2026-07-01', 'githubIssues: [7, 12]', 'githubPRs: [42]', 'tags:', '  - a']))
    assert.equal(out, FM(['title: Both', '# keep this comment byte for byte', 'due: 2026-07-01', 'tags:', '  - a'], `Body.\n\n## Links\n\n- [PR #42](${REPO}/pull/42)\n- [Issue #7](${REPO}/issues/7)\n- [Issue #12](${REPO}/issues/12)\n`))
  })

  it('adds repo to a project', () => {
    const text = FM(['title: P', 'githubRepo: acme/widgets'], '')
    assert.equal(applyToText(text, planFile('project', matter(text).data, undefined)), FM(['title: P', `repo: '${REPO}'`], ''))
  })

  it('refuses shapes it cannot edit safely instead of writing them wrong', () => {
    assert.throws(() => apply(FM(['title: T', '"githubIssues": [7]'])), MigrationTextError)
    assert.throws(() => apply('---\r\ntitle: T\r\ngithubIssues: [7]\r\n---\r\n'), /CRLF/)
    assert.throws(() => applyToText('no frontmatter', planFile('task', { githubIssues: [7] }, REPO)), /no frontmatter/)
  })
})

describe('planning and applying', () => {
  let root: string
  beforeEach(() => {
    root = fresh()
    process.env.MDPM_STATE_DIR = join(scratch.dir, `state-${n}`)
  })
  after(() => { delete process.env.MDPM_STATE_DIR })

  const PENDING = [
    'docs/standalone.md',
    'projects/acme/docs/design.md', 'projects/acme/index.md',
    'projects/acme/tasks/both.md', 'projects/acme/tasks/has-links.md', 'projects/acme/tasks/note-only.md', 'projects/acme/tasks/plain.md', 'projects/acme/tasks/pr-task.md', 'projects/acme/tasks/with-notes.md',
    'projects/linked/index.md', 'projects/linked/tasks/short-ref.md',
    'projects/norepo/tasks/loose.md',
  ]

  it('a dry run lists every file with link fields (tasks, docs, projects, standalone docs) and writes nothing', () => {
    const before = snapshot(root)
    const plan = planMigration(root)
    assert.deepEqual(plan.entries.map(e => e.file).sort(), PENDING)
    assert.deepEqual(plan.entries.filter(e => e.error), [])
    assert.deepEqual(snapshot(root), before)
    assert.ok(!existsSync(join(root, '.mdpm-schema.json')))
    assert.equal(plan.entries.find(e => e.file.endsWith('loose.md'))!.unresolved.length, 1)
  })

  it('reports pending files until migrated', () => {
    assert.deepEqual([schemaStatus(root).pendingFiles, schemaStatus(root).version], [PENDING.length, 2])
  })

  it('applies with a backup, stamps the marker, and keeps every link', () => {
    const before = snapshot(root)
    const result = applyMigration(planMigration(root))
    assert.equal(result.applied.length, PENDING.length)
    assert.ok(result.stamped)
    assert.deepEqual(snapshot(result.backupDir!), before, 'backup is the original content')
    assert.deepEqual([readSchemaMarker(root)?.schemaVersion, schemaStatus(root).pendingFiles, schemaStatus(root).version], [SCHEMA_VERSION, 0, SCHEMA_VERSION])

    const read = (rel: string) => matter(readFileSync(join(root, rel), 'utf8'))
    for (const rel of PENDING) {
      const data = read(rel).data
      for (const key of ['githubRepo', 'githubIssues', 'githubPRs', 'links']) assert.ok(!(key in data), `${rel} still has ${key}`)
    }
    assert.equal(read('projects/acme/index.md').data.repo, REPO)
    assert.equal(read('projects/linked/index.md').data.repo, 'https://github.com/acme/other')
    assert.match(read('projects/linked/index.md').content, /## Links\n\n- \[Jira board\]\(https:\/\/acme\.atlassian\.net\/browse\/ABC\)/)
    assert.match(read('projects/linked/tasks/short-ref.md').content, /\[PR #8\]\(https:\/\/github\.com\/acme\/other\/pull\/8\)/)
    assert.match(read('projects/acme/docs/design.md').content, /- \[https:\/\/linear\.app\/acme\/issue\/ACM-1\]\(https:\/\/linear\.app\/acme\/issue\/ACM-1\)/)
    assert.match(read('docs/standalone.md').content, /\(https:\/\/example\.com\/guide\)/)
    assert.equal(read('projects/acme/tasks/plain.md').content, 'Body.\n', 'empty arrays removed without a section')

    // Notes are untouched, byte for byte; the section sits between spec and notes.
    const original = before['/projects/acme/tasks/with-notes.md']!
    const withNotes = readFileSync(join(root, 'projects/acme/tasks/with-notes.md'), 'utf8')
    assert.ok(withNotes.endsWith(original.slice(original.indexOf('**Note**'))))
    assert.match(withNotes, /The spec\.\n\n## Links\n\n- \[PR #9\]\(https:\/\/github\.com\/acme\/widgets\/pull\/9\)\n\n---\n\*\*Note\*\*/)
  })

  it('a migrated task still reads its notes the same way', () => {
    const notes = () => createCore({ contentPath: root, baseUrl: 'http://127.0.0.1:1' }).getTask('acme', 'with-notes').body.match(/\*\*Note\*\*/g)?.length
    assert.equal(notes(), 2)
    applyMigration(planMigration(root))
    assert.equal(notes(), 2)
  })

  it('a project keeps being found by its repo before and after migrating', () => {
    const repoOf = () => createCore({ contentPath: root, baseUrl: 'http://127.0.0.1:1' }).getProject('acme').repo
    assert.equal(repoOf(), REPO, 'legacy githubRepo reads as the repo URL before migrating')
    applyMigration(planMigration(root))
    assert.equal(repoOf(), REPO)
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
    assert.deepEqual([result.applied, result.stamped], [['projects/acme/tasks/both.md'], false])
    const after = snapshot(root)
    assert.deepEqual(Object.keys(after).filter(k => after[k] !== before[k]), ['/projects/acme/tasks/both.md'])
  })

  it('--project limits the scope (and leaves standalone docs out); a bad --file is an error', () => {
    assert.deepEqual(planMigration(root, { project: 'norepo' }).entries.map(e => e.file), ['projects/norepo/tasks/loose.md'])
    assert.throws(() => planMigration(root, { file: 'projects/nope.md' }), MigrationError)
    assert.throws(() => planMigration(root, { file: '/etc/hosts' }), /outside the content directory/)
    assert.deepEqual(planMigration(root, { file: 'projects/acme/tasks/none.md' }).entries, [], 'a file with nothing to migrate is a no-op')
    assert.throws(() => planMigration(root, { file: 'projects/acme/tasks' }), MigrationError)
  })

  it('a file that cannot be edited safely blocks the run before anything is written', () => {
    writeFileSync(join(root, 'projects/acme/tasks/weird.md'), FM(['title: Weird', 'links: []', '"githubIssues": [7]']))
    const before = snapshot(root)
    const plan = planMigration(root)
    assert.match(plan.entries.find(e => e.file.endsWith('weird.md'))!.error!, /expected data/)
    assert.throws(() => applyMigration(plan), /cannot be migrated safely, nothing was written/)
    assert.deepEqual(snapshot(root), before)
  })

  it('leaves no temp files behind', () => {
    applyMigration(planMigration(root))
    assert.ok(!Object.keys(snapshot(root)).some(k => k.endsWith('.mdpm-tmp')))
  })

  it('a marker from a newer mdpm is flagged', () => {
    writeFileSync(join(root, '.mdpm-schema.json'), JSON.stringify({ schemaVersion: SCHEMA_VERSION + 1, migratedAt: 'x', migratedBy: 'y' }))
    assert.equal(schemaStatus(root).newerThanCode, true)
  })
})

describe('fixtures and CLI', () => {
  it('the shared fixture content plans cleanly (its one legacy project) without being modified', () => {
    const before = snapshot(FIXTURE_CONTENT)
    const plan = planMigration(FIXTURE_CONTENT)
    assert.deepEqual(plan.entries.map(e => [e.file, e.error]), [['projects/alpha/index.md', undefined]])
    assert.match(plan.entries[0]!.newText!, /createdAt: 2026-06-01\n/, 'unquoted date left exactly as written')
    assert.deepEqual(snapshot(FIXTURE_CONTENT), before)
  })

  it('mdpm migrate: dry run, --check, --apply, and usage errors', async () => {
    const root = fresh()
    const env = { MDPM_CONTENT_PATH: root }
    const count = 12
    const dry = await runCli(['migrate', '--json'], { scratch: scratch.dir, env })
    assert.equal(dry.code, 0)
    assert.deepEqual([dry.json.dryRun, dry.json.files.length, dry.json.applied], [true, count, undefined])
    assert.ok(!existsSync(join(root, '.mdpm-schema.json')))

    const check = await runCli(['migrate', '--check', '--json'], { scratch: scratch.dir, env })
    assert.deepEqual([check.code, check.json.pending, check.json.pendingFiles], [1, true, count])

    const status = await runCli(['status', '--json'], { scratch: scratch.dir, env })
    assert.equal(status.json.content.pendingMigration, count)

    const bad = await runCli(['migrate', '--file', 'projects/nope.md'], { scratch: scratch.dir, env })
    assert.equal(bad.code, 2)

    const applied = await runCli(['migrate', '--apply', '--json'], { scratch: scratch.dir, env })
    assert.deepEqual([applied.code, applied.json.applied.length, applied.json.stamped], [0, count, true])
    assert.ok(statSync(applied.json.backupDir).isDirectory())

    const after = await runCli(['migrate', '--check', '--json'], { scratch: scratch.dir, env })
    assert.deepEqual([after.code, after.json.pending], [0, false])
    const again = await runCli(['migrate'], { scratch: scratch.dir, env })
    assert.match(again.stdout, /nothing to migrate/)
  })
})
