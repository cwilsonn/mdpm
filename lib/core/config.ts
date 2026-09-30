import { join } from 'node:path'

export const DEFAULT_BASE_URL = 'http://mdpm.local:3333'

export interface CoreConfig {
  contentPath: string
  baseUrl: string
}

// Env-only for now; flag / config-file / symlink resolution lands with the CLI
// config task.
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const contentPath = env.MDPM_CONTENT_PATH
  if (!contentPath) throw new Error('MDPM_CONTENT_PATH env var is required')
  return { contentPath, baseUrl: env.MDPM_BASE_URL ?? DEFAULT_BASE_URL }
}

export function contentPathOf(config: CoreConfig, ...parts: string[]) {
  return join(config.contentPath, ...parts)
}
