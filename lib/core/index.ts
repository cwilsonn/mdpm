import { createApi, type ApiHooks } from './api'
import { resolveConfig, type CoreConfig } from './config'
import { createOps } from './ops'
import { createReader } from './read'

export function createCore(config: CoreConfig = resolveConfig(), hooks: ApiHooks = {}) {
  const reader = createReader(config)
  const api = createApi(config, hooks)
  return createOps(config, reader, api)
}

export { configFilePath, loadConfig, REPO_ROOT, resolveConfig } from './config'
export type { ConfigSource, LoadedConfig } from './config'
export { inferProject, normalizeGithubRepo } from './project'
export type { InferredProject } from './project'
export { createLifecycle, LifecycleError } from './lifecycle'
export type { Lifecycle, ServerStatus } from './lifecycle'
export type { CoreConfig } from './config'
export { AmbiguousError, ConfigError, ContentRootMismatchError, NotFoundError, ServerUnreachableError } from './errors'
export type { Ops } from './ops'
export { TASK_PRIORITIES, TASK_STATUSES } from './schema'
export { buildPickup } from './pickup'
export type { Pickup } from './pickup'
export { samePath } from './paths'
