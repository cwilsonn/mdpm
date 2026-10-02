import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
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
