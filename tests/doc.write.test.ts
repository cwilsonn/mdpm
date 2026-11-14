import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, beforeEach, describe, it } from 'node:test'
import { changedContent, readContent, REPO, resetContent, runCli, scratchDir, snapshotContent } from './helpers'

// Doc writes go straight to the files; these check the scratch copy of the fixtures.
const scratch = scratchDir()
after(scratch.cleanup)
let before: Map<string, string>
beforeEach(() => { resetContent(scratch.dir); before = snapshotContent(scratch.dir) })

const EDITOR = `node ${join(REPO, 'tests/fixtures/fake-editor.mjs')}`
const cli = (args: string[], env: Record<string, string> = {}, input?: string) =>
  runCli(args, { scratch: scratch.dir, env, input })
const written = () => changedContent(scratch.dir, before)
const doc = (rel: string) => readContent(scratch.dir, rel)
const arch = () => doc('projects/alpha/docs/architecture.md')

describe('doc create', () => {
  it('creates a project doc with body, tags, and a resolved parent', async () => {
    const r = await cli(['doc', 'create', 'Release notes', '--project', 'alpha', '--body', 'hello', '--tags', 'a,b', '--parent', 'arch', '--json'])
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json, { project: 'alpha', slug: 'release-notes' })
    assert.deepEqual(written(), ['projects/alpha/docs/release-notes.md'])
    const d = doc('projects/alpha/docs/release-notes.md')!
    assert.deepEqual([d.data.title, d.data.tags, d.data.parent, d.body], ['Release notes', ['a', 'b'], 'architecture', 'hello'])
  })

  it('creates a standalone doc and reads the body from stdin', async () => {
    const r = await cli(['doc', 'create', 'Guide', '--standalone', '--body', '-'], {}, 'from stdin\n')
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(written(), ['docs/guide.md'])
    assert.equal(doc('docs/guide.md')!.body, 'from stdin')
  })

  it('--edit composes the body in $EDITOR', async () => {
    const r = await cli(['doc', 'create', 'Composed', '--project', 'alpha', '--edit'], { EDITOR, FAKE_EDITOR_APPEND: 'typed in the editor\n' })
    assert.equal(r.code, 0, r.stderr)
    assert.equal(doc('projects/alpha/docs/composed.md')!.body, 'typed in the editor')
  })

  it('needs a scope when it cannot infer a project', async () => {
    const r = await cli(['doc', 'create', 'Nowhere'])
    assert.equal(r.code, 2)
    assert.match(r.stderr, /--project or --standalone/)
    assert.deepEqual(written(), [])
  })

  it('rejects an unknown parent before writing anything', async () => {
    const r = await cli(['doc', 'create', 'Orphan', '--project', 'alpha', '--parent', 'zzz-nope'])
    assert.equal(r.code, 4)
    assert.deepEqual(written(), [])
  })
})

describe('doc edit', () => {
  it('opens the current body in $EDITOR and writes the change', async () => {
    const log = join(scratch.dir, 'seen-body.txt')
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--json'], { EDITOR, FAKE_EDITOR_LOG: log, FAKE_EDITOR_APPEND: '\nAdded line.\n' })
    assert.equal(r.code, 0, r.stderr)
    assert.match(readFileSync(log, 'utf8'), /^## Stack/, 'the editor starts from the existing body')
    assert.match(arch()!.body, /## Stack[\s\S]*Added line\.$/)
    assert.deepEqual(r.json.updated, ['body'])
  })

  it('writes nothing when the editor leaves the body unchanged', async () => {
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--json'], { EDITOR })
    assert.equal(r.code, 0, r.stderr)
    assert.deepEqual(r.json.updated, [])
    assert.deepEqual(written(), [])
  })

  it('saves nothing and fails when the editor exits non-zero', async () => {
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha'], { EDITOR, FAKE_EDITOR_APPEND: 'x', FAKE_EDITOR_EXIT: '3' })
    assert.equal(r.code, 1)
    assert.match(r.stderr, /editor exited with 3/)
    assert.deepEqual(written(), [])
  })

  it('--body replaces the body without an editor (stdin works too)', async () => {
    await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--body', '-'], {}, 'scripted body\n')
    assert.equal(arch()!.body, 'scripted body')
  })

  it('changes metadata with flags: title, tags, parent, and parent none', async () => {
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha', '--title', 'Renamed', '--tags', 'x,y', '--parent', 'none'])
    assert.equal(r.code, 0, r.stderr)
    const d = arch()!
    assert.deepEqual([d.data.title, d.data.tags, d.data.parent], ['Renamed', ['x', 'y'], undefined])
  })

  it('edits a standalone doc', async () => {
    await cli(['doc', 'edit', 'standalone-guide', '--standalone', '--body', 'new'])
    assert.deepEqual(written(), ['docs/standalone-guide.md'])
    assert.equal(doc('docs/standalone-guide.md')!.body, 'new')
  })

  it('without an editor configured and no terminal, explains the alternatives', async () => {
    const r = await cli(['doc', 'edit', 'architecture', '--project', 'alpha'], { EDITOR: '', VISUAL: '' })
    assert.equal(r.code, 2)
    assert.match(r.stderr, /set \$EDITOR/)
    assert.match(r.stderr, /--body/)
  })

  it('exit 4 for an unknown doc', async () => {
    assert.equal((await cli(['doc', 'edit', 'zzz-nope', '--project', 'alpha', '--body', 'x'])).code, 4)
  })
})

describe('doc archive / unarchive / delete', () => {
  it('archive and unarchive toggle archivedAt', async () => {
    await cli(['doc', 'archive', 'architecture', '--project', 'alpha'])
    assert.match(arch()!.data.archivedAt, /^\d{4}-/)
    await cli(['doc', 'unarchive', 'old-folder', '--project', 'alpha'])
    assert.equal(doc('projects/alpha/docs/old-folder.md')!.data.archivedAt, undefined)
  })

  it('archives a standalone doc', async () => {
    await cli(['doc', 'archive', 'standalone-guide', '--standalone'])
    assert.match(doc('docs/standalone-guide.md')!.data.archivedAt, /^\d{4}-/)
  })

  it('delete needs --yes without a terminal, then deletes', async () => {
    const refused = await cli(['doc', 'delete', 'architecture', '--project', 'alpha'])
    assert.equal(refused.code, 2)
    assert.deepEqual(written(), [])
    assert.equal((await cli(['doc', 'delete', 'architecture', '--project', 'alpha', '--yes'])).code, 0)
    assert.equal(arch(), undefined)
    await cli(['doc', 'delete', 'standalone-guide', '--standalone', '--yes'])
    assert.equal(doc('docs/standalone-guide.md'), undefined)
  })
})
