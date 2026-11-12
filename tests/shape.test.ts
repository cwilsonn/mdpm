import { strict as assert } from 'node:assert'
import { after, describe, it } from 'node:test'
import { pageFooter, paginate, parseFields, shapeDoc, shapeTask, splitNotes, taskRow, toTsv, truncateChars } from '../lib/core'
import { runCli, scratchDir } from './helpers'

const note = (day: string, text: string, by = 'claude') => `**Note** _(2026-10-${day} 10:00)_ by ${by}\n\n${text}`
const bodyWith = (spec: string, notes: string[]) => [spec, ...notes].join('\n\n---\n')

describe('paginate', () => {
  const rows = Array.from({ length: 45 }, (_, i) => i)
  it('defaults to 20 and reports the next offset', () => {
    const p = paginate(rows)
    assert.deepEqual([p.returned, p.total, p.nextOffset], [20, 45, 20])
  })
  it('walks to the last page, and 0 means everything', () => {
    assert.equal(paginate(rows, { offset: 40 }).nextOffset, null)
    assert.equal(paginate(rows, { limit: 0 }).returned, 45)
    assert.equal(paginate(rows, { offset: 99 }).returned, 0)
  })
  it('footer says what is hidden and how to get it', () => {
    assert.match(pageFooter(paginate(rows), 'task'), /20 of 45 tasks shown.*--offset 20.*--limit 0/)
    assert.equal(pageFooter(paginate([1]), 'task'), '1 task')
  })
})

describe('fields and tsv', () => {
  it('rejects unknown fields, expands *', () => {
    assert.throws(() => parseFields('slug,nope', ['slug', 'title'], ['slug']), /unknown field: nope/)
    assert.deepEqual(parseFields('*', ['slug', 'title'], ['slug']), ['slug', 'title'])
    assert.deepEqual(parseFields(undefined, ['slug', 'title'], ['slug']), ['slug'])
  })
  it('prints the header once and flattens arrays, tabs and newlines', () => {
    assert.equal(toTsv([{ a: 'x\ty', b: ['p', 'q'], c: 'l1\nl2', d: null }], ['a', 'b', 'c', 'd']), 'a\tb\tc\td\nx y\tp,q\tl1 l2\t')
  })
})

describe('truncateChars', () => {
  it('cuts, reports the total, and continues from an offset', () => {
    const t = truncateChars('abcdefghij', 4)
    assert.deepEqual([t.text, t.truncated, t.total, t.nextOffset], ['abcd', true, 10, 4])
    assert.equal(truncateChars('abcdefghij', 4, 8).text, 'ij')
    assert.equal(truncateChars('abc', 0).truncated, false)
  })
})

describe('task bodies: spec versus notes', () => {
  const notes = [1, 2, 3, 4, 5].map(i => note(String(10 + i), `note number ${i}`))
  const body = bodyWith('Spec line one.\n\nMore spec.', notes)

  it('splits the spec from the appended notes', () => {
    const { spec, notes: parsed } = splitNotes(body)
    assert.equal(spec, 'Spec line one.\n\nMore spec.')
    assert.equal(parsed.length, 5)
  })

  it('a body with no notes is all spec; a body that starts with a note has an empty spec', () => {
    assert.equal(splitNotes('Just a spec').spec, 'Just a spec')
    assert.equal(splitNotes(note('11', 'only')).spec, '')
  })

  it('keeps the spec and the newest 3 notes, says how many are hidden', () => {
    const s = shapeTask({ body }, {})
    assert.equal(s.truncated, true)
    assert.equal(s.olderNotes, 2)
    assert.match(s.body, /Spec line one/)
    assert.match(s.body, /note number 5/)
    assert.doesNotMatch(s.body, /note number 1\b/)
    assert.match(s.note!, /full/)
  })

  it('full returns the body untouched', () => {
    assert.equal(shapeTask({ body }, { full: true }).body, body)
  })

  it('caps a long spec and a long note', () => {
    const s = shapeTask({ body: bodyWith('x'.repeat(500), [note('11', 'y'.repeat(2000))]) }, { maxChars: 100 })
    assert.ok(s.body.length < 900)
    assert.equal(s.truncated, true)
  })

  it('a short task is not marked truncated', () => {
    const s = shapeTask({ body: bodyWith('short', [note('11', 'one')]) })
    assert.equal(s.truncated, false)
    assert.equal(s.olderNotes, undefined)
  })

  it('a list row has no body but a one-line summary and a note count', () => {
    const row = taskRow({ slug: 'a', body }, 'note number 3')
    assert.equal('body' in row, false)
    assert.equal(row.summary, 'Spec line one.')
    assert.equal(row.noteCount, 5)
    assert.equal(row.match, 'note number 3')
  })
})

describe('shapeDoc', () => {
  it('is unchanged when short and pageable when long', () => {
    assert.equal(shapeDoc({ body: 'short' }).truncated, false)
    const long = shapeDoc({ body: 'a'.repeat(100) }, { maxChars: 30 })
    assert.deepEqual([long.body.length, long.truncated, long.nextOffset, long.totalChars], [30, true, 30, 100])
  })
})

describe('CLI list caps', () => {
  const scratch = scratchDir()
  after(scratch.cleanup)
  const cli = (args: string[]) => runCli(args, { scratch: scratch.dir })

  it('task list --limit pages, with the footer on stderr for --json', async () => {
    const r = await cli(['task', 'list', '--project', 'alpha', '--limit', '2', '--json'])
    assert.equal(r.code, 0)
    assert.equal(r.json.length, 2)
    assert.match(r.stderr, /2 of 7 tasks shown.*--offset 2/)
    assert.deepEqual(Object.keys(r.json[0]), ['project', 'slug', 'title', 'status', 'priority', 'tags', 'assignees', 'due', 'updatedAt'])
  })

  it('--fields picks columns, --tsv prints a header and rows', async () => {
    const r = await cli(['task', 'list', '--project', 'alpha', '--fields', 'slug,status', '--tsv'])
    const lines = r.stdout.trim().split('\n')
    assert.equal(lines[0], 'slug\tstatus')
    assert.equal(lines.length, 8)
  })

  it('--limit 0 lists everything; a bad field or limit is a usage error', async () => {
    assert.equal((await cli(['task', 'list', '--project', 'alpha', '--limit', '0', '--json'])).json.length, 7)
    assert.equal((await cli(['task', 'list', '--project', 'alpha', '--fields', 'nope'])).code, 2)
    assert.equal((await cli(['task', 'list', '--project', 'alpha', '--limit', 'x'])).code, 2)
  })

  it('task search --json carries a match column, not bodies', async () => {
    const r = await cli(['task', 'search', 'parser', '--project', 'alpha', '--json'])
    assert.ok(r.json.length > 0)
    assert.equal('body' in r.json[0], false)
    assert.ok('match' in r.json[0])
  })

  it('doc show cuts a long body with a stderr note; --full returns it all', async () => {
    const cut = await cli(['doc', 'show', 'architecture', '--project', 'alpha', '--max-chars', '10'])
    assert.equal(cut.stdout.trim().length <= 10, true)
    assert.match(cut.stderr, /body cut at 10 of \d+ chars/)
    const full = await cli(['doc', 'show', 'architecture', '--project', 'alpha', '--full'])
    assert.ok(full.stdout.length > cut.stdout.length)
    assert.doesNotMatch(full.stderr, /body cut/)
  })
})
