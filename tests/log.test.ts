import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'
import { buildLog, createCore, parseNotes, parseSince, resolveAuthor } from '../lib/core'
import { mockApi, runCli, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

// A content dir whose tasks carry notes in the old (no author) and new (author) format.
const content = join(scratch.dir, 'content')
function task(slug: string, fm: Record<string, string>, body: string) {
  const dir = join(content, 'projects/proj/tasks')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${slug}.md`), `---\n${Object.entries({ title: slug, status: 'todo', priority: 'medium', ...fm }).map(([k, v]) => `${k}: '${v}'`).join('\n')}\n---\n${body}\n`)
}
mkdirSync(join(content, 'projects/proj'), { recursive: true })
writeFileSync(join(content, 'projects/proj/index.md'), '---\ntitle: Proj\nstatus: active\n---\n')
task('alpha', { createdAt: '2026-09-01', updatedAt: '2026-10-01T10:05:00.000Z' }, 'Body text.\n\n---\n**Note** _(2026-10-01 10:05)_ by Claude\n\nFound the cause: a race in start-up.\nSecond line.\n\n---\n**Note** _(2026-09-30 08:00)_\n\nOld note without an author.')
task('beta', { createdAt: '2026-10-01', updatedAt: '2026-10-01T12:00:00.000Z', status: 'done' }, 'No notes here.')
task('gamma', { createdAt: '2026-08-15' }, '**Note** _(2026-09-15 09:30)_ by sam\n\nOnly note, no frontmatter-leading rule.')
const core = createCore({ contentPath: content, baseUrl: 'http://127.0.0.1:1' })

describe('note parsing', () => {
  it('reads authored and legacy notes with their text', () => {
    const notes = parseNotes(readBody('alpha'))
    assert.equal(notes.length, 2)
    assert.deepEqual([notes[0]!.at.toISOString(), notes[0]!.author], ['2026-10-01T10:05:00.000Z', 'Claude'])
    assert.match(notes[0]!.text, /^Found the cause[\s\S]*Second line\.$/)
    assert.deepEqual([notes[1]!.author, notes[1]!.text], [undefined, 'Old note without an author.'])
  })

  it('finds a note at the very start of a body', () => {
    assert.equal(parseNotes(readBody('gamma'))[0]!.author, 'sam')
  })

  it('ignores text that merely mentions a note', () => {
    assert.deepEqual(parseNotes('We should add a **Note** about this later.'), [])
  })
})

function readBody(slug: string) {
  return core.getTask('proj', slug).body
}

describe('buildLog', () => {
  const log = (opts = {}) => buildLog(core, { project: 'proj', ...opts })

  it('lists notes, creations, and updates newest first', () => {
    const entries = log()
    assert.deepEqual(entries.map(e => e.at), [...entries.map(e => e.at)].sort().reverse())
    assert.deepEqual(entries[0], { at: '2026-10-01T12:00:00.000Z', type: 'updated', project: 'proj', task: 'beta', title: 'beta', detail: 'done' })
  })

  it('folds the write behind a note into the note instead of duplicating it', () => {
    const alpha = log().filter(e => e.task === 'alpha')
    assert.equal(alpha.filter(e => e.type === 'updated').length, 0, 'updatedAt 10:05 matches the 10:05 note')
    assert.ok(alpha.some(e => e.type === 'note' && e.author === 'Claude' && e.detail === 'Found the cause: a race in start-up.'))
  })

  it('--since keeps only recent activity', () => {
    const entries = log({ since: new Date('2026-10-01T00:00:00Z') })
    assert.ok(entries.length > 0 && entries.every(e => e.at >= '2026-10-01'))
  })

  it('--author keeps only that author\'s notes, case-insensitively', () => {
    const entries = log({ author: 'CLAUDE' })
    assert.deepEqual(entries.map(e => [e.type, e.author, e.task]), [['note', 'Claude', 'alpha']])
  })

  it('--limit truncates', () => {
    assert.equal(log({ limit: 2 }).length, 2)
  })

  it('covers every project when none is given', () => {
    assert.ok(buildLog(core).length >= log().length)
  })
})

describe('ordering within a minute', () => {
  it('lists the later note in a task body first when timestamps tie', () => {
    const tieContent = join(scratch.dir, 'content-tie')
    mkdirSync(join(tieContent, 'projects/proj/tasks'), { recursive: true })
    writeFileSync(join(tieContent, 'projects/proj/index.md'), '---\ntitle: Proj\nstatus: active\n---\n')
    writeFileSync(join(tieContent, 'projects/proj/tasks/tie.md'), "---\ntitle: tie\nstatus: todo\npriority: medium\ncreatedAt: '2026-09-01'\n---\n**Note** _(2026-10-02 09:00)_ by a\n\nfirst\n\n---\n**Note** _(2026-10-02 09:00)_ by b\n\nsecond\n\n---\n**Note** _(2026-10-02 09:00)_ by c\n\nthird\n")
    const notes = buildLog(createCore({ contentPath: tieContent, baseUrl: 'http://127.0.0.1:1' }), { project: 'proj' }).filter(e => e.type === 'note')
    assert.deepEqual(notes.map(e => e.detail), ['third', 'second', 'first'])
  })
})

describe('parseSince', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  it('parses durations and dates, rejects garbage', () => {
    assert.equal(parseSince('30m', now)!.toISOString(), '2026-10-01T11:30:00.000Z')
    assert.equal(parseSince('2d', now)!.toISOString(), '2026-09-29T12:00:00.000Z')
    assert.equal(parseSince('1w', now)!.toISOString(), '2026-09-24T12:00:00.000Z')
    assert.equal(parseSince('2026-10-01')!.toISOString(), '2026-10-01T00:00:00.000Z')
    assert.equal(parseSince('yesterday-ish'), undefined)
  })
})

describe('resolveAuthor', () => {
  const repo = join(scratch.dir, 'repo')
  mkdirSync(repo)
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['config', 'user.name', 'Git Person'], { cwd: repo })

  it('prefers the flag, then MDPM_AUTHOR, then Claude Code, then git, then the OS user', () => {
    assert.equal(resolveAuthor({ flag: 'Flag', env: { MDPM_AUTHOR: 'Env', CLAUDECODE: '1' }, cwd: repo }), 'Flag')
    assert.equal(resolveAuthor({ env: { MDPM_AUTHOR: 'Env', CLAUDECODE: '1' }, cwd: repo }), 'Env')
    assert.equal(resolveAuthor({ env: { CLAUDECODE: '1' }, cwd: repo }), 'claude')
    assert.equal(resolveAuthor({ env: {}, cwd: repo }), 'Git Person')
    assert.ok(resolveAuthor({ env: {}, cwd: scratch.dir }).length > 0, 'falls back to the OS user outside a repo')
  })

  it('treats blank values as unset', () => {
    assert.equal(resolveAuthor({ flag: '  ', env: { MDPM_AUTHOR: '', CLAUDECODE: '' }, cwd: repo }), 'Git Person')
  })
})

describe('mdpm log CLI', () => {
  const cli = (args: string[], env: Record<string, string> = {}) => runCli(['log', ...args], { scratch: scratch.dir, env: { MDPM_CONTENT_PATH: content, ...env } })

  it('prints JSON entries for a project', async () => {
    const r = await cli(['--project', 'proj', '--json', '--limit', '3'])
    assert.equal(r.code, 0, r.stderr)
    assert.equal(r.json.length, 3)
    assert.equal(r.json[0].task, 'beta')
  })

  it('human output has a header and a count', async () => {
    const r = await cli(['--project', 'proj', '--author', 'sam'])
    assert.match(r.stdout, /WHEN \(UTC\)\s+TYPE\s+TASK\s+BY\s+DETAIL/)
    assert.match(r.stdout, /1 entry/)
  })

  it('rejects bad --since and --limit with exit 2', async () => {
    assert.equal((await cli(['--since', 'soonish'])).code, 2)
    assert.equal((await cli(['--limit', '0'])).code, 2)
  })

  it('exit 4 for an unknown project', async () => {
    assert.equal((await cli(['--project', 'nope'])).code, 4)
  })
})

describe('authors on written notes', () => {
  it('task note stamps the resolved author, with --author winning', async () => {
    const api = await mockApi()
    try {
      const run = (args: string[], env: Record<string, string>) => runCli(['task', 'note', 'write-parser', 'a note', '--project', 'alpha', ...args], { scratch: scratch.dir, env: { MDPM_BASE_URL: api.url, CLAUDECODE: '', ...env } })
      await run([], { MDPM_AUTHOR: 'EnvAuthor' })
      assert.match(api.requests.at(-1)!.body.description, /_ by EnvAuthor\n\na note$/)
      await run(['--author', 'Flagged'], { MDPM_AUTHOR: 'EnvAuthor' })
      assert.match(api.requests.at(-1)!.body.description, /_ by Flagged\n\na note$/)
      await run([], { CLAUDECODE: '1', MDPM_AUTHOR: '' })
      assert.match(api.requests.at(-1)!.body.description, /_ by claude\n\na note$/)
    }
    finally {
      await api.close()
    }
  })
})
