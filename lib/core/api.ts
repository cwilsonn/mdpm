import type { CoreConfig } from './config'
import { ContentRootMismatchError, ServerUnreachableError } from './errors'
import { samePath } from './paths'

export type ApiClient = ReturnType<typeof createApi>

export interface ApiHooks {
  // Called when a write finds the server down. Resolve to have the request retried once
  // (e.g. after starting the server); reject to fail the write.
  onUnreachable?: () => Promise<void>
  // Called for each notice (deprecation, warning) a write response carries; the CLI prints them to stderr.
  onNotice?: (notice: string) => void
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

  // What the running server says about itself, or undefined when it is down, too old to have
  // /api/health, or (in production) doesn't disclose its content root.
  async function health(timeoutMs = 3000): Promise<{ ok: boolean; contentRoot?: string } | undefined> {
    try {
      const res = await fetch(`${config.baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
      return res.ok ? await res.json() : undefined
    }
    catch {
      return undefined
    }
  }

  // Before the first write: refuse if the server reads/writes a different content directory than
  // this process reads from, since the write would land where the next read can't see it.
  let rootChecked: Promise<void> | undefined
  function assertSameContentRoot() {
    return rootChecked ??= health().then((info) => {
      if (info?.contentRoot && !samePath(info.contentRoot, config.contentPath)) {
        throw new ContentRootMismatchError(
          `the server at ${config.baseUrl} uses content directory ${info.contentRoot}, but this process reads ${config.contentPath}; `
          + 'writes would be invisible to reads. Restart the server with `mdpm restart` (it inherits the CLI\'s content path) or make both use the same MDPM_CONTENT_PATH.',
        )
      }
    })
  }

  async function request(method: string, path: string, body?: unknown) {
    await assertSameContentRoot()
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
    const result = await res.json()
    if (Array.isArray(result?.notices)) for (const notice of result.notices) hooks.onNotice?.(String(notice))
    return result
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
    health,
  }
}
