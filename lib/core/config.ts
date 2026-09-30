import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_BASE_URL = 'http://mdpm.local:3333'

// lib/core/config.ts -> repo root. Node resolves symlinks for the entry module,
// so this is the real checkout even when invoked through a linked bin.
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export interface CoreConfig {
  contentPath: string
  baseUrl: string
}

// Env wins; otherwise fall back to this checkout. Flag / config-file / cwd
// inference lands with the CLI config task.
export function resolveConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  return {
    contentPath: env.MDPM_CONTENT_PATH ?? join(REPO_ROOT, 'content'),
    baseUrl: env.MDPM_BASE_URL ?? DEFAULT_BASE_URL,
  }
}

export function contentPathOf(config: CoreConfig, ...parts: string[]) {
  return join(config.contentPath, ...parts)
}
