import { ConflictError, LimitError, NotFoundError, ValidationError, WriteBusyError } from '../../lib/core/errors'
import { createWriter, type Writer } from '../../lib/core/write'
import { contentRoot } from './content'
import { isDemo } from './demo'

// The routes' side of lib/core/write.ts: one writer per request (the root and demo mode are read at runtime),
// and the core's typed errors turned into HTTP statuses.

const DEMO_LIMITS = { projects: 10, tasksPerProject: 20, docsPerProject: 20, standaloneDocs: 50 }

function httpStatus(err: unknown) {
  if (err instanceof ValidationError) return 400
  if (err instanceof NotFoundError) return 404
  if (err instanceof WriteBusyError || err instanceof ConflictError) return 409
  if (err instanceof LimitError) return 429
  return undefined
}

export function withWriter<T>(fn: (writer: Writer) => T): T {
  const writer = createWriter(contentRoot(), { limits: isDemo() ? DEMO_LIMITS : {} })
  try {
    return fn(writer)
  }
  catch (err) {
    const statusCode = httpStatus(err)
    // `data.reason` tells a stale-edit conflict (reload) apart from a busy lock (retry); both are 409.
    if (statusCode) throw createError({ statusCode, message: (err as Error).message, ...(err instanceof ConflictError && { data: { reason: 'conflict' } }) })
    throw err
  }
}
