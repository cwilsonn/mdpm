import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  addLink, builtinRegistry, createProvider, createRegistry, isSafeScheme, LinkError, linkKey, LinkSchema, normalizeUrl, ProviderSpec,
  removeLink, resolveLink, validateLinks, viewLink, type Link,
} from '../lib/core'
import { REPO } from './helpers'

const spec = (file: string) => ProviderSpec.parse(JSON.parse(readFileSync(join(REPO, file), 'utf8')))
const jira = createProvider(spec('tests/fixtures/providers/jira.json'))
const registry = createRegistry(builtinRegistry().providers, [jira])

const repo = (ref: string, provider = 'github', host = provider === 'github' ? 'github.com' : 'gitlab.com'): Link =>
  ({ url: `https://${host}/${ref}`, provider, kind: 'repo', ref })
const fails = (fn: () => unknown, code: string, message?: RegExp) =>
  assert.throws(fn, (err: unknown) => err instanceof LinkError && err.code === code && (!message || message.test(err.message)))

describe('normalizeUrl', () => {
  const cases: [string, string][] = [
    ['https://GitHub.com/Acme/widgets/pull/42/', 'https://github.com/Acme/widgets/pull/42'],
    ['https://github.com/acme/widgets/pull/42#discussion_r1', 'https://github.com/acme/widgets/pull/42'],
    ['https://example.com/page?utm_source=x&id=3&fbclid=abc&gclid=1', 'https://example.com/page?id=3'],
    ['https://example.com/', 'https://example.com/'],
    ['https://example.com', 'https://example.com/'],
    ['  mailto:a@b.co  ', 'mailto:a@b.co'],
  ]
  for (const [input, expected] of cases) test(input, () => assert.equal(normalizeUrl(input), expected))

  test('rejects dangerous and malformed input', () => {
    for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x', 'file:///etc/passwd', 'vbscript:x', 'blob:https://x/y']) {
      fails(() => normalizeUrl(bad), 'unsafe')
    }
    fails(() => normalizeUrl('not a url'), 'invalid', /no scheme/)
    fails(() => normalizeUrl('https://user:pw@example.com/'), 'invalid', /credentials/)
    fails(() => normalizeUrl(`https://example.com/${'a'.repeat(3000)}`), 'invalid')
    fails(() => normalizeUrl(''), 'invalid')
  })

  test('only the default schemes plus those a provider declares', () => {
    fails(() => normalizeUrl('message://%3cabc@mail%3e'), 'unsafe')
    assert.equal(normalizeUrl('message://%3cabc@mail%3e', ['message']), 'message://%3cabc@mail%3e')
    assert.equal(isSafeScheme('javascript:1', ['javascript']), false)
  })
})

describe('link records', () => {
  test('shape rules', () => {
    assert.ok(LinkSchema.safeParse({ url: 'https://x.test/' }).success)
    assert.ok(LinkSchema.safeParse({ provider: 'github', kind: 'change', ref: '#42' }).success, 'unresolved link')
    assert.ok(!LinkSchema.safeParse({}).success)
    assert.ok(!LinkSchema.safeParse({ url: 'https://x.test/', kind: 'issue' }).success, 'kind needs provider')
    assert.ok(!LinkSchema.safeParse({ url: 'https://x.test/', provider: 'github', ref: 'a#1' }).success, 'ref needs kind')
    assert.ok(!LinkSchema.safeParse({ url: 'https://x.test/', extra: 1 }).success)
    assert.ok(!LinkSchema.safeParse({ url: 'https://x.test/', title: 'x'.repeat(201) }).success)
  })

  test('validateLinks names the index and field', () => {
    assert.deepEqual(validateLinks([{ url: 'https://x.test/' }]), [])
    assert.deepEqual(validateLinks([{ url: 'https://x.test/' }, { url: 'javascript:alert(1)' }]), ['links[1].url: the "javascript:" scheme is not allowed'])
    assert.match(validateLinks([{ url: 'https://x.test/', kind: 'issue' }])[0]!, /^links\[0\]\.kind: kind requires a provider/)
    assert.match(validateLinks(Array.from({ length: 51 }, (_, i) => ({ url: `https://x.test/${i}` })))[0]!, /^links:/)
  })

  test('de-duplicates by ref, else by normalized URL; remove by key', () => {
    const pr: Link = { url: 'https://github.com/acme/widgets/pull/42', provider: 'github', kind: 'change', ref: 'acme/widgets#42' }
    const first = addLink([], pr)
    assert.equal(first.added, true)
    assert.equal(addLink(first.links, { ...pr, url: 'http://github.com/acme/widgets/pull/42', title: 'again' }).added, false, 'same ref')
    assert.equal(addLink(first.links, { url: 'https://x.test/a' }).links.length, 2)
    assert.equal(addLink([{ url: 'https://x.test/a' }], { url: 'https://x.test/a' }).added, false)
    assert.deepEqual(removeLink(first.links, linkKey(pr)), [])
    fails(() => addLink(Array.from({ length: 50 }, (_, i) => ({ url: `https://x.test/${i}` })), { url: 'https://x.test/new' }), 'invalid', /at most 50/)
  })
})

describe('resolving a pasted URL', () => {
  test('provider URLs gain provider, kind and ref', () => {
    assert.deepEqual(resolveLink(registry, 'https://github.com/acme/widgets/pull/42/?utm_source=x#files'), {
      url: 'https://github.com/acme/widgets/pull/42', provider: 'github', kind: 'change', ref: 'acme/widgets#42',
    })
    assert.deepEqual(resolveLink(registry, 'https://gitlab.com/group/sub/proj/-/merge_requests/9'), {
      url: 'https://gitlab.com/group/sub/proj/-/merge_requests/9', provider: 'gitlab', kind: 'change', ref: 'group/sub/proj!9',
    })
    assert.equal(resolveLink(registry, 'https://acme.atlassian.net/browse/ABC-123', {}, { title: 'Add SSO' }).title, 'Add SSO')
  })

  test('anything else is a plain link, not an error', () => {
    assert.deepEqual(resolveLink(registry, 'https://example.com/some/page'), { url: 'https://example.com/some/page' })
    assert.deepEqual(resolveLink(registry, 'mailto:a@b.co'), { url: 'mailto:a@b.co' })
  })

  test('a self-hosted host nobody claims is plain until configured', () => {
    assert.equal(resolveLink(registry, 'https://gitlab.corp.example/team/app/-/issues/3').provider, undefined)
    const corp = createProvider(ProviderSpec.parse({ ...spec('providers/gitlab.json'), hosts: ['gitlab.com', 'gitlab.corp.example'] }))
    assert.equal(resolveLink(createRegistry(registry.providers, [corp]), 'https://gitlab.corp.example/team/app/-/issues/3').ref, 'team/app#3')
  })

  test('--provider / --kind must actually match', () => {
    fails(() => resolveLink(registry, 'https://example.com/x', {}, { provider: 'github' }), 'invalid', /doesn't match github/)
    fails(() => resolveLink(registry, 'https://github.com/acme/widgets/pull/42', {}, { kind: 'issue' }), 'invalid')
  })

  test('two equally specific providers are an ambiguity, not a guess', () => {
    const a = createProvider(ProviderSpec.parse({ ...spec('providers/github.json'), id: 'forge-a', hosts: ['git.example'] }))
    const b = createProvider(ProviderSpec.parse({ ...spec('providers/github.json'), id: 'forge-b', hosts: ['git.example'] }))
    const reg = createRegistry([a, b])
    fails(() => resolveLink(reg, 'https://git.example/o/r/pull/1'), 'ambiguous', /forge-a\.change and forge-b\.change/)
    assert.equal(resolveLink(reg, 'https://git.example/o/r/pull/1', {}, { provider: 'forge-b' }).provider, 'forge-b')
  })

  test('dangerous schemes are rejected', () => {
    fails(() => resolveLink(registry, 'javascript:alert(1)'), 'unsafe')
  })
})

describe('resolving a short ref', () => {
  const ctx = { repos: [repo('acme/widgets')], settings: { jira: { host: 'acme.atlassian.net' } } }

  test('"#42" is ambiguous between issue and pull request until --kind says which', () => {
    fails(() => resolveLink(registry, '#42', ctx), 'ambiguous', /github\.change or github\.issue/)
    assert.deepEqual(resolveLink(registry, '#42', ctx, { kind: 'change' }), {
      url: 'https://github.com/acme/widgets/pull/42', provider: 'github', kind: 'change', ref: 'acme/widgets#42',
    })
    assert.equal(resolveLink(registry, '#7', ctx, { kind: 'issue', provider: 'github' }).url, 'https://github.com/acme/widgets/issues/7')
  })

  test('"!9" can only be a gitlab merge request, and uses the repo link host', () => {
    const link = resolveLink(registry, '!9', { repos: [repo('team/app', 'gitlab', 'gitlab.com')] })
    assert.deepEqual(link, { url: 'https://gitlab.com/team/app/-/merge_requests/9', provider: 'gitlab', kind: 'change', ref: 'team/app!9' })
  })

  test('self-hosted repo link keeps its own host', () => {
    const link = resolveLink(registry, '#5', { repos: [repo('team/app', 'github', 'github.acme.com')] }, { kind: 'issue' })
    assert.equal(link.url, 'https://github.acme.com/team/app/issues/5')
  })

  test('jira key needs the host setting', () => {
    assert.equal(resolveLink(registry, 'ABC-123', ctx).url, 'https://acme.atlassian.net/browse/ABC-123')
    fails(() => resolveLink(registry, 'ABC-123'), 'unresolvable', /setting host/)
  })

  test('no repo, or several repos, is reported rather than guessed', () => {
    fails(() => resolveLink(registry, '#42', {}, { kind: 'change' }), 'unresolvable', /needs a linked GitHub repo/)
    fails(() => resolveLink(registry, '#42', { repos: [repo('a/b'), repo('c/d')] }, { kind: 'change' }), 'ambiguous', /several repos/)
  })

  test('text that is neither a URL nor a short ref', () => {
    fails(() => resolveLink(registry, 'fix the thing'), 'unresolvable', /not a URL or a known short reference/)
  })

  test('input length is capped', () => {
    fails(() => resolveLink(registry, `#${'1'.repeat(3000)}`), 'invalid')
  })
})

describe('viewLink', () => {
  test('provider vocabulary, icon and href come from the provider', () => {
    assert.deepEqual(viewLink(registry, resolveLink(registry, 'https://github.com/acme/widgets/pull/42')), {
      label: '#42', noun: 'Pull request', icon: 'lucide:git-pull-request', href: 'https://github.com/acme/widgets/pull/42', provider: 'github', kind: 'change',
    })
    const mr = viewLink(registry, resolveLink(registry, 'https://gitlab.com/g/p/-/merge_requests/9'))
    assert.deepEqual([mr.label, mr.noun, mr.icon], ['!9', 'Merge request', 'lucide:git-merge'])
  })

  test('a title replaces the derived label', () => {
    assert.equal(viewLink(registry, resolveLink(registry, 'https://acme.atlassian.net/browse/ABC-1', {}, { title: 'Add SSO' })).label, 'Add SSO')
  })

  test('plain links get host/path, a generic icon, and mail gets the mail icon', () => {
    assert.deepEqual(viewLink(registry, { url: 'https://example.com/some/page' }), { label: 'example.com/some/page', noun: 'Link', icon: 'lucide:link', href: 'https://example.com/some/page' })
    assert.equal(viewLink(registry, { url: 'https://example.com/' }).label, 'example.com')
    assert.deepEqual(viewLink(registry, { url: 'mailto:a@b.co' }), { label: 'a@b.co', noun: 'Email', icon: 'lucide:mail', href: 'mailto:a@b.co' })
  })

  test('an unresolved link renders as text; a ref can still rebuild its URL', () => {
    assert.equal(viewLink(registry, { provider: 'github', kind: 'change', ref: '#42' }).href, null)
    assert.equal(viewLink(registry, { provider: 'github', kind: 'change', ref: 'acme/widgets#42' }).href, 'https://github.com/acme/widgets/pull/42')
  })

  test('an unsafe stored URL never becomes an href (hand-edited files)', () => {
    assert.equal(viewLink(registry, { url: 'javascript:alert(1)' }).href, null)
    assert.equal(viewLink(registry, { url: 'file:///etc/passwd', title: 'x' }).href, null)
  })

  test('a provider that is not installed degrades to a plain link', () => {
    const view = viewLink(registry, { url: 'https://linear.app/acme/issue/ENG-1', provider: 'linear', kind: 'issue', ref: 'ENG-1' })
    assert.deepEqual([view.noun, view.icon, view.href, view.provider], ['Link', 'lucide:link', 'https://linear.app/acme/issue/ENG-1', 'linear'])
  })
})
