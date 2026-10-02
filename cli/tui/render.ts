import { columns, selectedTask, type TuiState, type TuiTask } from './state'

// Pure rendering: state and terminal size in, a screen (an array of exactly `rows` lines) out.

const ESC = '\x1b['
const style = {
  reset: `${ESC}0m`, bold: `${ESC}1m`, dim: `${ESC}2m`, reverse: `${ESC}7m`,
  red: `${ESC}31m`, green: `${ESC}32m`, yellow: `${ESC}33m`, cyan: `${ESC}36m`,
}
const paint = (s: string, ...codes: string[]) => `${codes.join('')}${s}${style.reset}`

// Truncate or pad a plain string to exactly `width` terminal cells (one cell per code point).
export function fit(text: string, width: number): string {
  const chars = [...text.replace(/[\r\n\t]+/g, ' ')]
  if (chars.length <= width) return text.replace(/[\r\n\t]+/g, ' ') + ' '.repeat(width - chars.length)
  return `${chars.slice(0, Math.max(0, width - 1)).join('')}${width > 0 ? '…' : ''}`
}

export function wrap(text: string, width: number): string[] {
  if (width <= 0) return []
  return text.split('\n').flatMap((paragraph) => {
    if (!paragraph.trim()) return ['']
    const lines: string[] = []
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line) line = word
      else if ([...line].length + 1 + [...word].length <= width) line += ` ${word}`
      else { lines.push(line); line = word }
      while ([...line].length > width) { lines.push([...line].slice(0, width).join('')); line = [...line].slice(width).join('') }
    }
    return line ? [...lines, line] : lines
  })
}

const PRIORITY_MARK: Record<string, [string, string]> = {
  urgent: ['!', style.red], high: ['+', style.yellow], medium: [' ', ''], low: ['-', style.dim],
}
const priorityMark = (p: string) => PRIORITY_MARK[p] ?? [' ', '']

const STATUS_LABEL: Record<string, string> = { 'todo': 'TODO', 'in-progress': 'IN PROGRESS', 'in-review': 'IN REVIEW', 'blocked': 'BLOCKED', 'on-hold': 'ON HOLD', 'done': 'DONE' }

// The longest hint line that fits; a terminal too narrow for any of them still gets `? help  q quit`.
const HINTS = [
  '←→ column  ↑↓ card  H/L move  +/- priority  d done  n note  a add  / filter  p project  ⏎ open  ? help  q quit',
  '←→↑↓ move  H/L shift  d done  n note  a add  / find  ⏎ open  ? help  q quit',
  '←→↑↓ move  H/L shift  d done  ? help  q quit',
  '? help  q quit',
]
export const hintsFor = (width: number) => HINTS.find(h => [...h].length <= width) ?? HINTS.at(-1)!

export const HELP: string[] = [
  'Board',
  '  ← → / h l      switch column            ↑ ↓ / j k      move between cards',
  '  g / G          first / last card        tab            next column',
  '  H L  or  < >   move the card to the previous / next column',
  '  d              mark done                + / -          raise / lower priority',
  '  n              add a note to the card   a              add a task in this column',
  '  /              filter (Esc clears)      p              switch project',
  '  enter          open the card            r              reload',
  '  q / Ctrl-C     quit',
  '',
  'Open card:  ↑ ↓ / j k scroll,  Esc / enter / q back',
  'While typing:  enter confirms,  Esc cancels,  Ctrl-U clears',
  '',
  'Changes are written through the server. Everything else (editors, the CLI, agents)',
  'shows up here live.',
]

function cardLine(t: TuiTask, width: number, selected: boolean): string {
  const [mark, color] = priorityMark(t.priority)
  const waiting = t.dependencies.length ? '~' : ' '
  const body = fit(`${mark}${waiting}${t.title}`, width)
  if (selected) return paint(body, style.reverse)
  return color ? paint(body.slice(0, 1), color) + body.slice(1) : body
}

function boardLines(state: TuiState, width: number, height: number): string[] {
  const cols = columns(state)
  if (!cols.length) return []
  const MIN = 18
  // On a narrow terminal show a window of columns that always contains the selected one.
  const fitCount = Math.max(1, Math.min(cols.length, Math.floor((width + 1) / (MIN + 1))))
  const first = Math.max(0, Math.min(state.col - Math.floor(fitCount / 2), cols.length - fitCount))
  const visible = cols.slice(first, first + fitCount)
  const colWidth = Math.floor((width - (visible.length - 1)) / visible.length)
  const bodyRows = Math.max(1, height - 2)

  const out: string[] = []
  out.push(visible.map((c, i) => {
    const sel = first + i === state.col
    const label = `${STATUS_LABEL[c.status] ?? c.status.toUpperCase()} (${c.tasks.length})`
    return paint(fit(label, colWidth), style.bold, sel ? style.cyan : '')
  }).join(' '))
  out.push(visible.map(() => '─'.repeat(colWidth)).join(' '))

  // Scroll each column so the selected card stays on screen.
  const offsets = visible.map((c, i) => first + i === state.col ? Math.max(0, Math.min(state.row - bodyRows + 1, Math.max(0, c.tasks.length - bodyRows))) : 0)
  for (let r = 0; r < bodyRows; r++) {
    out.push(visible.map((c, i) => {
      const task = c.tasks[r + offsets[i]!]
      return task ? cardLine(task, colWidth, first + i === state.col && r + offsets[i]! === state.row) : ' '.repeat(colWidth)
    }).join(' '))
  }
  return out
}

function detailLines(task: TuiTask | undefined, width: number): string[] {
  if (!task) return [paint(fit('No card selected', width), style.dim)]
  const meta = [task.status, task.priority, task.tags.length && task.tags.join(', '), task.assignees.length && `@${task.assignees.join(' @')}`, task.due && `due ${task.due}`].filter(Boolean).join(' · ')
  return [
    paint(fit(task.title, width), style.bold),
    paint(fit(meta, width), style.dim),
    ...(task.dependencies.length ? [paint(fit(`waits on: ${task.dependencies.join(', ')}`, width), style.dim)] : []),
    ...wrap(task.body.trim(), width).map(l => fit(l, width)),
  ]
}

function pad(lines: string[], rows: number, width: number): string[] {
  const filled = lines.slice(0, Math.max(0, rows))
  while (filled.length < rows) filled.push(' '.repeat(width))
  return filled
}

export function renderScreen(state: TuiState, size: { columns: number; rows: number }): string[] {
  const width = Math.max(20, size.columns)
  const rows = Math.max(6, size.rows)
  const header = paint(fit(` ${state.projectTitle || state.project || 'mdpm'}   ${state.tasks.length} task${state.tasks.length === 1 ? '' : 's'}${state.filter ? `   filter: ${state.filter}` : ''}`, width), style.reverse)
  const footer = (() => {
    if (state.mode === 'prompt') {
      const label = { note: 'Note', add: 'New task', filter: 'Filter' }[state.prompt!.kind]
      return fit(`${label}: ${state.prompt!.text}▏`, width)
    }
    if (state.message) return paint(fit(state.message.text, width), state.message.error ? style.red : style.green)
    return paint(fit(hintsFor(width), width), style.dim)
  })()
  const middle = rows - 2

  if (state.mode === 'help') return [header, ...pad(HELP.map(l => fit(l, width)), middle, width), footer]

  if (state.mode === 'picker') {
    const picker = state.picker!
    const lines = picker.projects.length
      ? picker.projects.map((p, i) => i === picker.index ? paint(fit(`> ${p.title}  (${p.slug})`, width), style.reverse) : fit(`  ${p.title}  (${p.slug})`, width))
      : [fit('  loading projects…', width)]
    return [header, ...pad([paint(fit('Choose a project (↑↓, enter, Esc)', width), style.bold), '', ...lines], middle, width), footer]
  }

  if (state.mode === 'detail') {
    const all = detailLines(selectedTask(state), width)
    const scroll = Math.min(state.detailScroll, Math.max(0, all.length - middle))
    return [header, ...pad(all.slice(scroll), middle, width), footer]
  }

  if (!state.tasks.length) {
    return [header, ...pad([fit('', width), fit('  No tasks yet. Press a to add one.', width)], middle, width), footer]
  }
  // Board on top and the selected card's details underneath. The board takes the rows its tallest column
  // needs (at least three cards' worth) and the details get everything left over, so a small board gives
  // its spare space to the description instead of leaving it blank. A big board is capped so the details
  // keep a readable minimum. A short terminal gets the board alone (Enter still opens the card).
  const showDetail = middle >= 14
  const minDetail = Math.min(8, Math.max(4, Math.floor(middle / 3)))
  const tallest = Math.max(3, ...columns(state).map(c => c.tasks.length))
  const boardHeight = showDetail ? Math.min(2 + tallest, middle - minDetail - 1) : middle
  const detailRows = showDetail ? middle - boardHeight - 1 : 0
  const board = pad(boardLines(state, width, boardHeight), boardHeight, width)
  if (!detailRows) return [header, ...board, footer]
  const rule = paint('─'.repeat(width), style.dim)
  return [header, ...board, rule, ...pad(detailLines(selectedTask(state), width), detailRows, width), footer]
}
