// `--where` selectors for bulk task operations: `status=todo|blocked,tag=core,priority!=low`.
// Clauses are joined by commas (all must hold); `|` separates alternatives within a clause.
//   field=value    equals (any of the alternatives, case-insensitive; for tags/assignees: has one of them)
//   field!=value   none of the alternatives match
//   field~text     contains the text (case-insensitive; for tags/assignees: some entry contains it)

export class WhereError extends Error {
  override name = 'WhereError'
}

export const WHERE_FIELDS = ['status', 'priority', 'tag', 'assignee', 'title', 'slug', 'project'] as const
type Field = typeof WHERE_FIELDS[number]
type Op = '=' | '!=' | '~'

export interface Clause {
  field: Field
  op: Op
  values: string[]
}

export interface WhereTask {
  project: string
  slug: string
  title: string
  status: string
  priority: string
  tags: string[]
  assignees: string[]
}

const ALIASES: Record<string, Field> = { tags: 'tag', assignees: 'assignee' }

export function parseWhere(expr: string): Clause[] {
  const clauses = expr.split(',').map(c => c.trim()).filter(Boolean).map((raw): Clause => {
    const m = raw.match(/^([a-z]+)\s*(!=|=|~)\s*(.*)$/i)
    if (!m) throw new WhereError(`cannot read '${raw}': use field=value, field!=value, or field~text`)
    const name = m[1]!.toLowerCase()
    const field = ALIASES[name] ?? name
    if (!(WHERE_FIELDS as readonly string[]).includes(field)) throw new WhereError(`unknown field '${m[1]}' (use ${WHERE_FIELDS.join(', ')})`)
    const values = m[3]!.split('|').map(v => v.trim()).filter(Boolean)
    if (!values.length) throw new WhereError(`'${raw}' has no value`)
    return { field: field as Field, op: m[2] as Op, values }
  })
  if (!clauses.length) throw new WhereError('--where is empty')
  return clauses
}

const candidates = (task: WhereTask, field: Field): string[] => {
  switch (field) {
    case 'tag': return task.tags
    case 'assignee': return task.assignees
    default: return [task[field]]
  }
}

export function matches(task: WhereTask, clauses: Clause[]): boolean {
  return clauses.every(({ field, op, values }) => {
    const have = candidates(task, field).map(v => v.toLowerCase())
    const want = values.map(v => v.toLowerCase())
    const hit = op === '~'
      ? want.some(w => have.some(h => h.includes(w)))
      : want.some(w => have.includes(w))
    return op === '!=' ? !hit : hit
  })
}
