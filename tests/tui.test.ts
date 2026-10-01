import { strict as assert } from 'node:assert'
import { spawn, spawnSync } from 'node:child_process'
import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'
import { parseKeys, type Key } from '../cli/tui/keys'
import { fit, renderScreen, wrap } from '../cli/tui/render'
import { columns, initialState, selectedTask, update, withMessage, withProjects, withTasks, type Effect, type TuiState, type TuiTask } from '../cli/tui/state'
import { FIXTURE_CONTENT, isolatedEnv, mockApi, REPO, scratchDir } from './helpers'

const scratch = scratchDir()
after(scratch.cleanup)

const strip = (s: string) => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
const t = (slug: string, status: string, over: Partial<TuiTask> = {}): TuiTask => ({
  project: 'p', slug, title: `Title of ${slug}`, status, priority: 'medium', tags: [], assignees: [], due: null, dependencies: [], body: '', order: 0, ...over,
})
const board = (tasks: TuiTask[]) => initialState('p', 'Project P', tasks)
const press = (state: TuiState, ...names: string[]): [TuiState, Effect | undefined] => {
  let effect: Effect | undefined
  for (const name of names) {
    const keys = name === '\t' ? [{ name: 'tab' } as Key] : name.length === 1 ? [{ name: 'char', char: name } as Key] : parseKeys(name === 'enter' ? '\r' : name === 'esc' ? '\x1b' : name === 'up' ? '\x1b[A' : name === 'down' ? '\x1b[B' : name === 'left' ? '\x1b[D' : name === 'right' ? '\x1b[C' : name === 'backspace' ? '\x7f' : name)
    for (const key of keys) [state, effect] = update(state, key)
  }
  return [state, effect]
}

describe('key parsing', () => {
  it('reads arrows, enter, escape, backspace, tab, ctrl-c, and plain characters', () => {
    assert.deepEqual(parseKeys('\x1b[A\x1b[B\x1b[C\x1b[D').map(k => k.name), ['up', 'down', 'right', 'left'])
    assert.deepEqual(parseKeys('\x1bOA').map(k => k.name), ['up'])
    assert.deepEqual(parseKeys('\r\x1b\x7f\t\x03').map(k => k.name), ['enter', 'escape', 'backspace', 'tab', 'ctrl-c'])
    assert.deepEqual(parseKeys('hi'), [{ name: 'char', char: 'h' }, { name: 'char', char: 'i' }])
  })

  it('handles several keys in one chunk, emoji, and swallows unknown escape sequences', () => {
    assert.deepEqual(parseKeys('j\x1b[Bk').map(k => k.char ?? k.name), ['j', 'down', 'k'])
    assert.deepEqual(parseKeys('🚀x').map(k => k.char), ['🚀', 'x'])
    assert.deepEqual(parseKeys('\x1b[15~\x1b[<0;10;5Mq').map(k => k.char ?? k.name), ['q'], 'function keys and mouse reports are not typed text')
  })
})

describe('columns', () => {
  it('always has the four core columns, adds blocked and on-hold only when used, and sorts by order', () => {
    assert.deepEqual(columns(board([])).map(c => c.status), ['todo', 'in-progress', 'in-review', 'done'])
    const s = board([t('a', 'blocked', { order: 2 }), t('b', 'todo', { order: 5 }), t('c', 'todo', { order: 1 })])
    assert.deepEqual(columns(s).map(c => c.status), ['todo', 'in-progress', 'in-review', 'blocked', 'done'])
    assert.deepEqual(columns(s)[0]!.tasks.map(x => x.slug), ['c', 'b'])
  })

  it('filters by title, slug, status, priority, tags, and assignees (case-insensitive)', () => {
    const s = { ...board([t('a', 'todo', { tags: ['Backend'] }), t('b', 'todo', { assignees: ['sam'] }), t('zeta', 'todo')]), filter: 'BACK' }
    assert.deepEqual(columns(s)[0]!.tasks.map(x => x.slug), ['a'])
    assert.deepEqual(columns({ ...s, filter: 'sam' })[0]!.tasks.map(x => x.slug), ['b'])
    assert.deepEqual(columns({ ...s, filter: 'zet' })[0]!.tasks.map(x => x.slug), ['zeta'])
  })
})

describe('navigation', () => {
  const s0 = board([t('a', 'todo', { order: 1 }), t('b', 'todo', { order: 2 }), t('c', 'in-progress'), t('d', 'done')])

  it('moves between cards and columns, clamping at the edges, with vim keys too', () => {
    let [s] = press(s0, 'down', 'down', 'down')
    assert.deepEqual([s.col, s.row], [0, 1], 'stops on the last card')
    ;[s] = press(s, 'up', 'up', 'k')
    assert.equal(s.row, 0)
    ;[s] = press(s, 'right')
    assert.deepEqual([s.col, selectedTask(s)?.slug], [1, 'c'])
    ;[s] = press(s, 'l', 'l', 'l', 'l')
    assert.equal(s.col, 3)
    ;[s] = press(s, 'h', 'left')
    assert.equal(s.col, 1)
  })

  it('keeps the row inside a shorter column and supports g / G', () => {
    let [s] = press(s0, 'down', 'right')
    assert.deepEqual([s.col, s.row], [1, 0], 'column two has one card')
    ;[s] = press({ ...s0 }, 'G')
    assert.equal(s.row, 1)
    ;[s] = press(s, 'g')
    assert.equal(s.row, 0)
  })

  it('tab goes to the next column', () => {
    assert.equal(press(s0, '\t')[0].col, 1)
  })
})

describe('actions', () => {
  const s0 = board([t('a', 'todo', { order: 1, priority: 'medium' }), t('b', 'in-progress'), t('c', 'done')])

  it('H and L ask to move the card one column left or right, and refuse at the ends', () => {
    const [, right] = press(s0, 'L')
    assert.deepEqual([right?.type, (right as any).status, (right as any).task.slug], ['move', 'in-progress', 'a'])
    const [left, none] = press(s0, 'H')
    assert.equal(none, undefined)
    assert.match(left.message!.text, /first column/)
    const [at, last] = press({ ...s0, col: 3, row: 0 }, 'L')
    assert.equal(last, undefined)
    assert.match(at.message!.text, /last column/)
    assert.equal((press(s0, '>')[1] as any).status, 'in-progress')
  })

  it('d marks the card done, unless it already is', () => {
    assert.deepEqual([press(s0, 'd')[1]?.type, (press(s0, 'd')[1] as any).status], ['move', 'done'])
    const [s, effect] = press({ ...s0, col: 3 }, 'd')
    assert.equal(effect, undefined)
    assert.match(s.message!.text, /already done/)
  })

  it('+ and - change priority within its range', () => {
    assert.equal((press(s0, '+')[1] as any).priority, 'high')
    assert.equal((press(s0, '-')[1] as any).priority, 'low')
    const urgent = board([t('a', 'todo', { priority: 'urgent' })])
    assert.equal(press(urgent, '+')[1], undefined)
    assert.match(press(urgent, '+')[0].message!.text, /already urgent/)
  })

  it('nothing happens to a card when no card is selected', () => {
    const empty = board([])
    for (const k of ['d', 'L', 'n', '+', 'enter']) assert.equal(press(empty, k)[1], undefined, k)
  })

  it('q and ctrl-c quit; ? opens help and any key closes it', () => {
    assert.equal(press(s0, 'q')[1]?.type, 'quit')
    assert.equal(update(s0, { name: 'ctrl-c' })[1]?.type, 'quit')
    const [help] = press(s0, '?')
    assert.equal(help.mode, 'help')
    assert.equal(press(help, 'x')[0].mode, 'board')
  })

  it('r reloads', () => {
    assert.equal(press(s0, 'r')[1]?.type, 'reload')
  })
})

describe('prompts', () => {
  const s0 = board([t('a', 'todo'), t('b', 'in-progress')])

  it('n opens a note prompt; typing, backspace, and enter produce a note effect for the selected card', () => {
    let [s] = press(s0, 'n')
    assert.equal(s.mode, 'prompt')
    ;[s] = press(s, 'h', 'i', '!', 'backspace', 'enter')
    const [back, effect] = press(update(update(update(s0, { name: 'char', char: 'n' })[0], { name: 'char', char: 'o' })[0], { name: 'char', char: 'k' })[0], 'enter')
    assert.deepEqual([effect?.type, (effect as any).text, (effect as any).task.slug], ['note', 'ok', 'a'])
    assert.equal(back.mode, 'board')
  })

  it('Esc cancels, and an empty note sends nothing', () => {
    const [s] = press(s0, 'n', 'x', 'esc')
    assert.deepEqual([s.mode, s.prompt], ['board', undefined])
    assert.equal(press(s0, 'n', 'enter')[1], undefined)
  })

  it('a adds a task in the current column', () => {
    const [, effect] = press(s0, 'right', 'a', 'N', 'e', 'w', 'enter')
    assert.deepEqual(effect, { type: 'add', title: 'New', status: 'in-progress' })
  })

  it('/ filters live, keeps the filter after enter, and Esc on the board clears it', () => {
    const [s] = press(s0, '/', 'b', 'enter')
    assert.equal(s.filter, 'b')
    assert.deepEqual(columns(s).flatMap(c => c.tasks.map(x => x.slug)), ['b'])
    assert.equal(press(s, 'esc')[0].filter, '')
  })

  it('ctrl-u clears the prompt text', () => {
    const [s] = press(s0, 'a', 'x', 'y')
    assert.equal(update(s, { name: 'ctrl-u' })[0].prompt!.text, '')
  })
})

describe('detail view and project picker', () => {
  it('enter opens the card, j/k scroll, and Esc returns', () => {
    const s0 = board([t('a', 'todo', { body: 'x' })])
    let [s] = press(s0, 'enter')
    assert.equal(s.mode, 'detail')
    ;[s] = press(s, 'j', 'j', 'k')
    assert.equal(s.detailScroll, 1)
    assert.equal(press(s, 'esc')[0].mode, 'board')
  })

  it('p opens the picker, which starts on the current project and switches on enter', () => {
    const s0 = board([t('a', 'todo')])
    const [picking, effect] = press(s0, 'p')
    assert.deepEqual([picking.mode, effect?.type], ['picker', 'projects'])
    let s = withProjects(picking, [{ slug: 'o', title: 'Other' }, { slug: 'p', title: 'Project P' }, { slug: 'z', title: 'Zed' }])
    assert.equal(s.picker!.index, 1)
    ;[s] = press(s, 'down')
    const [, sw] = press(s, 'enter')
    assert.deepEqual(sw, { type: 'switch', project: 'z' })
  })

  it('with no project yet, Esc in the picker quits rather than showing an empty board', () => {
    const s = { ...initialState('', '', []), mode: 'picker' as const, picker: { projects: [{ slug: 'a', title: 'A' }], index: 0 } }
    assert.equal(press(s, 'esc')[1]?.type, 'quit')
  })
})

describe('reloading', () => {
  it('keeps the cursor on the same card when it moves to another column', () => {
    const s0 = { ...board([t('a', 'todo'), t('b', 'todo', { order: 2 })]), row: 1 }
    const next = withTasks(s0, [t('a', 'todo'), t('b', 'in-progress', { order: 2 })])
    assert.deepEqual([next.col, next.row, selectedTask(next)?.slug], [1, 0, 'b'])
  })

  it('clamps the cursor when the selected card disappears', () => {
    const s0 = { ...board([t('a', 'todo'), t('b', 'todo', { order: 2 })]), row: 1 }
    const next = withTasks(s0, [t('a', 'todo')])
    assert.equal(next.row, 0)
  })

  it('messages can be set and are cleared by the next key', () => {
    const s = withMessage(board([t('a', 'todo')]), 'saved')
    assert.equal(s.message?.text, 'saved')
    assert.equal(press(s, 'j')[0].message, undefined)
  })
})

describe('rendering', () => {
  const size = { columns: 100, rows: 30 }
  const tasks = [t('a', 'todo', { priority: 'urgent', order: 1 }), t('b', 'todo', { order: 2, dependencies: ['a'] }), t('c', 'in-progress'), t('d', 'done', { priority: 'low' })]
  const lines = (s: TuiState, sz = size) => renderScreen(s, sz)

  it('always produces exactly `rows` lines, each fitting the width', () => {
    for (const sz of [{ columns: 100, rows: 30 }, { columns: 40, rows: 12 }, { columns: 20, rows: 6 }, { columns: 200, rows: 60 }]) {
      for (const s of [board(tasks), board([]), { ...board(tasks), mode: 'help' as const }, { ...board(tasks), mode: 'detail' as const }, { ...board(tasks), mode: 'picker' as const, picker: { projects: [{ slug: 'p', title: 'P' }], index: 0 } }]) {
        const out = lines(s, sz)
        assert.equal(out.length, Math.max(6, sz.rows), `${s.mode} at ${sz.columns}x${sz.rows}`)
        for (const l of out) assert.ok([...strip(l)].length <= Math.max(20, sz.columns), `a line is wider than ${sz.columns}: ${strip(l)}`)
      }
    }
  })

  it('shows the project, column headers with counts, cards, and key hints', () => {
    const text = lines(board(tasks)).map(strip).join('\n')
    assert.match(text, /Project P\s+4 tasks/)
    assert.match(text, /TODO \(2\)\s+IN PROGRESS \(1\)\s+IN REVIEW \(0\)\s+DONE \(1\)/)
    assert.match(text, /!\s?Title of a/)
    assert.match(text, /~Title of b/, 'a card that waits on another is marked')
    assert.match(text, /H\/L move/)
  })

  it('highlights exactly the selected card', () => {
    const out = lines({ ...board(tasks), col: 0, row: 1 })
    const reversed = out.filter(l => l.includes('\x1b[7m') && strip(l).includes('Title of'))
    assert.equal(reversed.length, 1)
    assert.match(strip(reversed[0]!), /Title of b/)
  })

  it('shows the selected card in the detail pane', () => {
    const s = { ...board([t('a', 'todo', { tags: ['x', 'y'], assignees: ['sam'], due: '2026-12-01', body: 'The full description goes here.' })]) }
    const text = lines(s).map(strip).join('\n')
    assert.match(text, /todo · medium · x, y · @sam · due 2026-12-01/)
    assert.match(text, /The full description goes here\./)
  })

  it('shows prompts, messages, the filter, and empty states', () => {
    assert.match(lines({ ...board(tasks), mode: 'prompt', prompt: { kind: 'note', text: 'hello' } }).map(strip).at(-1)!, /Note: hello/)
    assert.match(lines(withMessage(board(tasks), 'it worked')).map(strip).at(-1)!, /it worked/)
    assert.match(lines({ ...board(tasks), filter: 'zzz' }).map(strip)[0]!, /filter: zzz/)
    assert.match(lines(board([])).map(strip).join('\n'), /No tasks yet\. Press a to add one\./)
  })

  it('on a narrow terminal shows a window of columns that includes the selected one', () => {
    const narrow = { columns: 40, rows: 20 }
    const left = lines(board(tasks), narrow).map(strip).join('\n')
    assert.match(left, /TODO/)
    const done = lines({ ...board(tasks), col: 3, row: 0 }, narrow).map(strip).join('\n')
    assert.match(done, /DONE/)
    assert.doesNotMatch(done, /TODO \(/)
  })

  it('scrolls a long column so the selected card stays visible', () => {
    const many = Array.from({ length: 40 }, (_, i) => t(`s${i}`, 'todo', { order: i }))
    const out = lines({ ...board(many), row: 35 }, { columns: 80, rows: 20 }).map(strip).join('\n')
    assert.match(out, /Title of s35/)
    assert.doesNotMatch(out, /Title of s0\b/)
  })

  it('fit() and wrap() behave on edge cases', () => {
    assert.equal(fit('abc', 5), 'abc  ')
    assert.equal(fit('abcdef', 4), 'abc…')
    assert.equal(fit('a\nb', 4), 'a b ')
    assert.equal([...fit('🚀🚀🚀🚀', 3)].length, 3)
    assert.deepEqual(wrap('one two three', 7), ['one two', 'three'])
    assert.deepEqual(wrap('a\n\nb', 10), ['a', '', 'b'])
    assert.deepEqual(wrap('abcdefghij', 4), ['abcd', 'efgh', 'ij'])
    assert.deepEqual(wrap('x', 0), [])
  })
})

// The real thing, in a real pseudo-terminal: needs python3 (present on macOS and the CI runners).
describe('mdpm tui (pseudo-terminal)', () => {
  const hasPython = spawnSync('python3', ['--version']).status === 0
  let api: Awaited<ReturnType<typeof mockApi>>
  const content = join(scratch.dir, 'tui-content')
  before(async () => {
    cpSync(FIXTURE_CONTENT, content, { recursive: true })
    api = await mockApi()
  })
  after(() => api?.close())
  beforeEach(() => { api.requests.length = 0 })

  const drive = (steps: object[], args: string[] = ['--project', 'alpha'], size = [110, 32], extraEnv: Record<string, string> = {}) => new Promise<{ output: string; exit: number | null; timed_out: boolean }>((resolve) => {
    const child = spawn('python3', [join(REPO, 'tests/fixtures/pty-driver.py'), String(size[0]), String(size[1]), JSON.stringify(steps), '--', 'node', join(REPO, 'bin/mdpm.mjs'), 'tui', ...args], {
      cwd: scratch.dir,
      env: { ...isolatedEnv(scratch.dir), MDPM_CONTENT_PATH: content, MDPM_BASE_URL: api.url, MDPM_AUTHOR: 'Tester', ...extraEnv } as NodeJS.ProcessEnv,
    })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.once('exit', () => resolve(JSON.parse(out)))
  })
  const writes = () => api.requests.filter(r => r.method !== 'GET' && r.path !== '/api/health')

  it('draws the board, navigates, moves a card, adds a note, and quits cleanly', { skip: !hasPython }, async () => {
    const r = await drive([
      { wait: 'TODO \\(\\d+\\)', timeout: 15 },
      { wait: 'Write the docs' },
      { send: '\x1b[B' },           // down: second card in TODO
      { send: 'L' },               // move that card to the next column
      { wait: 'moved "', timeout: 8 },
      { send: 'n' }, { send: 'looks good' }, { send: '\r' },
      { wait: 'note added to', timeout: 8 },
      { send: 'q' },
    ])
    assert.equal(r.timed_out, false, `timed out; screen so far:\n${r.output.slice(-1500)}`)
    assert.equal(r.exit, 0, 'quitting is a normal exit')
    assert.match(r.output, /Alpha/)
    assert.match(r.output, /IN PROGRESS \(\d+\)/)
    const w = writes()
    assert.deepEqual(w.map(x => [x.method, x.path]), [['PATCH', '/api/tasks/alpha/write-docs'], ['PATCH', '/api/tasks/alpha/write-docs']], 'the second TODO card is the one that moved and got the note')
    assert.equal(w[0]!.body.status, 'in-progress')
    assert.match(w[1]!.body.description, /_ by Tester\n\nlooks good$/)
  })

  it('shows a write failure in the status bar, with the fix, instead of crashing', { skip: !hasPython }, async () => {
    const r = await drive([
      { wait: 'TODO \\(\\d+\\)', timeout: 15 },
      { send: 'd' },
      { wait: 'server is not running', timeout: 8 },
      { wait: 'mdpm start' },
      { send: 'j' },
      { send: 'q' },
    ], ['--project', 'alpha'], [110, 32], { MDPM_BASE_URL: 'http://127.0.0.1:1' })
    assert.equal(r.timed_out, false, r.output.slice(-1200))
    assert.equal(r.exit, 0, 'the board is still usable after a failed write, and quits normally')
    assert.equal(writes().length, 0)
  })

  it('opens help and the card view, and the picker when no project is given', { skip: !hasPython }, async () => {
    const r = await drive([
      { wait: 'Choose a project', timeout: 15 },
      { send: '\r' },
      { wait: 'TODO \\(' },
      { send: '?' }, { wait: 'Board\\s+← →' },
      { send: 'x' },
      { send: '\r' }, { wait: 'in-progress · high|todo · ' },
      { send: '\x1b' },
      { send: 'q' },
    ], [])
    assert.equal(r.timed_out, false, r.output.slice(-1500))
    assert.equal(r.exit, 0)
  })

  it('refuses to run without a terminal', async () => {
    const r = spawnSync('node', [join(REPO, 'bin/mdpm.mjs'), 'tui'], { encoding: 'utf8', input: '', env: { ...isolatedEnv(scratch.dir) } as NodeJS.ProcessEnv })
    assert.equal(r.status, 2)
    assert.match(r.stderr, /interactive terminal/)
  })
})
