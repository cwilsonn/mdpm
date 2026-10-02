import { strict as assert } from 'node:assert'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { buildExport, CSV_COLUMNS, createCore, ImportError, parseCsv, parseImport, toCsv, toMarkdown, type ExportDocument } from '../lib/core'
import { FIXTURE_CONTENT, mockApi, runCli, scratchDir, type RecordedRequest } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)
const core = createCore({ contentPath: FIXTURE_CONTENT, baseUrl: 'http://127.0.0.1:1' })

describe('export', () => {
  const at = new Date('2026-10-01T12:00:00Z')

  it('builds a self-describing JSON document, leaving out archived items by default', () => {
    const doc = buildExport(core, {}, at)
    assert.deepEqual([doc.format, doc.formatVersion, doc.exportedAt], ['mdpm-export', 2, '2026-10-01T12:00:00.000Z'])
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

  it('CSV quotes commas, quotes, and line breaks, and survives a round trip', () => {
    const doc: ExportDocument = { format: 'mdpm-export', formatVersion: 2, exportedAt: '', standaloneDocs: [], projects: [{
      slug: 'p', title: 'P', status: 'active', icon: null, description: null, tags: [], links: [], createdAt: '', archivedAt: null, docs: [],
      tasks: [{ slug: 'x', title: 'Say "hi", then leave', status: 'todo', priority: 'low', tags: ['a', 'b'], assignees: [], due: '2026-12-01', dependencies: ['y'], links: [{ url: 'https://github.com/acme/w/issues/1', provider: 'github', kind: 'issue', ref: 'acme/w#1' }, { provider: 'github', kind: 'change', ref: '#42' }], createdAt: '2026-01-01', updatedAt: null, archivedAt: null, description: 'line one\nline two, with comma' }],
    }] }
    const csv = toCsv(doc)
    const rows = parseCsv(csv)
    assert.deepEqual(rows[0], [...CSV_COLUMNS])
    assert.equal(rows[1]![2], 'Say "hi", then leave')
    assert.equal(rows[1]![13], 'line one\nline two, with comma')
    assert.deepEqual([rows[1]![5], rows[1]![9]], ['a;b', 'https://github.com/acme/w/issues/1;github:change:#42'])
    const back = parseImport(csv)
    assert.deepEqual(back.projects[0]!.tasks[0], { slug: 'x', title: 'Say "hi", then leave', status: 'todo', priority: 'low', tags: ['a', 'b'], assignees: [], due: '2026-12-01', dependencies: ['y'], links: [{ url: 'https://github.com/acme/w/issues/1', provider: 'github', kind: 'issue', ref: 'acme/w#1' }, { provider: 'github', kind: 'change', ref: '#42' }], githubIssues: undefined, githubPRs: undefined, archivedAt: null, description: 'line one\nline two, with comma' })
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

describe('parseImport', () => {
  it('reads an export document, an object with tasks, and a bare array', () => {
    const exported = JSON.stringify(buildExport(core, { project: 'alpha' }))
    const fromExport = parseImport(exported)
    assert.deepEqual(fromExport.projects.map(p => p.slug), ['alpha'])
    assert.ok(fromExport.projects[0]!.tasks.length > 3 && fromExport.projects[0]!.docs.length > 0)

    const obj = parseImport(JSON.stringify({ project: 'p', tasks: [{ title: 'A' }] }))
    assert.deepEqual(obj.projects.map(p => [p.slug, p.tasks.length]), [['p', 1]])

    const arr = parseImport(JSON.stringify([{ title: 'A', project: 'x' }, { title: 'B', project: 'y' }, { title: 'C' }]), { project: 'fallback' })
    assert.deepEqual(arr.projects.map(p => [p.slug, p.tasks.length]).sort(), [['fallback', 1], ['x', 1], ['y', 1]])
  })

  it('reads CSV with header aliases, quoted fields, CRLF, and a BOM', () => {
    const csv = '﻿project,Title,STATUS,github_issues,body\r\nalpha,"A, with comma",todo,"1;2","multi\nline"\r\nalpha,B,,,\r\n'
    const data = parseImport(csv)
    const [a, b] = data.projects[0]!.tasks
    assert.deepEqual([a!.title, a!.status, a!.githubIssues, a!.description], ['A, with comma', 'todo', [1, 2], 'multi\nline'])
    assert.deepEqual([b!.title, b!.status], ['B', undefined])
  })

  it('reports every problem at once and writes nothing', () => {
    const bad = JSON.stringify([{ title: 'ok', project: 'p' }, { project: 'p' }, { title: 'x', project: 'p', status: 'finished' }, { title: 'y', project: 'p', due: 'tomorrow' }, { title: 'z', project: 'p', githubIssues: ['abc'] }])
    assert.throws(() => parseImport(bad), (err: Error) => err instanceof ImportError
      && /4 problems/.test(err.message) && /task #2: missing title/.test(err.message) && /status 'finished'/.test(err.message)
      && /due 'tomorrow'/.test(err.message) && /'abc' is not a positive integer/.test(err.message))
  })

  it('rejects unusable files with a clear message', () => {
    assert.throws(() => parseImport('{ nope'), /not valid JSON/)
    assert.throws(() => parseImport('{"hello":1}'), /unrecognised JSON/)
    assert.throws(() => parseImport('a,b\n1,2'), /needs a title column/)
    assert.throws(() => parseImport('title\nNo project'), /no project/)
    assert.throws(() => parseImport(JSON.stringify({ format: 'something-else', projects: [] })), /unrecognised export format/)
    assert.throws(() => parseImport('title\n"unterminated'), /inside a quoted field/)
  })
})

describe('import CLI', () => {
  let api: Awaited<ReturnType<typeof mockApi>>
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  let failTitle: string | undefined
  // Like the real server, hand back slugs derived from titles; tasks get a suffix so remapping is observable.
  before(async () => {
    api = await mockApi((req: RecordedRequest) => {
      if (req.method !== 'POST') return {}
      if (failTitle && req.body?.title === failTitle) return { status: 500, body: { message: 'boom' } }
      if (req.path === '/api/projects') return { body: { slug: slugify(req.body.title) } }
      if (req.path === '/api/tasks') return { body: { slug: `${slugify(req.body.title)}-2` } }
      return { body: { slug: req.body.slug ?? slugify(req.body.title) } }
    })
  })
  after(() => api.close())
  beforeEach(() => { api.requests.length = 0; failTitle = undefined })

  const emptyContent = join(scratch.dir, 'empty-content')
  mkdirSync(join(emptyContent, 'projects'), { recursive: true })
  const run = (args: string[], opts: { input?: string; content?: string; cwd?: string } = {}) =>
    runCli(['import', ...args], { scratch: scratch.dir, input: opts.input, cwd: opts.cwd, env: { MDPM_BASE_URL: api.url, MDPM_CONTENT_PATH: opts.content ?? FIXTURE_CONTENT } })
  const writes = () => api.requests.filter(r => r.method !== 'GET' && r.path !== '/api/health')
  const file = (name: string, text: string) => { const p = join(scratch.dir, name); writeFileSync(p, text); return p }

  it('skips tasks that already exist (matched by title or slug) and creates the rest', async () => {
    const csv = file('a.csv', 'title,status,priority,tags\nWrite the parser,todo,low,x\nBrand new one,todo,high,"a;b"\n')
    const r = await run([csv, '--project', 'alpha', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json.steps.map((s: any) => [s.kind, s.action, s.key]), [['project', 'exists', 'alpha'], ['task', 'skip', 'Write the parser'], ['task', 'create', 'Brand new one']])
    assert.deepEqual(writes().map(w => [w.method, w.path, w.body]), [['POST', '/api/tasks', { project: 'alpha', title: 'Brand new one', status: 'todo', priority: 'high', tags: ['a', 'b'], assignees: [], description: '' }]])
  })

  it('--on-exists update patches the matching task; duplicate creates it again', async () => {
    const csv = file('b.csv', 'title,priority\nWrite the parser,low\n')
    await run([csv, '--project', 'alpha', '--on-exists', 'update'])
    assert.deepEqual([writes()[0]!.method, writes()[0]!.path, writes()[0]!.body.priority], ['PATCH', '/api/tasks/alpha/write-parser', 'low'])
    assert.ok(!('slug' in writes()[0]!.body), 'an update must never write a slug into the task')
    api.requests.length = 0
    await run([csv, '--project', 'alpha', '--on-exists', 'duplicate'])
    assert.deepEqual(writes().map(w => [w.method, w.path]), [['POST', '/api/tasks']])
    assert.equal((await run([csv, '--project', 'alpha', '--on-exists', 'overwrite'])).code, 2)
  })

  it('refuses unknown projects without --create-projects, writing nothing', async () => {
    const json = file('c.json', JSON.stringify([{ title: 'T', project: 'ghost' }]))
    const r = await run([json])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /project not found: ghost.*--create-projects/)
    assert.equal(writes().length, 0)
  })

  it('--create-projects creates the project first and puts its tasks under the slug the server returned', async () => {
    const json = file('d.json', JSON.stringify({ project: 'ghost', tasks: [{ title: 'Ghost task' }] }))
    const r = await run([json, '--create-projects', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(writes().map(w => [w.path, w.body.project ?? w.body.title]), [['/api/projects', 'ghost'], ['/api/tasks', 'ghost']])
  })

  it('remaps dependencies and doc parents to the slugs the server assigned', async () => {
    const doc = { format: 'mdpm-export', formatVersion: 1, exportedAt: '', standaloneDocs: [{ slug: 'loose', title: 'Loose doc', body: 'x' }], projects: [{
      slug: 'proj', title: 'Proj',
      tasks: [
        { slug: 'first-task', title: 'First task', dependencies: [] },
        { slug: 'second-task', title: 'Second task', dependencies: ['first-task'], archivedAt: '2026-09-01' },
      ],
      docs: [{ slug: 'child', title: 'Child', parent: 'root-doc', body: 'c' }, { slug: 'root-doc', title: 'Root doc', body: 'r' }],
    }] }
    const r = await run([file('e.json', JSON.stringify(doc)), '--create-projects', '--json'])
    assert.equal(r.code, 0, r.stderr)
    const body = (path: string, method = 'PATCH') => writes().filter(w => w.method === method && w.path === path).map(w => w.body)
    // the server named them first-task-2 / second-task-2, so the dependency must point at the new slug
    assert.deepEqual(body('/api/tasks/proj/second-task-2'), [{ archivedAt: writes().find(w => w.body?.archivedAt)!.body.archivedAt }, { dependencies: ['first-task-2'] }])
    assert.deepEqual(body('/api/docs/proj/child'), [{ parent: 'root-doc' }])
    assert.ok(writes().some(w => w.path === '/api/standalone-docs' && w.body.slug === 'loose'))
    assert.ok(r.json.steps.every((s: any) => s.action !== 'failed'))
  })

  it('a create offers the exported slug so slugs survive a round trip', async () => {
    const json = file('slugs.json', JSON.stringify([{ title: 'Renamed later', slug: 'original-short-slug' }]))
    await run([json, '--project', 'alpha'])
    assert.equal(writes()[0]!.body.slug, 'original-short-slug')
  })

  it('--dry-run validates and reports without writing', async () => {
    const csv = file('f.csv', 'title\nOne\nTwo\n')
    const r = await run([csv, '--project', 'alpha', '--dry-run'])
    assert.equal(r.code, 0, r.stderr)
    assert.match(r.stdout, /dry run: nothing was written/)
    assert.match(r.stdout, /task\s+2\s+0\s+0\s+0/)
    assert.equal(api.requests.length, 0)
  })

  it('validates the whole file first: one bad row means nothing is written', async () => {
    const csv = file('g.csv', 'title,status\nFine,todo\nBroken,finished\n')
    const r = await run([csv, '--project', 'alpha'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /status 'finished'/)
    assert.equal(writes().length, 0)
  })

  it('keeps going when one write fails, lists it, and exits 1', async () => {
    failTitle = 'Second'
    const r = await run([file('h.csv', 'title\nFirst\nSecond\nThird\n'), '--project', 'alpha', '--json'])
    assert.equal(r.code, 1)
    assert.deepEqual(r.json.steps.filter((s: any) => s.kind === 'task').map((s: any) => [s.key, s.action]), [['First', 'create'], ['Second', 'failed'], ['Third', 'create']])
    assert.equal(r.json.steps.find((s: any) => s.action === 'failed').error, 'boom')
    failTitle = 'Second'
    const text = await run([file('h2.csv', 'title\nFirst\nSecond\n'), '--project', 'alpha'])
    assert.match(text.stdout, /✗ task alpha\/Second: boom/)
  })

  it('reads stdin with - and detects the format', async () => {
    const r = await run(['-', '--project', 'alpha', '--json'], { input: 'title\nFrom stdin\n' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(writes()[0]!.body.title, 'From stdin')
  })

  it('reports an unreadable file as a usage error', async () => {
    const r = await run([join(scratch.dir, 'missing.csv'), '--project', 'alpha'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /no such file/)
  })

  it('round trip: an exported project imports into an empty workspace with the same tasks and docs', async () => {
    const exported = JSON.stringify(buildExport(core, { project: 'alpha' }))
    const doc = JSON.parse(exported)
    const r = await run([file('rt.json', exported), '--create-projects', '--json'], { content: emptyContent })
    assert.equal(r.code, 0, r.stderr)
    const created = (path: string) => writes().filter(w => w.method === 'POST' && w.path.startsWith(path)).length
    assert.equal(created('/api/projects'), 1)
    assert.equal(created('/api/tasks'), doc.projects[0].tasks.length)
    assert.equal(created('/api/docs/alpha'), doc.projects[0].docs.length)
    assert.ok(!existsSync(join(emptyContent, 'projects/alpha')), 'the mock server wrote nothing to disk')
    // dependencies in the fixture (write-tests -> write-parser -> shared-task -> beta/shared-task...) are re-linked
    assert.ok(writes().filter(w => w.method === 'PATCH' && w.body.dependencies).length >= 3)
  })
})

describe('links in export and import (format 2)', () => {
  it('exports effective links, so legacy-shaped content exports the same way', () => {
    const doc = buildExport(core, { project: 'alpha' }, new Date('2026-10-01T12:00:00Z'))
    // alpha still stores its repo as the legacy githubRepo field
    assert.deepEqual(doc.projects[0]!.links, [{ url: 'https://github.com/test/alpha', provider: 'github', kind: 'repo', ref: 'test/alpha' }])
    assert.ok(doc.projects[0]!.tasks.every(t => Array.isArray(t.links)))
    assert.ok(!('githubRepo' in doc.projects[0]!) && !('githubIssues' in doc.projects[0]!.tasks[0]!))
  })

  it('markdown shows the repo and task links; CSV has a links column', () => {
    const doc = buildExport(core, { project: 'alpha' }, new Date('2026-10-01T12:00:00Z'))
    doc.projects[0]!.tasks[0]!.links = [{ url: 'https://github.com/test/alpha/pull/3', provider: 'github', kind: 'change', ref: 'test/alpha#3' }, { url: 'https://example.com/spec', title: 'Spec' }]
    const md = toMarkdown(doc)
    assert.match(md, /repo: test\/alpha/)
    assert.match(md, /- links: \[#3\]\(https:\/\/github\.com\/test\/alpha\/pull\/3\), \[Spec\]\(https:\/\/example\.com\/spec\)/)
    assert.ok(CSV_COLUMNS.includes('links' as never) && !CSV_COLUMNS.includes('github_issues' as never))
  })

  it('imports links from JSON objects, URLs and provider:kind:ref strings; absent means untouched', () => {
    const data = parseImport(JSON.stringify([
      { project: 'p', title: 'A', links: [{ url: 'https://example.com/x/', title: 'X' }, 'https://gitlab.com/g/p/-/merge_requests/9', 'github:change:#42'] },
      { project: 'p', title: 'B' },
      { project: 'p', title: 'C', links: [] },
    ]))
    const [a, b, c] = data.projects[0]!.tasks
    assert.deepEqual(a!.links, [
      { url: 'https://example.com/x', title: 'X' },
      { url: 'https://gitlab.com/g/p/-/merge_requests/9', provider: 'gitlab', kind: 'change', ref: 'g/p!9' },
      { provider: 'github', kind: 'change', ref: '#42' },
    ])
    assert.deepEqual([b!.links, c!.links], [undefined, []])
  })

  it('rejects unsafe URLs, short refs, and a format newer than this mdpm, listing each problem', () => {
    const bad = JSON.stringify([{ project: 'p', title: 'A', links: ['javascript:alert(1)', '#42', 'ABC-1'] }])
    assert.throws(() => parseImport(bad), (err: Error) => /javascript:/.test(err.message) && /use the full URL in an import file/.test(err.message))
    assert.throws(() => parseImport(JSON.stringify({ format: 'mdpm-export', formatVersion: 99, projects: [] })), /newer than this mdpm understands/)
  })

  it('still reads format 1 (legacy fields) and CSV columns, as legacy numbers to convert later', () => {
    const v1 = parseImport(JSON.stringify({ format: 'mdpm-export', formatVersion: 1, projects: [{ slug: 'p', githubRepo: 'acme/w', tasks: [{ title: 'T', githubIssues: [7], githubPRs: [] }], docs: [] }] }))
    assert.deepEqual([v1.projects[0]!.githubRepo, v1.projects[0]!.tasks[0]!.githubIssues, v1.projects[0]!.tasks[0]!.githubPRs, v1.projects[0]!.tasks[0]!.links], ['acme/w', [7], undefined, undefined])
  })
})

describe('importing links through the API', () => {
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  let api: Awaited<ReturnType<typeof mockApi>>
  before(async () => {
    api = await mockApi((req: RecordedRequest) => req.method === 'POST' ? { body: { slug: req.body.slug ?? slugify(req.body.title) } } : {})
  })
  after(() => api.close())
  beforeEach(() => { api.requests.length = 0 })
  const run = (args: string[]) => runCli(['import', ...args], { scratch: scratch.dir, env: { MDPM_BASE_URL: api.url, MDPM_CONTENT_PATH: FIXTURE_CONTENT } })
  const writes = () => api.requests.filter(r => r.method !== 'GET' && r.path !== '/api/health')
  const file = (name: string, text: string) => { const p = join(scratch.dir, `lk-${name}`); writeFileSync(p, text); return p }

  it('a format-1 file becomes links (no legacy arguments, so no deprecation notices)', async () => {
    const v1 = { format: 'mdpm-export', formatVersion: 1, exportedAt: '', standaloneDocs: [], projects: [{ slug: 'nu', title: 'Nu', githubRepo: 'acme/nu', tasks: [{ slug: 't', title: 'T', githubIssues: [7], githubPRs: [42] }], docs: [] }] }
    const r = await run([file('v1.json', JSON.stringify(v1)), '--create-projects', '--json'])
    assert.equal(r.code, 0, r.stderr)
    const [project, task] = writes()
    assert.deepEqual(project!.body.links, [{ url: 'https://github.com/acme/nu', provider: 'github', kind: 'repo', ref: 'acme/nu' }])
    assert.ok(!('githubRepo' in project!.body))
    assert.deepEqual(task!.body.links.map((l: any) => `${l.kind} ${l.ref}`), ['issue acme/nu#7', 'change acme/nu#42'])
    assert.ok(!('githubIssues' in task!.body) && !('githubPRs' in task!.body))
  })

  it('legacy numbers go to the existing project\'s repo; a CSV links column carries URLs', async () => {
    // alpha's repo is test/alpha (legacy field in the fixtures)
    const csv = file('l.csv', 'title,github_prs,links\nWith pr,5,https://example.com/a;github:issue:#9\n')
    const r = await run([csv, '--project', 'alpha', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(writes()[0]!.body.links, [
      { url: 'https://example.com/a' },
      { provider: 'github', kind: 'issue', ref: '#9' },
      { url: 'https://github.com/test/alpha/pull/5', provider: 'github', kind: 'change', ref: 'test/alpha#5' },
    ])
  })

  it('a task with no links in the file sends none, so an update never wipes existing ones', async () => {
    const csv = file('n.csv', 'title,status\nWrite the parser,done\n')
    await run([csv, '--project', 'alpha', '--on-exists', 'update'])
    const patch = writes().find(w => w.method === 'PATCH')!
    assert.ok(!('links' in patch.body))
  })

  it('a JSON round trip reproduces project and task links', async () => {
    const exported = buildExport(core, { project: 'alpha' }, new Date('2026-10-01T12:00:00Z'))
    exported.projects[0]!.tasks[0]!.links = [{ url: 'https://example.com/keep', title: 'Keep me' }]
    exported.projects[0]!.slug = 'alpha-copy'
    exported.projects[0]!.title = 'Alpha copy'
    const r = await run([file('rt.json', JSON.stringify(exported)), '--create-projects', '--json'])
    assert.equal(r.code, 0, r.stderr)
    const created = writes().filter(w => w.path === '/api/projects')[0]!
    assert.deepEqual(created.body.links, exported.projects[0]!.links)
    const withLinks = writes().find(w => w.path === '/api/tasks' && w.body.links?.some((l: any) => l.title === 'Keep me'))
    assert.ok(withLinks, 'the task link, including its title, was sent')
  })
})

