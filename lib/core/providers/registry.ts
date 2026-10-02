import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO_ROOT } from '../config'
import { createProvider, type Provider } from './provider'
import { formatIssues, ProviderSpec } from './schema'

export interface ProviderProblem {
  file: string
  problems: string[]
}

export interface LoadedProviders {
  providers: Provider[]
  problems: ProviderProblem[]
}

export const BUILTIN_PROVIDERS_DIR = join(REPO_ROOT, 'providers')

// One file -> a provider, or the list of what is wrong with it ("field: reason").
export function loadProviderFile(file: string): { provider: Provider } | { problems: string[] } {
  let data: unknown
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  }
  catch (err) {
    return { problems: [`not readable JSON: ${(err as Error).message}`] }
  }
  const parsed = ProviderSpec.safeParse(data)
  return parsed.success ? { provider: createProvider(parsed.data) } : { problems: formatIssues(parsed.error) }
}

// A directory of *.json provider files. A bad file is reported and skipped, never fatal: one typo in
// a user's provider must not take the CLI or server down. Missing directory = no providers.
export function loadProviderDir(dir: string): LoadedProviders {
  let names: string[]
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json')).sort()
  }
  catch {
    return { providers: [], problems: [] }
  }
  const providers: Provider[] = []
  const problems: ProviderProblem[] = []
  for (const name of names) {
    const file = join(dir, name)
    const result = loadProviderFile(file)
    if ('provider' in result) providers.push(result.provider)
    else problems.push({ file, problems: result.problems })
  }
  return { providers, problems }
}

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

export function loadBuiltinProviders(): LoadedProviders {
  return loadProviderDir(BUILTIN_PROVIDERS_DIR)
}

export function builtinRegistry() {
  return createRegistry(loadBuiltinProviders().providers)
}
