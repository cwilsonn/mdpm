import { join } from 'node:path'
import * as content from '../server/utils/content'
import { applyLinkWrite } from '../server/utils/links-write'
import { REPO } from './helpers'

// Runs the real Nitro route modules in-process. Nitro auto-imports these globals in server code;
// here they are stubs, so a route is just `handler({ params, body, query })`.
const g = globalThis as Record<string, unknown>
g.defineEventHandler = (fn: unknown) => fn
g.readBody = async (event: { body?: unknown }) => event.body
g.getRouterParam = (event: { params?: Record<string, string> }, key: string) => event.params?.[key]
g.getQuery = (event: { query?: unknown }) => event.query ?? {}
g.createError = (input: { statusCode?: number; message?: string; data?: unknown }) => Object.assign(new Error(input.message), input)
Object.assign(g, content, { applyLinkWrite })

export interface RouteEvent {
  params?: Record<string, string>
  body?: unknown
  query?: Record<string, string>
}

// e.g. route('tasks/[project]/[slug].patch') -> (event) => Promise<response>
export async function route(name: string): Promise<(event: RouteEvent) => Promise<any>> {
  const path = join(REPO, 'server/api', `${name}.ts`)
  return (await import(path)).default
}

export async function rejects(promise: Promise<unknown>) {
  try {
    await promise
  }
  catch (err) {
    return err as Error & { statusCode?: number; data?: { code?: string } }
  }
  throw new Error('expected the route to reject')
}
