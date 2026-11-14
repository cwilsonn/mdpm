import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { buildExport, CSV_COLUMNS, createCore, toCsv, toMarkdown, type ExportDocument } from '../lib/core'
import { FIXTURE_CONTENT, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)
const core = createCore({ contentPath: FIXTURE_CONTENT, baseUrl: 'http://127.0.0.1:1' })
describe('export', () => {
  const at = new Date('2026-10-01T12:00:00Z')

  it('builds a self-describing JSON document, leaving out archived items by default', () => {
    const doc = buildExport(core, {}, at)
    assert.deepEqual([doc.format, doc.formatVersion, doc.exportedAt], ['mdpm-export', 3, '2026-10-01T12:00:00.000Z'])
    assert.deepEqual(doc.projects.map(p => p.slug).sort(), ['alpha', 'beta'])
    const alpha = doc.projects.find(p => p.slug === 'alpha')!
    assert.ok(!alpha.tasks.some(t => t.slug === 'old-idea'), 'archived task left out')
    assert.ok(!alpha.docs.some(d => d.slug === 'old-child'), 'doc under an archived folder left out')
    assert.deepEqual(doc.standaloneDocs.map(d => d.slug), ['standalone-guide'])
    const parser = alpha.tasks.find(t => t.slug === 'write-parser')!
    assert.deepEqual([parser.status, parser.priority, parser.tags, parser.dependencies], ['in-progress', 'high', ['backend'], ['shared-task']])
    assert.match(parser.description, /Implement the parser/)
  })

  it('--include-archived brings archived items back; a single project drops standalone docs; --no-docs drops docs', () => {
    const all = buildExport(core, { includeArchived: true }, at)
    assert.ok(all.projects.some(p => p.slug === 'gamma'))
    assert.ok(all.projects.find(p => p.slug === 'alpha')!.tasks.some(t => t.slug === 'old-idea'))
    const one = buildExport(core, { project: 'alpha' }, at)
    assert.deepEqual([one.projects.length, one.standaloneDocs.length], [1, 0])
    const bare = buildExport(core, { docs: false }, at)
    assert.ok(bare.projects.every(p => p.docs.length === 0) && bare.standaloneDocs.length === 0)
  })

  it('CSV quotes commas, quotes, and line breaks', () => {
    const doc: ExportDocument = { format: 'mdpm-export', formatVersion: 3, exportedAt: '', standaloneDocs: [], projects: [{
      slug: 'p', title: 'P', status: 'active', icon: null, description: null, tags: [], repo: null, createdAt: '', archivedAt: null, docs: [],
      tasks: [{ slug: 'x', title: 'Say "hi", then leave', status: 'todo', priority: 'low', tags: ['a', 'b'], assignees: [], due: '2026-12-01', dependencies: ['y'], createdAt: '2026-01-01', updatedAt: null, archivedAt: null, description: 'line one\nline two, with comma' }],
    }] }
    const csv = toCsv(doc)
    assert.ok(csv.startsWith(`${CSV_COLUMNS.join(',')}\n`))
    assert.ok(csv.includes('"Say ""hi"", then leave"'), 'quotes doubled inside a quoted field')
    assert.ok(csv.includes('"line one\nline two, with comma"'), 'line breaks and commas kept inside quotes')
    assert.ok(csv.includes(',a;b,'), 'list columns joined with ;')
  })

  it('markdown groups tasks by status with checkboxes and lists docs', () => {
    const md = toMarkdown(buildExport(core, { project: 'alpha' }, at))
    assert.match(md, /^# mdpm export/)
    assert.match(md, /## Alpha \(`alpha`\)/)
    assert.match(md, /#### In progress \(1\)\n\n- \[ \] \*\*Write the parser\*\* `write-parser`/)
    assert.match(md, /#### Done \(1\)\n\n- \[x\] \*\*Ship v1\*\*/)
    assert.match(md, /waits on: `shared-task`/)
    assert.match(md, /### Docs\n\n(- \*\*.+\n)*- \*\*Architecture\*\* `architecture` \(architecture, context\)/)
  })
})

describe('export CLI', () => {
  const cli = (args: string[]) => runCli(['export', ...args], { scratch: scratch.dir })

  it('prints JSON to stdout by default, scoped with --project', async () => {
    const r = await cli(['--project', 'alpha', '--no-docs'])
    assert.equal(r.code, 0, r.stderr)
    const doc = JSON.parse(r.stdout)
    assert.deepEqual(doc.projects.map((p: any) => p.slug), ['alpha'])
    assert.equal(doc.projects[0].docs.length, 0)
  })

  it('prints CSV and markdown', async () => {
    assert.match((await cli(['--all', '--format', 'csv'])).stdout, /^project,slug,title,status/)
    assert.match((await cli(['--all', '--format', 'markdown'])).stdout, /^# mdpm export/)
    assert.equal((await cli(['--format', 'xml'])).code, 2)
  })

  it('--out writes a file, refuses to overwrite without --force, and says what it wrote', async () => {
    const out = join(scratch.dir, 'export.json')
    const first = await cli(['--all', '--out', out])
    assert.equal(first.code, 0, first.stderr)
    assert.match(first.stderr, /wrote .*export\.json: 2 projects, \d+ tasks, \d+ docs/)
    assert.equal(JSON.parse(readFileSync(out, 'utf8')).format, 'mdpm-export')
    const again = await cli(['--all', '--out', out])
    assert.equal(again.code, 2)
    assert.match(again.stderr, /--force/)
    assert.equal((await cli(['--all', '--out', out, '--force'])).code, 0)
  })

  it('exits 4 for an unknown project', async () => {
    assert.equal((await cli(['--project', 'nope'])).code, 4)
  })
})

describe('repo in export', () => {
  it('exports the project repo URL and no link fields', () => {
    const doc = buildExport(core, { project: 'alpha' }, new Date('2026-10-01T12:00:00Z'))
    // alpha still stores its repo as the legacy githubRepo field
    assert.equal(doc.projects[0]!.repo, 'https://github.com/test/alpha')
    assert.ok(!('links' in doc.projects[0]!) && !('links' in doc.projects[0]!.tasks[0]!))
    assert.ok(!('githubRepo' in doc.projects[0]!) && !('githubIssues' in doc.projects[0]!.tasks[0]!))
  })

  it('markdown shows the repo; CSV has no links column', () => {
    const md = toMarkdown(buildExport(core, { project: 'alpha' }, new Date('2026-10-01T12:00:00Z')))
    assert.match(md, /repo: https:\/\/github\.com\/test\/alpha/)
    assert.ok(!CSV_COLUMNS.includes('links' as never))
  })
})
