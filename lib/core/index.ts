import { createApi } from './api'
import { resolveConfig, type CoreConfig } from './config'
import { createOps } from './ops'
import { createReader } from './read'

export function createCore(config: CoreConfig = resolveConfig()) {
  const reader = createReader(config)
  const api = createApi(config)
  return createOps(config, reader, api)
}

export { REPO_ROOT } from './config'
export type { CoreConfig } from './config'
export { NotFoundError, ServerUnreachableError } from './errors'
export type { Ops } from './ops'
