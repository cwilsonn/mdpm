import type { CoreConfig } from './config'

export type ApiClient = ReturnType<typeof createApi>

// Writes go to the files (lib/core/write.ts); this only asks about a running server, for `mdpm ping`.
export function createApi(config: CoreConfig) {
  // What the running server says about itself, or undefined when it is down, too old to have
  // /api/health, or (in demo mode) doesn't disclose its content root.
  async function health(timeoutMs = 3000): Promise<{ ok: boolean; contentRoot?: string } | undefined> {
    try {
      const res = await fetch(`${config.baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) })
      return res.ok ? await res.json() : undefined
    }
    catch {
      return undefined
    }
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

  return { probe, health }
}
