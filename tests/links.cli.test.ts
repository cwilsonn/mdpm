import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { mockApi, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

const FM = (lines: string[], body = '') => `---\n${lines.join('\n')}\n---\n${body}`
const link = (kind: string, ref: string, url: string, extra: string[] = []) =>
  ['  - url: ' + `'${url}'`, `    provider: 'github'`, `    kind: '${kind}'`, `    ref: '${ref}'`, ...extra]
const REPO = link('repo', 'acme/widgets', 'https://github.com/acme/widgets')
const PR42 = link('change', 'acme/widgets#42', 'https://github.com/acme/widgets/pull/42')
const ISSUE42 = link('issue', 'acme/widgets#42', 'https://github.com/acme/widgets/issues/42')

const root = join(scratch.dir, 'content')
function put(rel: string, text: string) {
  mkdirSync(join(root, rel, '..'), { recursive: true })
  writeFileSync(join(root, rel), text)
}
put('projects/repo/index.md', FM(['title: Repo', 'links:', ...REPO]))
put('projects/repo/tasks/linked.md', FM(['title: Linked', 'links:', ...PR42, ...ISSUE42, "  - url: 'https://example.com/spec'", "    title: 'Spec'"]))
put('projects/repo/tasks/plain.md', FM(['title: Plain']))
put('projects/repo/docs/spec.md', FM(['title: Spec', 'links:', "  - url: 'https://example.com/d'"]))
put('projects/norepo/index.md', FM(['title: No repo']))
put('projects/norepo/tasks/loose.md', FM(['title: Loose']))
put('projects/bad/index.md', FM(['title: Bad']))
put('projects/bad/tasks/oops.md', FM(['title: Oops', 'links:', "  - url: 'javascript:alert(1)'", "  - provider: 'github'", "    kind: 'change'", "    ref: '#9'", "  - url: 'https://linear.app/x'", "    provider: 'linear'"]))

let api: Awaited<ReturnType<typeof mockApi>>
before(async () => { api = await mockApi(req => req.path === '/api/health' ? { body: { ok: true } } : {}) })
after(() => api.close())
beforeEach(() => { api.requests.length = 0 })

const cli = (args: string[], env: Record<string, string> = {}) =>
  runCli(args, { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: root, MDPM_BASE_URL: api.url, ...env } })
const writes = () => api.requests.filter(r => r.path !== '/api/health')

describe('links resolve', () => {
  it('shows how a URL is understood and writes nothing', async () => {
    const r = await cli(['links', 'resolve', 'https://gitlab.com/g/p/-/merge_requests/9', '--json'])
    assert.equal(r.code, 0)
    assert.deepEqual([r.json.link.ref, r.json.view.noun, r.json.view.label], ['g/p!9', 'Merge request', '!9'])
    assert.equal(writes().length, 0)
  })

  it('expands a short ref from the project repo link, and asks which kind when it is ambiguous', async () => {
    const ok = await cli(['links', 'resolve', '#42', '--project', 'repo', '--kind', 'change', '--json'])
    assert.equal(ok.json.link.url, 'https://github.com/acme/widgets/pull/42')
    const amb = await cli(['links', 'resolve', '#42', '--project', 'repo'])
    assert.equal(amb.code, 2)
    assert.match(amb.stderr, /github\.change or github\.issue; use --provider and\/or --kind to choose/)
    const none = await cli(['links', 'resolve', '#42', '--project', 'norepo', '--kind', 'change'])
    assert.equal(none.code, 2)
    assert.match(none.stderr, /needs a linked GitHub repo/)
  })

  it('refuses unsafe schemes', async () => {
    assert.equal((await cli(['links', 'resolve', 'javascript:alert(1)'])).code, 2)
  })
})

describe('task link', () => {
  it('add resolves, appends to the existing links, and PATCHes the whole list', async () => {
    const r = await cli(['task', 'link', 'add', 'plain', '#7', '--project', 'repo', '--kind', 'issue', '--json'])
    assert.equal(r.code, 0)
    assert.equal(r.json.added, true)
    const req = writes()[0]!
    assert.deepEqual([req.method, req.path], ['PATCH', '/api/tasks/repo/plain'])
    assert.deepEqual(req.body.links, [{ url: 'https://github.com/acme/widgets/issues/7', provider: 'github', kind: 'issue', ref: 'acme/widgets#7' }])
  })

  it('add keeps what is already there and is a no-op for a duplicate', async () => {
    await cli(['task', 'link', 'add', 'linked', 'https://example.com/other', '--project', 'repo', '--title', 'Other'])
    assert.equal(writes()[0]!.body.links.length, 4)
    api.requests.length = 0
    const dup = await cli(['task', 'link', 'add', 'linked', 'https://github.com/acme/widgets/pull/42/', '--project', 'repo', '--json'])
    assert.deepEqual([dup.code, dup.json.added, writes().length], [0, false, 0])
  })

  it('add reports an unclear short ref instead of guessing', async () => {
    const r = await cli(['task', 'link', 'add', 'plain', '#7', '--project', 'repo'])
    assert.equal(r.code, 2)
    assert.equal(writes().length, 0)
  })

  it('remove by @N, URL, or title; ambiguous and missing targets are errors', async () => {
    await cli(['task', 'link', 'remove', 'linked', '@1', '--project', 'repo'])
    assert.deepEqual(writes()[0]!.body.links.map((l: any) => l.ref ?? l.url), ['acme/widgets#42', 'https://example.com/spec'])
    api.requests.length = 0
    await cli(['task', 'link', 'remove', 'linked', 'Spec', '--project', 'repo'])
    assert.equal(writes()[0]!.body.links.length, 2)
    api.requests.length = 0
    await cli(['task', 'link', 'remove', 'linked', 'https://github.com/acme/widgets/issues/42', '--project', 'repo'])
    assert.deepEqual(writes()[0]!.body.links.map((l: any) => l.kind ?? 'plain'), ['change', 'plain'])
    api.requests.length = 0
    const amb = await cli(['task', 'link', 'remove', 'linked', '#42', '--project', 'repo'])
    assert.equal(amb.code, 2)
    assert.match(amb.stderr, /matches 2 links/)
    const missing = await cli(['task', 'link', 'remove', 'linked', 'nope', '--project', 'repo'])
    assert.equal(missing.code, 4)
    assert.equal(writes().length, 0)
  })

  it('removing the last link sends an empty list (the server drops the key)', async () => {
    await cli(['task', 'link', 'add', 'plain', 'https://example.com/a', '--project', 'repo'])
    api.requests.length = 0
    put('projects/repo/tasks/one.md', FM(['title: One', 'links:', "  - url: 'https://example.com/a'"]))
    await cli(['task', 'link', 'remove', 'one', '@1', '--project', 'repo'])
    assert.deepEqual(writes()[0]!.body.links, [])
  })

  it('list shows positions, labels and URLs; --json has the view', async () => {
    const text = await cli(['task', 'link', 'list', 'linked', '--project', 'repo'])
    assert.match(text.stdout, /@1 Pull request #42/)
    assert.match(text.stdout, /@3 Link Spec  https:\/\/example\.com\/spec/)
    const json = await cli(['task', 'link', 'list', 'linked', '--project', 'repo', '--json'])
    assert.deepEqual(json.json.map((e: any) => e.view.noun), ['Pull request', 'Issue', 'Link'])
  })
})

describe('project and doc links', () => {
  it('project link add PATCHes the project', async () => {
    const r = await cli(['project', 'link', 'add', 'norepo', 'https://github.com/acme/other', '--json'])
    assert.equal(r.json.link.kind, 'repo')
    assert.deepEqual([writes()[0]!.path, writes()[0]!.body.links[0].ref], ['/api/projects/norepo', 'acme/other'])
  })

  it('doc link add PATCHes the doc under its project', async () => {
    await cli(['doc', 'link', 'add', 'spec', 'https://example.com/e', '--project', 'repo'])
    assert.equal(writes()[0]!.path, '/api/docs/repo/spec')
    assert.equal(writes()[0]!.body.links.length, 2)
  })
})

describe('--link, --linked and legacy flags', () => {
  it('task add --link resolves against the project and posts links', async () => {
    await cli(['task', 'add', 'New', '--project', 'repo', '--link', 'https://example.com/a', '--link', 'https://example.com/b'])
    assert.deepEqual(writes()[0]!.body.links.map((l: any) => l.url), ['https://example.com/a', 'https://example.com/b'])
  })

  it('--link=value works too, and several flags are all kept', async () => {
    await cli(['task', 'add', 'Eq', '--project', 'repo', '--link=https://example.com/a', '--link', 'https://example.com/b', '--link=https://example.com/c'])
    assert.deepEqual(writes()[0]!.body.links.map((l: any) => l.url), ['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
  })

  it('task set --link adds; an already-present link changes nothing and sends nothing', async () => {
    await cli(['task', 'set', 'plain', '--project', 'repo', '--link', 'https://example.com/a'])
    assert.equal(writes()[0]!.body.links.length, 1)
    api.requests.length = 0
    const same = await cli(['task', 'set', 'linked', '--project', 'repo', '--link', 'https://example.com/spec', '--json'])
    assert.deepEqual([same.code, same.json.updated, writes().length], [0, [], 0])
  })

  it('task list --linked filters by provider, kind and ref; a bad kind is a usage error', async () => {
    const slugs = async (spec: string) => (await cli(['task', 'list', '--project', 'repo', '--linked', spec, '--json'])).json.map((t: any) => t.slug)
    assert.deepEqual(await slugs('github'), ['linked'])
    assert.deepEqual(await slugs('github:issue:acme/widgets#42'), ['linked'])
    assert.deepEqual(await slugs('gitlab'), [])
    assert.equal((await cli(['task', 'list', '--project', 'repo', '--linked', 'github:nope'])).code, 2)
  })

  it('--github-pr still filters but says it is deprecated', async () => {
    const r = await cli(['task', 'list', '--project', 'repo', '--github-pr', '42', '--json'])
    assert.deepEqual(r.json.map((t: any) => t.slug), ['linked'])
    assert.match(r.stderr, /--github-pr is deprecated; use --linked github:change\. Removal planned for \d+\.\d+\./)
  })

  it('task show prints the links neutrally', async () => {
    const r = await cli(['task', 'show', 'linked', '--project', 'repo'])
    assert.match(r.stdout, /Pull request #42/)
    assert.doesNotMatch(r.stdout, /PRs:|issues:/)
  })
})

describe('links check', () => {
  it('reports unsafe, unresolved and uninstalled-provider links (exit 1), once per link', async () => {
    const r = await cli(['links', 'check', '--project', 'bad', '--json'])
    assert.equal(r.code, 1)
    assert.equal(r.json.checked, 3)
    const text = r.json.problems.map((p: any) => p.problem).join('\n')
    assert.match(text, /javascript:/)
    assert.match(text, /"#9" has no usable URL/)
    assert.match(text, /provider "linear" is not installed/)
    assert.equal(r.json.problems.filter((p: any) => /^links\[0\]/.test(p.problem)).length, 1, 'the unsafe link is reported once')
  })

  it('exits 0 when everything is fine', async () => {
    const r = await cli(['links', 'check', '--project', 'repo'])
    assert.equal(r.code, 0)
    assert.match(r.stdout, /no problems/)
  })
})

describe('providers', () => {
  it('lists, shows, and validates', async () => {
    const list = await cli(['providers', 'list', '--json'])
    assert.deepEqual(list.json.map((p: any) => p.id), ['github', 'gitlab'])
    const show = await cli(['providers', 'show', 'gitlab'])
    assert.match(show.stdout, /Merge request/)
    assert.equal((await cli(['providers', 'show', 'nope'])).code, 4)
    const good = await cli(['providers', 'validate', join(process.cwd(), 'providers/github.json'), '--json'])
    assert.deepEqual([good.code, good.json.valid], [0, true])
    const bad = await cli(['providers', 'validate', join(process.cwd(), 'tests/fixtures/providers/broken.json'), '--json'])
    assert.deepEqual([bad.code, bad.json.valid], [1, false])
    assert.match(bad.json.problems.join('\n'), /^id: lowercase letters/m)
  })
})
