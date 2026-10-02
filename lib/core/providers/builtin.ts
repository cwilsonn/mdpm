import git from '../../../providers/git.json' with { type: 'json' }
import github from '../../../providers/github.json' with { type: 'json' }
import gitlab from '../../../providers/gitlab.json' with { type: 'json' }
import { createProvider, type Provider } from './provider'
import { formatIssues, ProviderSpec } from './schema'

// Built-in providers are imported as data so a bundled server (Nitro) carries them without reading
// the providers/ directory at runtime. They still go through the same schema as user files.
const SOURCES: Record<string, unknown> = { 'providers/git.json': git, 'providers/github.json': github, 'providers/gitlab.json': gitlab }

export function loadBuiltinProviders(): { providers: Provider[]; problems: { file: string; problems: string[] }[] } {
  const providers: Provider[] = []
  const problems: { file: string; problems: string[] }[] = []
  for (const [file, data] of Object.entries(SOURCES)) {
    const parsed = ProviderSpec.safeParse(data)
    if (parsed.success) providers.push(createProvider(parsed.data))
    else problems.push({ file, problems: formatIssues(parsed.error) })
  }
  return { providers, problems }
}
