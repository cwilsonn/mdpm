import type { CoreConfig } from './config'
import { ServerUnreachableError } from './errors'

export type ApiClient = ReturnType<typeof createApi>

export interface ApiHooks {
  // Called when a write finds the server down. Resolve to have the request retried once
  // (e.g. after starting the server); reject to fail the write.
  onUnreachable?: () => Promise<void>
}

export function createApi(config: CoreConfig, hooks: ApiHooks = {}) {
  function send(method: string, path: string, body?: unknown) {
    return fetch(`${config.baseUrl}${path}`, {
      method,
      ...(body !== undefined && {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    })
  }

  async function request(method: string, path: string, body?: unknown) {
    let res: Response
    try {
      res = await send(method, path, body)
    }
    catch {
      // fetch only rejects on network failure (refused, DNS, bad URL), never on HTTP status.
      const unreachable = new ServerUnreachableError(`mdpm server unreachable at ${config.baseUrl}`)
      if (!hooks.onUnreachable) throw unreachable
      await hooks.onUnreachable()
      try {
        res = await send(method, path, body)
      }
      catch {
        throw unreachable
      }
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error((err as any).message ?? res.statusText)
    }
    return res.json()
  }

  // Liveness check; any HTTP response (incl. redirects) counts as up. The default timeout is
  // generous on purpose: macOS resolves `.local` hosts via mDNS, and a dual-stack lookup of
  // mdpm.local takes ~5s before Node connects, so a short timeout reports a false "down".
  async function probe(timeoutMs = 8000) {
    try {
      await fetch(config.baseUrl, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
      return true
    }
    catch {
      return false
    }
  }

  return {
    post: (path: string, body: unknown) => request('POST', path, body),
    patch: (path: string, body: unknown) => request('PATCH', path, body),
    delete: (path: string) => request('DELETE', path),
    probe,
  }
}
