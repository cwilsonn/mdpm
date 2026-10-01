import type { Key } from './keys'

// Pure state for the board. `update` takes a key and returns the next state plus, when the key asks for
// something with side effects (a write, a reload, quitting), an effect for the runner to carry out.

export interface TuiTask {
  project: string
  slug: string
  title: string
  status: string
  priority: string
  tags: string[]
  assignees: string[]
  due: string | null
  dependencies: string[]
  body: string
  order: number
}

export interface TuiProject {
  slug: string
  title: string
}

export type Mode = 'board' | 'detail' | 'help' | 'prompt' | 'picker'
export type PromptKind = 'note' | 'add' | 'filter'

export interface TuiState {
  project: string
  projectTitle: string
  tasks: TuiTask[]
  col: number
  row: number
  filter: string
  mode: Mode
  prompt?: { kind: PromptKind; text: string }
  picker?: { projects: TuiProject[]; index: number }
  /** vertical scroll of the detail view */
  detailScroll: number
  message?: { text: string; error?: boolean }
}

export type Effect =
  | { type: 'quit' }
  | { type: 'reload' }
  | { type: 'projects' }
  | { type: 'move'; task: TuiTask; status: string }
  | { type: 'priority'; task: TuiTask; priority: string }
  | { type: 'note'; task: TuiTask; text: string }
  | { type: 'add'; title: string; status: string }
  | { type: 'switch'; project: string }

export const PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const
const CORE = ['todo', 'in-progress', 'in-review', 'done']
const CANONICAL = ['todo', 'in-progress', 'in-review', 'blocked', 'on-hold', 'done']

export const initialState = (project: string, projectTitle: string, tasks: TuiTask[]): TuiState => ({
  project, projectTitle, tasks, col: 0, row: 0, filter: '', mode: 'board', detailScroll: 0,
})

const matchesFilter = (t: TuiTask, filter: string) => {
  const f = filter.trim().toLowerCase()
  return !f || [t.title, t.slug, t.status, t.priority, ...t.tags, ...t.assignees].some(v => v.toLowerCase().includes(f))
}

// Columns are the four core statuses plus blocked / on-hold when something is in them, in a fixed order.
// Archived tasks never reach the board (the runner loads without them).
export function columns(state: Pick<TuiState, 'tasks' | 'filter'>): { status: string; tasks: TuiTask[] }[] {
  const visible = state.tasks.filter(t => matchesFilter(t, state.filter))
  const used = new Set(state.tasks.map(t => t.status))
  const statuses = [...CANONICAL.filter(s => CORE.includes(s) || used.has(s)), ...[...used].filter(s => !CANONICAL.includes(s))]
  return statuses.map(status => ({ status, tasks: visible.filter(t => t.status === status).sort((a, b) => a.order - b.order) }))
}

export const selectedTask = (state: TuiState): TuiTask | undefined => columns(state)[state.col]?.tasks[state.row]

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

// Keep the cursor inside the board after anything that can change the columns.
export function settle(state: TuiState): TuiState {
  const cols = columns(state)
  const col = clamp(state.col, 0, Math.max(0, cols.length - 1))
  const row = clamp(state.row, 0, Math.max(0, (cols[col]?.tasks.length ?? 1) - 1))
  return col === state.col && row === state.row ? state : { ...state, col, row }
}

// Replace the task list (after a reload) while keeping the cursor on the same task when it still exists.
export function withTasks(state: TuiState, tasks: TuiTask[]): TuiState {
  const keep = selectedTask(state)
  const next = { ...state, tasks }
  if (keep) {
    const cols = columns(next)
    for (const [c, column] of cols.entries()) {
      const r = column.tasks.findIndex(t => t.slug === keep.slug)
      if (r >= 0) return { ...next, col: c, row: r }
    }
  }
  return settle(next)
}

// Fill the picker once the runner has the project list; start on the current project.
export function withProjects(state: TuiState, projects: TuiProject[]): TuiState {
  const index = Math.max(0, projects.findIndex(p => p.slug === state.project))
  return { ...state, mode: 'picker', picker: { projects, index } }
}

export function withMessage(state: TuiState, text: string, error = false): TuiState {
  return { ...state, message: { text, error } }
}

type Result = [TuiState, Effect?]

export function update(state: TuiState, key: Key): Result {
  if (key.name === 'ctrl-c') return [state, { type: 'quit' }]
  switch (state.mode) {
    case 'prompt': return updatePrompt(state, key)
    case 'picker': return updatePicker(state, key)
    case 'help': return [{ ...state, mode: 'board' }]
    case 'detail': return updateDetail(state, key)
    default: return updateBoard({ ...state, message: undefined }, key)
  }
}

function updatePrompt(state: TuiState, key: Key): Result {
  const prompt = state.prompt!
  if (key.name === 'escape') return [{ ...state, mode: 'board', prompt: undefined }]
  if (key.name === 'backspace') return [{ ...state, prompt: { ...prompt, text: prompt.text.slice(0, -1) } }]
  if (key.name === 'ctrl-u') return [{ ...state, prompt: { ...prompt, text: '' } }]
  if (key.name === 'char') return [{ ...state, prompt: { ...prompt, text: prompt.text + key.char } }]
  if (key.name !== 'enter') return [state]

  const text = prompt.text.trim()
  const back = { ...state, mode: 'board' as const, prompt: undefined }
  if (prompt.kind === 'filter') return [settle({ ...back, filter: text, col: state.col, row: 0 })]
  if (!text) return [back]
  if (prompt.kind === 'note') {
    const task = selectedTask(state)
    return task ? [back, { type: 'note', task, text }] : [back]
  }
  const status = columns(state)[state.col]?.status ?? 'todo'
  return [back, { type: 'add', title: text, status }]
}

function updatePicker(state: TuiState, key: Key): Result {
  const picker = state.picker!
  const last = picker.projects.length - 1
  if (key.name === 'escape') return [state.project ? { ...state, mode: 'board', picker: undefined } : state, state.project ? undefined : { type: 'quit' }]
  if (key.name === 'up' || (key.name === 'char' && key.char === 'k')) return [{ ...state, picker: { ...picker, index: clamp(picker.index - 1, 0, last) } }]
  if (key.name === 'down' || (key.name === 'char' && key.char === 'j')) return [{ ...state, picker: { ...picker, index: clamp(picker.index + 1, 0, last) } }]
  if (key.name === 'char' && key.char === 'q') return [state, { type: 'quit' }]
  if (key.name === 'enter') {
    const chosen = picker.projects[picker.index]
    return chosen ? [{ ...state, mode: 'board', picker: undefined }, { type: 'switch', project: chosen.slug }] : [state]
  }
  return [state]
}

function updateDetail(state: TuiState, key: Key): Result {
  if (key.name === 'escape' || key.name === 'enter' || (key.name === 'char' && (key.char === 'q' || key.char === 'h'))) return [{ ...state, mode: 'board', detailScroll: 0 }]
  if (key.name === 'down' || (key.name === 'char' && key.char === 'j')) return [{ ...state, detailScroll: state.detailScroll + 1 }]
  if (key.name === 'up' || (key.name === 'char' && key.char === 'k')) return [{ ...state, detailScroll: Math.max(0, state.detailScroll - 1) }]
  if (key.name === 'pagedown') return [{ ...state, detailScroll: state.detailScroll + 10 }]
  if (key.name === 'pageup') return [{ ...state, detailScroll: Math.max(0, state.detailScroll - 10) }]
  return [state]
}

function updateBoard(state: TuiState, key: Key): Result {
  const cols = columns(state)
  const task = selectedTask(state)
  const ch = key.name === 'char' ? key.char : undefined
  const goCol = (delta: number): Result => {
    const col = clamp(state.col + delta, 0, cols.length - 1)
    return [settle({ ...state, col, row: clamp(state.row, 0, Math.max(0, (cols[col]?.tasks.length ?? 1) - 1)) })]
  }
  const goRow = (to: number): Result => [{ ...state, row: clamp(to, 0, Math.max(0, (cols[state.col]?.tasks.length ?? 1) - 1)) }]

  if (key.name === 'left' || ch === 'h') return goCol(-1)
  if (key.name === 'right' || ch === 'l') return goCol(1)
  if (key.name === 'tab') return goCol(1)
  if (key.name === 'up' || ch === 'k') return goRow(state.row - 1)
  if (key.name === 'down' || ch === 'j') return goRow(state.row + 1)
  if (key.name === 'home' || ch === 'g') return goRow(0)
  if (key.name === 'end' || ch === 'G') return goRow(Number.MAX_SAFE_INTEGER)
  if (key.name === 'escape' && state.filter) return [settle({ ...state, filter: '', row: 0 })]

  if (ch === 'q') return [state, { type: 'quit' }]
  if (ch === '?') return [{ ...state, mode: 'help' }]
  if (ch === 'r') return [{ ...state, message: { text: 'reloaded' } }, { type: 'reload' }]
  if (ch === '/') return [{ ...state, mode: 'prompt', prompt: { kind: 'filter', text: state.filter } }]
  if (ch === 'a') return [{ ...state, mode: 'prompt', prompt: { kind: 'add', text: '' } }]
  if (ch === 'p') return [{ ...state, mode: 'picker', picker: { projects: [], index: 0 } }, { type: 'projects' }]

  if (!task) return [state]
  if (key.name === 'enter') return [{ ...state, mode: 'detail', detailScroll: 0 }]
  if (ch === 'n') return [{ ...state, mode: 'prompt', prompt: { kind: 'note', text: '' } }]
  if (ch === 'd') return task.status === 'done' ? [withMessage(state, 'already done')] : [state, { type: 'move', task, status: 'done' }]
  // Shift moves the card one column; the cursor follows it once the reload lands.
  if (ch === 'H' || ch === '<') {
    const prev = cols[state.col - 1]
    return prev ? [state, { type: 'move', task, status: prev.status }] : [withMessage(state, 'already in the first column')]
  }
  if (ch === 'L' || ch === '>') {
    const next = cols[state.col + 1]
    return next ? [state, { type: 'move', task, status: next.status }] : [withMessage(state, 'already in the last column')]
  }
  if (ch === '+' || ch === '-') {
    const at = PRIORITIES.indexOf(task.priority as typeof PRIORITIES[number])
    const to = PRIORITIES[clamp((at < 0 ? 1 : at) + (ch === '+' ? 1 : -1), 0, PRIORITIES.length - 1)]!
    return to === task.priority ? [withMessage(state, `priority is already ${to}`)] : [state, { type: 'priority', task, priority: to }]
  }
  return [state]
}
