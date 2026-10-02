import { strict as assert } from 'node:assert'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import matter from 'gray-matter'
import { removalVersion } from '../lib/core/version'
import { rejects, route } from './route-harness'
import { scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

const FM = (lines: string[], body = 'Body.\n') => `---\n${lines.join('\n')}\n---\n${body}`
const PR42 = ["  - url: 'https://github.com/acme/widgets/pull/42'", "    provider: 'github'", "    kind: 'change'", "    ref: 'acme/widgets#42'"]
let root: string
let n = 0

// acme: legacy shape (githubRepo field). beta: links shape (repo link). Both have one repo.
function seed() {
  root = join(scratch.dir, `c${n++}`)
  process.env.MDPM_CONTENT_PATH = root
  const put = (rel: string, text: string) => { mkdirSync(join(root, rel, '..'), { recursive: true }); writeFileSync(join(root, rel), text) }
  put('projects/acme/index.md', FM(['title: Acme', 'githubRepo: acme/widgets'], ''))
  put('projects/acme/tasks/legacy.md', FM(['title: Legacy', 'status: todo', 'githubIssues: [7]', 'githubPRs:', '  - 42']))
  put('projects/beta/index.md', FM(['title: Beta', 'links:', "  - url: 'https://github.com/acme/widgets'", "    provider: 'github'", "    kind: 'repo'", "    ref: 'acme/widgets'"], ''))
  put('projects/beta/tasks/titled.md', FM(['title: Titled', 'links:', ...PR42, "    title: 'Keep my title'"]))
  put('projects/loose/index.md', FM(['title: Loose'], ''))
  put('docs/guide.md', FM(['title: Guide']))
}
const read = (rel: string) => matter(readFileSync(join(root, rel), 'utf8'))
beforeEach(seed)
after(() => { delete process.env.MDPM_CONTENT_PATH })

describe('task PATCH', () => {
  it('maps legacy arguments onto links, drops the legacy keys, and says it is deprecated', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const res = await patch({ params: { project: 'acme', slug: 'legacy' }, body: { githubPRs: [42, 43] } })
    assert.match(res.notices[0], new RegExp(`githubPRs is deprecated; use links. Removal planned for ${removalVersion().replace('.', '\\.')}\\.`))
    const { data } = read('projects/acme/tasks/legacy.md')
    assert.equal(data.githubPRs, undefined)
    assert.equal(data.githubIssues, undefined, 'the other legacy key was folded into links, not left behind')
    assert.deepEqual(data.links.map((l: any) => `${l.kind} ${l.ref}`), ['issue acme/widgets#7', 'change acme/widgets#42', 'change acme/widgets#43'])
  })

  it('re-saving unchanged numbers leaves existing links (and their titles) untouched', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const before = read('projects/beta/tasks/titled.md').data.links
    await patch({ params: { project: 'beta', slug: 'titled' }, body: { githubIssues: [], githubPRs: [42] } })
    assert.deepEqual(read('projects/beta/tasks/titled.md').data.links, before)
  })

  it('replacing the numbers removes the ones that are gone, and only those', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    writeFileSync(join(root, 'projects/beta/tasks/titled.md'), FM(['title: Titled', 'links:', ...PR42, "  - url: 'https://example.com/spec'", "    title: 'Spec'"]))
    await patch({ params: { project: 'beta', slug: 'titled' }, body: { githubPRs: [] } })
    assert.deepEqual(read('projects/beta/tasks/titled.md').data.links, [{ url: 'https://example.com/spec', title: 'Spec' }])
  })

  it('explicit links replace the effective list, so a client that read it loses nothing', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const get = await route('tasks/[project]/[slug].get')
    const seen = (await get({ params: { project: 'acme', slug: 'legacy' } })).links
    assert.deepEqual(seen.map((l: any) => l.ref), ['acme/widgets#7', 'acme/widgets#42'], 'legacy numbers are visible as links')
    await patch({ params: { project: 'acme', slug: 'legacy' }, body: { links: [...seen, { url: 'https://example.com/new', title: 'New' }] } })
    const { data } = read('projects/acme/tasks/legacy.md')
    assert.deepEqual([data.githubIssues, data.githubPRs], [undefined, undefined])
    assert.equal(data.links.length, 3)
  })

  it('removing a legacy-only link through links works (it does not reappear from the old field)', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const get = await route('tasks/[project]/[slug].get')
    const seen = (await get({ params: { project: 'acme', slug: 'legacy' } })).links
    await patch({ params: { project: 'acme', slug: 'legacy' }, body: { links: seen.filter((l: any) => l.ref !== 'acme/widgets#42') } })
    const after = await get({ params: { project: 'acme', slug: 'legacy' } })
    assert.deepEqual([after.githubIssues, after.githubPRs], [[7], []])
  })

  it('a request that does not touch links leaves a legacy-shaped file alone', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    await patch({ params: { project: 'acme', slug: 'legacy' }, body: { status: 'done' } })
    const { data } = read('projects/acme/tasks/legacy.md')
    assert.deepEqual([data.status, data.githubIssues, data.githubPRs, data.links], ['done', [7], [42], undefined])
  })

  it('no repo: numbers are stored as unresolved links, with a warning', async () => {
    const post = await route('tasks/index.post')
    const res = await post({ body: { project: 'loose', title: 'T', githubPRs: [5] } })
    assert.match(res.notices.join(' '), /no GitHub repo/)
    assert.deepEqual(read(`projects/loose/tasks/${res.slug}.md`).data.links, [{ provider: 'github', kind: 'change', ref: '#5' }])
  })

  it('rejects unsafe or malformed links and numbers with a 400, writing nothing', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const before = readFileSync(join(root, 'projects/acme/tasks/legacy.md'), 'utf8')
    for (const body of [{ links: [{ url: 'javascript:alert(1)' }] }, { links: [{ kind: 'issue', url: 'https://x.test/' }] }, { githubPRs: ['x'] }, { githubIssues: [0] }]) {
      const err = await rejects(patch({ params: { project: 'acme', slug: 'legacy' }, body }))
      assert.equal(err.statusCode, 400, JSON.stringify(body))
    }
    assert.equal(readFileSync(join(root, 'projects/acme/tasks/legacy.md'), 'utf8'), before)
  })

  it('normalizes and de-duplicates stored links; null or [] clears them', async () => {
    const patch = await route('tasks/[project]/[slug].patch')
    const params = { project: 'beta', slug: 'titled' }
    await patch({ params, body: { links: [{ url: 'https://Example.com/a/?utm_source=x#frag' }, { url: 'https://example.com/a' }] } })
    assert.deepEqual(read('projects/beta/tasks/titled.md').data.links, [{ url: 'https://example.com/a' }])
    await patch({ params, body: { links: null } })
    assert.equal(read('projects/beta/tasks/titled.md').data.links, undefined)
  })
})

describe('creating', () => {
  it('a new task has no empty legacy arrays; links and legacy arguments both work', async () => {
    const post = await route('tasks/index.post')
    const plain = await post({ body: { project: 'beta', title: 'Plain' } })
    const fm = read(`projects/beta/tasks/${plain.slug}.md`).data
    assert.deepEqual([fm.githubIssues, fm.githubPRs, fm.links, plain.notices], [undefined, undefined, undefined, undefined])
    const withLinks = await post({ body: { project: 'beta', title: 'With', links: [{ url: 'https://example.com/x', title: 'X' }], githubIssues: [9] } })
    assert.deepEqual(read(`projects/beta/tasks/${withLinks.slug}.md`).data.links.map((l: any) => l.ref ?? l.url), ['https://example.com/x', 'acme/widgets#9'])
  })

  it('projects: githubRepo becomes a repo link; links are accepted; null removes', async () => {
    const post = await route('projects/index.post')
    const patch = await route('projects/[slug].patch')
    const created = await post({ body: { title: 'Gamma', githubRepo: 'acme/gamma' } })
    assert.match(created.notices[0], /githubRepo is deprecated/)
    const gamma = () => read(`projects/${created.slug}/index.md`).data
    assert.deepEqual(gamma().links, [{ url: 'https://github.com/acme/gamma', provider: 'github', kind: 'repo', ref: 'acme/gamma' }])
    assert.equal(gamma().githubRepo, undefined)
    await patch({ params: { slug: created.slug }, body: { githubRepo: null } })
    assert.equal(gamma().links, undefined)
    assert.equal((await rejects(patch({ params: { slug: created.slug }, body: { githubRepo: 'not a repo' } }))).statusCode, 400)
  })

  it('docs (project and standalone) accept links', async () => {
    const patch = await route('standalone-docs/[slug].patch')
    await patch({ params: { slug: 'guide' }, body: { links: [{ url: 'https://example.com/spec/' }] } })
    assert.deepEqual(read('docs/guide.md').data.links, [{ url: 'https://example.com/spec' }])
    const post = await route('docs/[project]/index.post')
    const doc = await post({ params: { project: 'beta' }, body: { title: 'D', links: [{ url: 'https://example.com/d' }] } })
    assert.deepEqual(read(`projects/beta/docs/${doc.slug}.md`).data.links, [{ url: 'https://example.com/d' }])
    assert.equal((await rejects(post({ params: { project: 'beta' }, body: { title: 'E', links: [{ url: 'file:///etc/passwd' }] } }))).statusCode, 400)
  })
})

describe('reading', () => {
  it('both storage shapes read the same legacy numbers and expose effective links', async () => {
    const list = await route('tasks/[project]/index.get')
    const legacy = (await list({ params: { project: 'acme' } }))[0]
    assert.deepEqual([legacy.githubIssues, legacy.githubPRs, legacy.githubRepo], [[7], [42], 'acme/widgets'])
    assert.deepEqual(legacy.links.map((l: any) => l.ref), ['acme/widgets#7', 'acme/widgets#42'])
    const migrated = (await list({ params: { project: 'beta' } }))[0]
    assert.deepEqual([migrated.githubIssues, migrated.githubPRs, migrated.githubRepo], [[], [42], 'acme/widgets'])
  })
})

describe('POST /api/links/resolve', () => {
  it('resolves a URL, expands a short ref from the project repo, and reports ambiguity as 400 with a code', async () => {
    const resolve = await route('links/resolve.post')
    const url = await resolve({ body: { input: 'https://gitlab.com/g/p/-/merge_requests/9' } })
    assert.deepEqual([url.link.ref, url.view.noun, url.view.label], ['g/p!9', 'Merge request', '!9'])
    const short = await resolve({ body: { input: '#42', project: 'beta', kind: 'change' } })
    assert.equal(short.link.url, 'https://github.com/acme/widgets/pull/42')
    const amb = await rejects(resolve({ body: { input: '#42', project: 'beta' } }))
    assert.deepEqual([amb.statusCode, amb.data?.code], [400, 'ambiguous'])
    assert.equal((await rejects(resolve({ body: { input: 'javascript:alert(1)' } }))).data?.code, 'unsafe')
    assert.equal((await rejects(resolve({ body: {} }))).statusCode, 400)
    assert.equal((await rejects(resolve({ body: { input: '#1', project: 'nope' } }))).statusCode, 404)
  })
})
