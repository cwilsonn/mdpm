import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { checkStaleness, citedHashes, createGitRepo, defaultBranch, type CommitSource } from '../lib/core'
import { runCli, scratchDir } from './helpers'

const sha = (c: string) => c.repeat(20)
const note = (text: string) => ({ at: new Date(), text })
const task = (slug: string, status: string, text: string) => ({ project: 'p', slug, title: slug, status, body: '', notes: [note(text)] })

// Branch: a1a1… "feat: one", b2b2… "fix: two". Off the branch: c3c3… "fix: two" (pre-rebase twin of b2b2…),
// d4d4… "feat: never merged".
const stub: CommitSource = {
  branch: 'main',
  branchCommits: () => [{ sha: sha('b2'), subject: 'fix: two' }, { sha: sha('a1'), subject: 'feat: one' }],
  resolve(abbrevs) {
    const known = [{ sha: sha('a1'), subject: 'feat: one' }, { sha: sha('b2'), subject: 'fix: two' }, { sha: sha('c3'), subject: 'fix: two' }, { sha: sha('d4'), subject: 'feat: never merged' }]
    return new Map(abbrevs.flatMap((a) => {
      const hit = known.find(k => k.sha.startsWith(a))
      return hit ? [[a, hit] as const] : []
    }))
  },
}

describe('citedHashes', () => {
  it('finds standalone hex runs with a digit and a letter', () => {
    assert.deepEqual(citedHashes('main d37b26d, e1f7657; see https://github.com/o/r/commit/04735f1ab3076f218b7b173e969fbe7c1dd5f688'), ['d37b26d', 'e1f7657', '04735f1ab3076f218b7b173e969fbe7c1dd5f688'])
  })

  it('ignores words, numbers, slugs and short runs', () => {
    assert.deepEqual(citedHashes('a decade defaced; 20261115; task-abc1234 abc1234-x; 1a2b3c; ab12cd3_'), [])
  })
})

describe('checkStaleness', () => {
  it('flags an open task whose cited commit is on the branch', () => {
    const [f] = checkStaleness([task('t', 'todo', 'did it in a1a1a1a')], stub)
    assert.deepEqual([f!.kind, f!.cited, f!.onBranch], ['landed', ['a1a1a1a'], ['a1a1a1a']])
  })

  it('maps a pre-rebase SHA to the branch commit with the same subject', () => {
    const findings = checkStaleness([task('t', 'done', 'PR merged: c3c3c3c')], stub)
    assert.deepEqual(findings.map(f => [f.kind, f.cited, f.onBranch]), [['rewritten', ['c3c3c3c'], ['b2b2b2b']]])
  })

  it('does not flag a pre-rebase SHA cited next to its landed twin', () => {
    assert.deepEqual(checkStaleness([task('t', 'done', 'branch c3c3c3c, merged as b2b2b2b')], stub), [])
  })

  it('counts a rewritten commit as landed for an open task', () => {
    assert.deepEqual(checkStaleness([task('t', 'in-review', 'c3c3c3c')], stub).map(f => f.kind), ['landed', 'rewritten'])
  })

  it('flags a done task none of whose commits reached the branch', () => {
    const [f] = checkStaleness([task('t', 'done', 'commit d4d4d4d')], stub)
    assert.deepEqual([f!.kind, f!.cited], ['unverified', ['d4d4d4d']])
  })

  it('stays quiet for consistent claims and for hashes that are not commits here', () => {
    const quiet = [
      task('done-ok', 'done', 'landed as a1a1a1a (branch d4d4d4d)'),
      task('wip', 'in-progress', 'pushed d4d4d4d'),
      task('pin', 'done', 'pinned actions/checkout@1e2f3a4b'),
    ]
    assert.deepEqual(checkStaleness(quiet, stub), [])
  })
})

describe('against a real repository', () => {
  const scratch = scratchDir()
  const repo = join(scratch.dir, 'checkout')
  const g = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-C', repo, ...args], { encoding: 'utf8' }).trim()
  const commit = (subject: string) => {
    writeFileSync(join(repo, 'f'), subject)
    g('add', 'f')
    g('commit', '-q', '-m', subject)
    return g('rev-parse', 'HEAD')
  }
  let landed: string, branchOnly: string, rewritten: string
  before(() => {
    mkdirSync(repo)
    g('init', '-q', '-b', 'main')
    landed = commit('feat: landed')
    g('switch', '-q', '-c', 'topic')
    rewritten = commit('fix: rebased later')
    branchOnly = commit('feat: abandoned')
    g('switch', '-q', 'main')
    commit('chore: unrelated')
    commit('fix: rebased later')
  })
  after(() => scratch.cleanup())

  it('resolves cited hashes and reports through createGitRepo', () => {
    assert.equal(defaultBranch(repo), 'main')
    const git = createGitRepo(repo, 'main')
    const findings = checkStaleness([
      task('open', 'todo', `landed in ${landed.slice(0, 7)}`),
      task('old-sha', 'done', `see ${rewritten.slice(0, 9)}`),
      task('lost', 'done', `see ${branchOnly.slice(0, 7)} and deadbee1`),
    ], git)
    assert.deepEqual(findings.map(f => [f.kind, f.slug]), [['landed', 'open'], ['unverified', 'lost'], ['rewritten', 'old-sha']])
    assert.equal(findings[2]!.onBranch[0], g('rev-parse', '--short=7', 'main'))
  })

  it('mdpm task stale reports for a project against --repo', async () => {
    const cli = (args: string[]) => runCli(args, { scratch: scratch.dir })
    await cli(['task', 'note', 'alpha/fix-login-bug', `shipped in ${landed.slice(0, 7)}`, '--project', 'alpha'])
    const r = await cli(['task', 'stale', '--project', 'alpha', '--repo', repo, '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.json.branch, 'main')
    assert.deepEqual(r.json.findings.map((f: any) => [f.kind, f.slug]), [['landed', 'fix-login-bug']])

    const bad = await cli(['task', 'stale', '--project', 'alpha', '--repo', repo, '--kind', 'nope'])
    assert.equal(bad.code, 2)
  })

  it('refuses a checkout that belongs to another project', async () => {
    const r = await runCli(['task', 'stale', '--project', 'beta'], { scratch: scratch.dir, cwd: repo })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /not a registered project|not 'beta'/)
  })
})
