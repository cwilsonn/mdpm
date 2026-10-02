import { loadBuiltinProviders } from './builtin'
import type { Provider } from './provider'

export interface Registry {
  providers: Provider[]
  get(id: string): Provider | undefined
  // Every scheme a stored link may use: the safe defaults plus whatever providers declare.
  schemes(): Set<string>
  // Git remote -> provider-understood repo. Most specific host wins; ties are not guessed.
  inferRepo(remote: string): { provider: Provider; host: string; ref: string } | undefined
}

// Later entries replace earlier ones with the same id (user providers override built-ins).
export function createRegistry(...sources: Provider[][]): Registry {
  const byId = new Map<string, Provider>()
  for (const list of sources) for (const p of list) byId.set(p.id, p)
  const providers = [...byId.values()]

  return {
    providers,
    get: id => byId.get(id),
    schemes: () => new Set(providers.flatMap(p => p.schemes)),
    inferRepo(remote) {
      const hits = providers.flatMap((provider) => {
        const found = provider.inferRepo?.(remote)
        return found ? [{ provider, ...found, rank: provider.claims(found.host) }] : []
      })
      const best = Math.max(0, ...hits.map(h => h.rank))
      const top = hits.filter(h => h.rank === best)
      if (top.length !== 1) return undefined
      const { provider, host, ref } = top[0]!
      return { provider, host, ref }
    },
  }
}

let builtin: Registry | undefined
// Built-ins only; user providers are layered on by callers that read the config directory.
export function builtinRegistry() {
  return builtin ??= createRegistry(loadBuiltinProviders().providers)
}
