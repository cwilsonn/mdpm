import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import { builtinRegistry, createProvider, createRegistry, loadBuiltinProviders, loadProviderDir, loadProviderFile, ProviderSpec } from '../lib/core'
import { formatIssues, providerJsonSchema } from '../lib/core/providers/schema'
import { REPO } from './helpers'

const FIXTURES = join(REPO, 'tests/fixtures/providers')
const BUILTIN_PROVIDERS_DIR = join(REPO, 'providers')
const github = JSON.parse(readFileSync(join(BUILTIN_PROVIDERS_DIR, 'github.json'), 'utf8'))

const problems = (data: unknown) => {
  const parsed = ProviderSpec.safeParse(data)
  return parsed.success ? [] : formatIssues(parsed.error)
}

describe('built-in providers', () => {
  test('git, github and gitlab load with no problems', () => {
    const { providers, problems: bad } = loadBuiltinProviders()
    assert.deepEqual(bad, [])
    assert.deepEqual(providers.map(p => p.id).sort(), ['git', 'github', 'gitlab'])
  })

  test('builtin.ts bundles every file in providers/ (a new file must be added there too)', () => {
    const onDisk = readdirSync(BUILTIN_PROVIDERS_DIR).filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(join(BUILTIN_PROVIDERS_DIR, f), 'utf8')).id).sort()
    assert.deepEqual(loadBuiltinProviders().providers.map(p => p.id).sort(), onDisk)
  })

  test('every shipped provider file validates', () => {
    for (const file of readdirSync(BUILTIN_PROVIDERS_DIR).filter(f => f.endsWith('.json'))) {
      assert.deepEqual(problems(JSON.parse(readFileSync(join(BUILTIN_PROVIDERS_DIR, file), 'utf8'))), [], file)
    }
  })

  test('the committed JSON Schema matches the zod schema (run `pnpm schema:provider`)', () => {
    const committed = JSON.parse(readFileSync(join(REPO, 'schemas/provider.schema.json'), 'utf8'))
    assert.deepEqual(committed, JSON.parse(JSON.stringify(providerJsonSchema())))
  })
})

describe('provider schema errors', () => {
  const kind = github.kinds.change
  const cases: [string, unknown, RegExp][] = [
    ['bad id', { ...github, id: 'Git Hub' }, /^id: lowercase letters/m],
    ['bad icon', { ...github, icon: 'github' }, /^icon: icon must look like "lucide:link"/m],
    ['bad regex', { ...github, kinds: { change: { ...kind, match: '([unclosed' } } }, /^kinds\.change\.match: must be a valid regular expression/m],
    ['oversized pattern', { ...github, kinds: { change: { ...kind, match: 'a'.repeat(301) } } }, /^kinds\.change\.match:/m],
    ['unknown kind', { ...github, kinds: { ticket: kind } }, /^kinds\.ticket:/m],
    ['unknown key', { ...github, extra: 1 }, /Unrecognized key: "extra"/],
    ['wrong version', { ...github, schemaVersion: 2 }, /^schemaVersion:/m],
    ['no kinds', { ...github, kinds: {} }, /at least one kind/],
    ['unknown placeholder in display', { ...github, kinds: { change: { ...kind, display: '#{nope}' } } }, /^kinds\.change\.display: \{nope\} is not a named group/m],
    ['url needs a field the ref lacks', { ...github, kinds: { change: { ...kind, ref: '#{number}' } } }, /^kinds\.change\.ref: must include \{repo\} so the URL can be rebuilt/m],
    ['short group not in ref', { ...github, kinds: { change: { ...kind, short: '^(?<other>\\d+)$' } } }, /^kinds\.change\.short: group "other" must appear in "ref"/m],
    ['repo remote without repo group', { ...github, repo: { remote: '^(?<host>.+)$' } }, /^repo\.remote: must have a named group "repo"/m],
    ['bad scheme', { ...github, schemes: ['HTTPS'] }, /^schemes\.0:/m],
  ]
  for (const [label, data, expected] of cases) {
    test(label, () => assert.match(problems(data).join('\n'), expected))
  }
})

describe('loading provider files', () => {
  test('a bad file is reported and skipped, the good one still loads', () => {
    const { providers, problems: bad } = loadProviderDir(FIXTURES)
    assert.deepEqual(providers.map(p => p.id), ['jira'])
    assert.deepEqual(bad.map(b => b.file.split('/').pop()).sort(), ['broken.json', 'notjson.json'])
    assert.match(bad.find(b => b.file.endsWith('broken.json'))!.problems.join('\n'), /^id: lowercase letters/m)
    assert.match(bad.find(b => b.file.endsWith('notjson.json'))!.problems[0]!, /not readable JSON/)
  })

  test('a missing directory is just empty', () => {
    assert.deepEqual(loadProviderDir(join(FIXTURES, 'nope')), { providers: [], problems: [] })
  })

  test('loadProviderFile returns problems for an invalid file', () => {
    assert.ok('problems' in loadProviderFile(join(FIXTURES, 'broken.json')))
    assert.ok('provider' in loadProviderFile(join(FIXTURES, 'jira.json')))
  })
})

describe('parsing and building URLs', () => {
  const registry = builtinRegistry()
  const gh = registry.get('github')!
  const gl = registry.get('gitlab')!
  const jira = createProvider(ProviderSpec.parse(JSON.parse(readFileSync(join(FIXTURES, 'jira.json'), 'utf8'))))

  test('github pull request, issue (comment fragment) and repo', () => {
    assert.deepEqual(gh.parseUrl('https://github.com/acme/widgets/pull/42').map(m => [m.kind, m.ref, m.display]), [['change', 'acme/widgets#42', '#42']])
    assert.deepEqual(gh.parseUrl('https://github.com/acme/widgets/issues/7#issuecomment-1').map(m => [m.kind, m.ref]), [['issue', 'acme/widgets#7']])
    assert.deepEqual(gh.parseUrl('https://github.com/acme/widgets').map(m => [m.kind, m.ref]), [['repo', 'acme/widgets']])
    assert.deepEqual(gh.parseUrl('https://github.com/acme/widgets.git').map(m => m.ref), ['acme/widgets'])
    assert.deepEqual(gh.parseUrl('https://example.com/some/page'), [])
  })

  test('gitlab merge request with nested groups uses ! and "Merge request"', () => {
    const [m] = gl.parseUrl('https://gitlab.com/group/sub/proj/-/merge_requests/9')
    assert.equal(m!.ref, 'group/sub/proj!9')
    assert.equal(m!.display, '!9')
    assert.equal(gl.describe({ provider: 'gitlab', kind: 'change', ref: m!.ref }).noun, 'Merge request')
  })

  test('gitlab repo URLs (nested groups) never swallow /-/ URLs', () => {
    assert.deepEqual(gl.parseUrl('https://gitlab.com/group/sub/proj').map(m => [m.kind, m.ref]), [['repo', 'group/sub/proj']])
    assert.deepEqual(gl.parseUrl('https://gitlab.com/group/proj.git').map(m => m.ref), ['group/proj'])
    assert.deepEqual(gl.parseUrl('https://gitlab.com/group/proj/-/issues/3').map(m => m.kind), ['issue'])
    assert.deepEqual(gl.parseUrl('https://gitlab.com/group/proj/-/merge_requests/9').map(m => m.kind), ['change'])
    assert.deepEqual(gl.parseUrl('https://gitlab.com/onlyone'), [])
  })

  test('jira key with a query string', () => {
    assert.deepEqual(jira.parseUrl('https://acme.atlassian.net/browse/ABC-123?focusedCommentId=5').map(m => m.ref), ['ABC-123'])
  })

  test('refs rebuild the URL they came from', () => {
    const urls = [
      [gh, 'https://github.com/acme/widgets/pull/42'],
      [gh, 'https://github.com/acme/widgets/issues/7'],
      [gh, 'https://github.com/acme/widgets'],
      [gl, 'https://gitlab.com/group/sub/proj/-/merge_requests/9'],
      [gl, 'https://gitlab.com/group/sub/proj/-/issues/3'],
      [jira, 'https://acme.atlassian.net/browse/ABC-123'],
    ] as const
    for (const [provider, url] of urls) {
      const [m] = provider.parseUrl(url)
      const fields = provider.fieldsFromRef(m!.kind, m!.ref)!
      assert.equal(provider.buildUrl(m!.kind, fields, { host: new URL(url).host }), url, url)
    }
  })

  test('buildUrl returns undefined when a setting is missing, and uses it when given', () => {
    assert.equal(jira.buildUrl('issue', { key: 'ABC-1' }), undefined)
    assert.equal(jira.buildUrl('issue', { key: 'ABC-1' }, { settings: { host: 'acme.atlassian.net' } }), 'https://acme.atlassian.net/browse/ABC-1')
  })

  test('host claims: exact beats glob beats unrestricted, one DNS label per *', () => {
    assert.equal(gh.claims('GitHub.com'), 3)
    assert.equal(jira.claims('acme.atlassian.net'), 2)
    assert.equal(jira.claims('a.b.atlassian.net'), 0)
    assert.equal(gh.claims('gitlab.com'), 0)
    const open = createProvider(ProviderSpec.parse({ ...github, id: 'open', hosts: undefined }))
    assert.equal(open.claims('anything.example'), 1)
  })
})

describe('repo inference from git remotes', () => {
  const registry = builtinRegistry()
  const cases: [string, string | undefined][] = [
    ['git@github.com:acme/widgets.git', 'github:acme/widgets'],
    ['https://github.com/acme/widgets', 'github:acme/widgets'],
    ['ssh://git@gitlab.com/group/sub/proj.git', 'gitlab:group/sub/proj'],
    // hosts no provider claims fall back to the generic `git` provider
    ['git@gitlab.corp.example:team/app.git', 'git:team/app'],
    ['https://github.acme.com/team/app', 'git:team/app'],
    ['https://user:token@git.example.com/team/app.git', 'git:team/app'],
    ['git@ssh.dev.azure.com:v3/org/proj/repo', 'git:v3/org/proj/repo'],
  ]
  for (const [remote, expected] of cases) {
    test(remote, () => {
      const hit = registry.inferRepo(remote)
      assert.equal(hit && `${hit.provider.id}:${hit.ref}`, expected)
    })
  }

  test('the generic git provider never claims a pasted URL, only git remotes', () => {
    const git = builtinRegistry().get('git')!
    assert.deepEqual(git.parseUrl('https://example.com/some/page'), [])
    assert.deepEqual(git.parseUrl('https://github.com/acme/widgets'), [])
    assert.equal(git.buildUrl('repo', { repo: 'team/app' }, { host: 'git.example.com' }), 'https://git.example.com/team/app')
    assert.equal(git.describe({ provider: 'git', kind: 'repo', ref: 'team/app' }).noun, 'Repository')
  })

  test('a kind may omit match only for a repo kind in a provider with repo.remote', () => {
    const { match: _, ...noMatch } = github.kinds.repo
    assert.match(problems({ ...github, kinds: { issue: { ...github.kinds.issue, match: undefined } } }).join('\n'), /^kinds\.issue\.match: "match" is required/m)
    assert.match(problems({ ...github, repo: undefined, kinds: { repo: noMatch } }).join('\n'), /^kinds\.repo\.match: "match" is required unless the provider has repo\.remote/m)
    assert.deepEqual(problems({ ...github, kinds: { repo: noMatch } }), [])
  })

  test('an equally specific tie is not guessed', () => {
    const a = createProvider(ProviderSpec.parse({ ...github, id: 'a', hosts: ['git.example'] }))
    const b = createProvider(ProviderSpec.parse({ ...github, id: 'b', hosts: ['git.example'] }))
    assert.equal(createRegistry([a, b]).inferRepo('git@git.example:o/r.git'), undefined)
  })

  test('later providers replace earlier ones with the same id', () => {
    const override = createProvider(ProviderSpec.parse({ ...github, name: 'GitHub (mine)' }))
    assert.equal(createRegistry(builtinRegistry().providers, [override]).get('github')!.name, 'GitHub (mine)')
  })
})
