import { createTaskFile, updateTaskFile, type TaskCreateInput, type TaskUpdateInput } from '../../utils/tasks-write'

const MAX_OPS = 100

type BatchOp =
  | ({ op: 'create' } & TaskCreateInput)
  | ({ op: 'update'; project: string; slug: string } & TaskUpdateInput)
  | { op: 'note'; project: string; slug: string; note: string; noteAuthor?: string }

// Several task writes in one request. Applied in order, one at a time (they rewrite files, so no parallelism);
// a failing item is reported and does not stop the rest. Each result is just the id and resulting status.
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ops?: BatchOp[] }>(event)
  const ops = body?.ops
  if (!Array.isArray(ops) || !ops.length) throw createError({ statusCode: 400, message: 'ops must be a non-empty array' })
  if (ops.length > MAX_OPS) throw createError({ statusCode: 400, message: `At most ${MAX_OPS} ops per batch` })

  const results = ops.map((item, index) => {
    try {
      if (item.op === 'create') {
        const { op: _, ...input } = item
        const r = createTaskFile(input)
        return { index, ok: true, id: r.id, status: r.status, ...(r.notices.length ? { notices: r.notices } : {}) }
      }
      if (item.op === 'update' || item.op === 'note') {
        const { op, project, slug, ...fields } = item
        if (!project || !slug) throw createError({ statusCode: 400, message: `${op} needs project and slug` })
        if (op === 'note' && !(item as { note?: string }).note?.trim()) throw createError({ statusCode: 400, message: 'note is empty' })
        const r = updateTaskFile(project, slug, fields)
        return { index, ok: true, id: r.id, status: r.status, ...(r.notices.length ? { notices: r.notices } : {}) }
      }
      throw createError({ statusCode: 400, message: `Unknown op: ${String((item as { op?: unknown }).op)}` })
    }
    catch (err) {
      return { index, ok: false, error: (err as Error).message }
    }
  })
  const failed = results.filter(r => !r.ok).length
  return { ok: results.length - failed, failed, results }
})
